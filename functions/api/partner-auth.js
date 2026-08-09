/**
 * Partner Auth API — /api/partner-auth
 *
 * POST { action: "login", email, password }  → authenticate partner, set HttpOnly session cookie
 * POST { action: "verify" }                  → verify session cookie, return partner info
 * POST { action: "logout" }                  → invalidate session
 * POST { action: "request", email, password, name, company, phone, message } → self-service request (pending approval)
 * POST { action: "forgot-password", email }      → send password reset email
 * POST { action: "reset-password", token, password } → set new password using reset token
 */

import {
  RequestValidationError,
  checkRateLimit,
  getClientAddress,
  hardenedJson,
  isSameOriginRequest,
  queueSecurityEvent,
  rateLimitResponse,
  readBoundedJson,
  sha256Hex as hashIdentifier,
  supabaseHeaders,
} from "./_security.js";

const PARTNER_COOKIE = "__Host-sm_partner_session";
const PARTNER_SESSION_SECONDS = 12 * 60 * 60;
const MIN_PASSWORD_LENGTH = 12;
const MAX_PASSWORD_LENGTH = 128;

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: { "Allow": "POST, OPTIONS" } });
}

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method !== "POST") {
    return json({ ok: false, error: "Method not allowed" }, 405);
  }
  if (!isSameOriginRequest(request)) {
    return json({ ok: false, error: "Forbidden" }, 403);
  }
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) {
    return json({ ok: false, error: "Server config error" }, 500);
  }

  const broadLimit = await checkRateLimit(env, request, "partner-auth-ip", getClientAddress(request), {
    maxAttempts: 300,
    windowSeconds: 300,
    blockSeconds: 300,
    failClosed: true,
  });
  if (!broadLimit.allowed) {
    queueSecurityEvent(context, env, request, {
      eventType: "partner_auth_rate_limited",
      actorType: "anonymous",
      success: false,
      metadata: { retry_after: broadLimit.retryAfter },
    });
    return rateLimitResponse(json, broadLimit.retryAfter);
  }

  let data;
  try { data = await readBoundedJson(request); }
  catch (error) {
    const status = error instanceof RequestValidationError ? error.status : 400;
    return json({ ok: false, error: error instanceof RequestValidationError ? error.message : "Invalid JSON" }, status);
  }

  const { action } = data;

  if (action === "login") {
    const normalisedEmail = normaliseEmail(data.email);
    const [ipLimit, emailLimit] = await Promise.all([
      checkRateLimit(env, request, "partner-login-ip", getClientAddress(request), {
        maxAttempts: 15, windowSeconds: 900, blockSeconds: 1800, failClosed: true,
      }),
      checkRateLimit(env, request, "partner-login-email", normalisedEmail || "invalid", {
        maxAttempts: 8, windowSeconds: 900, blockSeconds: 1800, failClosed: true,
      }),
    ]);
    const denied = !ipLimit.allowed ? ipLimit : !emailLimit.allowed ? emailLimit : null;
    if (denied) {
      queueSecurityEvent(context, env, request, {
        eventType: "partner_login_rate_limited",
        actorType: "anonymous",
        success: false,
        identifierHash: await hashIdentifier(normalisedEmail || "invalid"),
        metadata: { retry_after: denied.retryAfter },
      });
      return rateLimitResponse(json, denied.retryAfter);
    }
    return handleLogin(context, env, request, data);
  }
  if (action === "verify") return handleVerify(env, request, data);
  if (action === "logout") return handleLogout(context, env, request, data);
  if (action === "request") {
    const normalisedEmail = normaliseEmail(data.email);
    const [ipLimit, emailLimit] = await Promise.all([
      checkRateLimit(env, request, "partner-request-ip", getClientAddress(request), {
        maxAttempts: 5, windowSeconds: 86400, blockSeconds: 86400, failClosed: true,
      }),
      checkRateLimit(env, request, "partner-request-email", normalisedEmail || "invalid", {
        maxAttempts: 3, windowSeconds: 86400, blockSeconds: 86400, failClosed: true,
      }),
    ]);
    const denied = !ipLimit.allowed ? ipLimit : !emailLimit.allowed ? emailLimit : null;
    if (denied) return rateLimitResponse(json, denied.retryAfter);
    return handleRequest(context, env, request, data);
  }
  if (action === "forgot-password") {
    const normalisedEmail = normaliseEmail(data.email);
    const [ipLimit, emailLimit] = await Promise.all([
      checkRateLimit(env, request, "partner-forgot-ip", getClientAddress(request), {
        maxAttempts: 8, windowSeconds: 3600, blockSeconds: 3600, failClosed: true,
      }),
      checkRateLimit(env, request, "partner-forgot-email", normalisedEmail || "invalid", {
        maxAttempts: 3, windowSeconds: 3600, blockSeconds: 3600, failClosed: true,
      }),
    ]);
    if (!ipLimit.allowed || !emailLimit.allowed) {
      queueSecurityEvent(context, env, request, {
        eventType: "partner_password_reset_rate_limited",
        actorType: "anonymous",
        success: false,
        identifierHash: await hashIdentifier(normalisedEmail || "invalid"),
      });
      return json({ ok: true, message: forgotPasswordMessage() });
    }
    return handleForgotPassword(context, env, request, data);
  }
  if (action === "reset-password") {
    const tokenIdentifier = typeof data.token === "string" ? data.token : "invalid";
    const resetLimit = await checkRateLimit(env, request, "partner-reset-token", tokenIdentifier, {
      maxAttempts: 5, windowSeconds: 3600, blockSeconds: 3600, failClosed: true,
    });
    if (!resetLimit.allowed) return rateLimitResponse(json, resetLimit.retryAfter);
    return handleResetPassword(context, env, request, data);
  }

  return json({ ok: false, error: "Unknown action" }, 400);
}

// ==================== LOGIN ====================
async function handleLogin(context, env, request, { email, password }) {
  if (!email || !password) return json({ ok: false, error: "Email and password required" }, 400);
  if (typeof email !== "string" || email.length > 254 || typeof password !== "string" || password.length > MAX_PASSWORD_LENGTH) {
    return json({ ok: false, error: "Invalid email or password" }, 401);
  }

  const headers = sbHeaders(env);
  const normalisedEmail = normaliseEmail(email);
  const identifierHash = await hashIdentifier(normalisedEmail);
  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/partners?email=eq.${encodeURIComponent(normalisedEmail)}&active=eq.true&status=eq.approved&select=id,email,name,company,password_hash&limit=1`,
    { headers },
  );
  if (!res.ok) return json({ ok: false, error: "Database error" }, 500);
  const rows = await res.json();
  if (rows.length === 0) {
    // Do comparable password work even when no approved account exists so
    // response timing does not reveal whether an address is registered.
    await hashPassword(password, "00000000000000000000000000000000");
    queueSecurityEvent(context, env, request, {
      eventType: "partner_login_rejected",
      actorType: "anonymous",
      success: false,
      identifierHash,
      metadata: { reason: "invalid_credentials" },
    });
    return json({ ok: false, error: "Invalid email or password" }, 401);
  }

  const partner = rows[0];

  const verified = await verifyPassword(password, partner.password_hash);
  if (!verified) {
    queueSecurityEvent(context, env, request, {
      eventType: "partner_login_rejected",
      actorType: "anonymous",
      success: false,
      identifierHash,
      metadata: { reason: "invalid_credentials" },
    });
    return json({ ok: false, error: "Invalid email or password" }, 401);
  }

  // Opportunistically upgrade legacy unsalted SHA-256 hashes to PBKDF2 on next login.
  if (isLegacyHash(partner.password_hash)) {
    try {
      const upgraded = await hashPassword(password);
      await fetch(`${env.SUPABASE_URL}/rest/v1/partners?id=eq.${partner.id}`, {
        method: "PATCH",
        headers: { ...headers, "Prefer": "return=minimal" },
        body: JSON.stringify({ password_hash: upgraded }),
      });
    } catch {
      console.error(JSON.stringify({ message: "password_hash_upgrade_failed" }));
    }
  }

  // Create session token
  const token = generateToken(64);
  const tokenHash = await hashOpaqueToken(token);
  const expiresAt = new Date(Date.now() + PARTNER_SESSION_SECONDS * 1000).toISOString();

  const sessRes = await fetch(`${env.SUPABASE_URL}/rest/v1/partner_sessions`, {
    method: "POST",
    headers: { ...headers, "Prefer": "return=minimal" },
    body: JSON.stringify({ partner_id: partner.id, token: tokenHash, expires_at: expiresAt }),
  });
  if (!sessRes.ok) return json({ ok: false, error: "Failed to create session" }, 500);

  queueSecurityEvent(context, env, request, {
    eventType: "partner_login_succeeded",
    actorType: "partner",
    success: true,
    identifierHash,
    metadata: { partner_id: partner.id },
  });

  return json({
    ok: true,
    partner: { id: partner.id, email: partner.email, name: partner.name, company: partner.company },
  }, 200, { "Set-Cookie": sessionCookie(PARTNER_COOKIE, token, PARTNER_SESSION_SECONDS) });
}

// ==================== VERIFY ====================
async function handleVerify(env, request, data) {
  const token = getCookie(request, PARTNER_COOKIE) || data.token;
  if (!token) return json({ ok: false, error: "Token required" }, 400);
  const partner = await getPartnerFromToken(env, token);
  if (!partner) return json({ ok: false, error: "Invalid or expired session" }, 401);
  return json({ ok: true, partner });
}

// ==================== LOGOUT ====================
async function handleLogout(context, env, request, data) {
  const token = getCookie(request, PARTNER_COOKIE) || data.token;
  const logoutHeaders = {
    "Set-Cookie": clearCookie(PARTNER_COOKIE),
    "Clear-Site-Data": '"cache", "storage"',
  };
  if (!token) return json({ ok: true }, 200, logoutHeaders);
  const headers = sbHeaders(env);
  const tokenHash = await hashOpaqueToken(token);
  await deleteSessionByEitherToken(env, tokenHash, token, headers);
  queueSecurityEvent(context, env, request, {
    eventType: "partner_logout",
    actorType: "partner",
    success: true,
  });
  return json({ ok: true }, 200, logoutHeaders);
}

// ==================== REQUEST (self-service, pending approval) ====================
async function handleRequest(context, env, request, { email, name, company, phone, message }) {
  if (!email || !name) {
    return json({ ok: false, error: "Name and email are required" }, 400);
  }
  // The signup form marks company required; enforce here so a scripted POST
  // can't slip an empty company through.
  if (!company || !String(company).trim()) {
    return json({ ok: false, error: "Company / business name is required" }, 400);
  }
  if (typeof email !== "string" || email.length > 254 || !/^\S+@\S+\.\S+$/.test(email)) {
    return json({ ok: false, error: "A valid email address is required" }, 400);
  }

  const cleanEmail = normaliseEmail(email);
  const cleanName = boundedText(name, 120);
  const cleanCompany = boundedText(company, 160);
  const cleanPhone = boundedText(phone, 40, true);
  const cleanMessage = boundedText(message, 2000, true);
  if (!cleanName || !cleanCompany) {
    return json({ ok: false, error: "Name and company are required" }, 400);
  }
  if (cleanPhone === null || cleanMessage === null) {
    return json({ ok: false, error: "One or more fields are too long" }, 400);
  }
  const headers = sbHeaders(env);

  // Check if email already exists
  const checkRes = await fetch(
    `${env.SUPABASE_URL}/rest/v1/partners?email=eq.${encodeURIComponent(cleanEmail)}&select=id,status&limit=1`,
    { headers },
  );
  if (checkRes.ok) {
    const existing = await checkRes.json();
    if (existing.length > 0) {
      if (existing[0].status === "pending") {
        return json({ ok: true, message: partnerRequestMessage() });
      }
      if (existing[0].status === "approved") {
        return json({ ok: true, message: partnerRequestMessage() });
      }
      // If declined, allow re-request by updating. Preserve declined_at as audit history.
      const hash = await hashPassword(generateToken(32));
      await fetch(`${env.SUPABASE_URL}/rest/v1/partners?id=eq.${existing[0].id}`, {
        method: "PATCH",
        headers: { ...headers, "Prefer": "return=minimal" },
        body: JSON.stringify({
          password_hash: hash,
          name: cleanName,
          company: cleanCompany,
          phone: cleanPhone || null,
          notes: cleanMessage || null,
          status: "pending",
          active: true,
        }),
      });
      await sendPartnerRequestEmails(env, {
        name: cleanName, email: cleanEmail, company: cleanCompany, phone: cleanPhone, message: cleanMessage,
      });
      queueSecurityEvent(context, env, request, {
        eventType: "partner_access_requested",
        actorType: "anonymous",
        success: true,
        identifierHash: await hashIdentifier(cleanEmail),
        metadata: { resubmitted: true },
      });
      return json({ ok: true, message: partnerRequestMessage() });
    }
  }

  // Access requests do not establish credentials. The value is random and
  // unknowable; approval sends a one-time password-setup link to the mailbox.
  const hash = await hashPassword(generateToken(32));
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/partners`, {
    method: "POST",
    headers: { ...headers, "Prefer": "return=representation" },
    body: JSON.stringify({
      email: cleanEmail,
      password_hash: hash,
      name: cleanName,
      company: cleanCompany,
      phone: cleanPhone || null,
      notes: cleanMessage || null,
      status: "pending",
      active: true,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    if (errText.includes("duplicate")) {
      return json({ ok: true, message: partnerRequestMessage() });
    }
    return json({ ok: false, error: "Failed to submit request" }, 500);
  }

  await sendPartnerRequestEmails(env, {
    name: cleanName, email: cleanEmail, company: cleanCompany, phone: cleanPhone, message: cleanMessage,
  });
  queueSecurityEvent(context, env, request, {
    eventType: "partner_access_requested",
    actorType: "anonymous",
    success: true,
    identifierHash: await hashIdentifier(cleanEmail),
    metadata: { resubmitted: false },
  });
  return json({ ok: true, message: partnerRequestMessage() });
}

// ==================== FORGOT PASSWORD ====================
async function handleForgotPassword(context, env, request, { email }) {
  // Always return success to prevent email enumeration
  const successMsg = forgotPasswordMessage();
  if (!email || typeof email !== "string" || email.length > 254) return json({ ok: true, message: successMsg });

  const headers = sbHeaders(env);
  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/partners?email=eq.${encodeURIComponent(email.trim().toLowerCase())}&active=eq.true&status=eq.approved&select=id,name,email&limit=1`,
    { headers },
  );
  if (!res.ok) return json({ ok: true, message: successMsg });
  const rows = await res.json();
  if (rows.length === 0) return json({ ok: true, message: successMsg });

  const partner = rows[0];
  const token = generateToken(32);
  const tokenHash = await hashOpaqueToken(token);
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hour

  // Keep only one live reset token per partner. A newly requested link
  // invalidates older links, reducing replay and mailbox-forwarding risk.
  await fetch(`${env.SUPABASE_URL}/rest/v1/password_reset_tokens?partner_id=eq.${partner.id}`, {
    method: "DELETE",
    headers,
  });

  // Save reset token
  const insertRes = await fetch(`${env.SUPABASE_URL}/rest/v1/password_reset_tokens`, {
    method: "POST",
    headers: { ...headers, "Prefer": "return=minimal" },
    body: JSON.stringify({ partner_id: partner.id, token: tokenHash, expires_at: expiresAt }),
  });
  if (!insertRes.ok) {
    console.error(JSON.stringify({ message: "password_reset_token_write_failed", status: insertRes.status }));
    return json({ ok: true, message: successMsg });
  }

  // Send reset email via Resend
  if (!env.RESEND_API_KEY) {
    console.error("RESEND_API_KEY not set — cannot send password reset email");
  } else {
    // Keep the one-time token in the URL fragment so it is not sent in HTTP
    // requests, server logs, analytics URLs or Referer headers.
    const resetUrl = `https://searsmelvin.co.uk/partner#reset=${token}`;
    const firstName = (partner.name || "").split(" ")[0] || "there";
    try {
      const emailRes = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { "Authorization": `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: "Sears Melvin Memorials <info@searsmelvin.co.uk>",
          to: partner.email,
          subject: "Password Reset — Sears Melvin Partner Portal",
          html: `<div style="font-family:-apple-system,sans-serif;max-width:480px;margin:0 auto;padding:2rem;">
            <h2 style="font-family:Georgia,serif;color:#2C2C2C;font-weight:400;">Password Reset</h2>
            <p>Hi ${esc(firstName)},</p>
            <p>We received a request to reset your Partner Portal password. Click the button below to set a new password:</p>
            <p style="text-align:center;margin:2rem 0;">
              <a href="${resetUrl}" style="background:#2C2C2C;color:white;padding:0.75rem 2rem;border-radius:6px;text-decoration:none;font-size:1rem;display:inline-block;">Reset Password</a>
            </p>
            <p style="color:#666;font-size:0.85rem;">This link expires in 1 hour. If you didn't request this, you can safely ignore this email.</p>
            <hr style="border:none;border-top:1px solid #E0DCD5;margin:2rem 0;">
            <p style="color:#999;font-size:0.75rem;">Sears Melvin Memorials &mdash; Partner Portal</p>
          </div>`,
        }),
      });
      if (!emailRes.ok) {
        console.error(JSON.stringify({ message: "password_reset_email_failed", status: emailRes.status }));
      }
    } catch {
      console.error(JSON.stringify({ message: "password_reset_email_unavailable" }));
    }
  }

  queueSecurityEvent(context, env, request, {
    eventType: "partner_password_reset_requested",
    actorType: "anonymous",
    success: true,
    identifierHash: await hashIdentifier(partner.email.toLowerCase()),
    metadata: { partner_id: partner.id },
  });

  return json({ ok: true, message: successMsg });
}

// ==================== RESET PASSWORD ====================
async function handleResetPassword(context, env, request, { token, password }) {
  if (!token || !password) return json({ ok: false, error: "Token and new password are required" }, 400);
  if (typeof token !== "string" || token.length > 256 || !validPassword(password)) {
    return json({ ok: false, error: `Password must be ${MIN_PASSWORD_LENGTH}-${MAX_PASSWORD_LENGTH} characters` }, 400);
  }

  const headers = sbHeaders(env);
  const now = new Date().toISOString();

  // Find valid reset token
  const tokenHash = await hashOpaqueToken(token);
  let rows = await findResetToken(env, tokenHash, now, headers);
  if (rows === null) return json({ ok: false, error: "Database error" }, 500);
  // Compatibility for reset links issued before token hashing. New tokens are
  // always stored hashed and cannot be recovered from a database read.
  if (rows.length === 0) rows = await findResetToken(env, token, now, headers) || [];
  if (rows.length === 0) return json({ ok: false, error: "This reset link is invalid or has expired. Please request a new one." }, 400);

  const resetRecord = rows[0];
  const compromised = await isCompromisedPassword(password);
  if (compromised === null) {
    return json({
      ok: false,
      error: "Password safety checking is temporarily unavailable. Please try again shortly.",
    }, 503);
  }
  if (compromised) {
    queueSecurityEvent(context, env, request, {
      eventType: "partner_password_rejected",
      actorType: "partner",
      success: false,
      metadata: { partner_id: resetRecord.partner_id, reason: "known_breach" },
    });
    return json({
      ok: false,
      error: "Choose a password that has not appeared in known data breaches.",
    }, 400);
  }
  const hash = await hashPassword(password);

  // Atomically consume the one-time token before changing the password. A
  // concurrent replay receives no row and cannot reset the account twice.
  const consumeRes = await fetch(
    `${env.SUPABASE_URL}/rest/v1/password_reset_tokens?id=eq.${resetRecord.id}&used=eq.false`,
    {
      method: "PATCH",
      headers: { ...headers, "Prefer": "return=representation" },
      body: JSON.stringify({ used: true, used_at: new Date().toISOString() }),
    },
  );
  if (!consumeRes.ok) return json({ ok: false, error: "Failed to consume reset token" }, 500);
  const consumedRows = await consumeRes.json();
  if (consumedRows.length === 0) {
    return json({ ok: false, error: "This reset link is invalid or has expired. Please request a new one." }, 400);
  }

  // Update partner password
  const updateRes = await fetch(`${env.SUPABASE_URL}/rest/v1/partners?id=eq.${resetRecord.partner_id}`, {
    method: "PATCH",
    headers: { ...headers, "Prefer": "return=minimal" },
    body: JSON.stringify({ password_hash: hash, updated_at: new Date().toISOString() }),
  });
  if (!updateRes.ok) return json({ ok: false, error: "Failed to update password" }, 500);

  // Invalidate all existing sessions for this partner (security)
  await fetch(`${env.SUPABASE_URL}/rest/v1/partner_sessions?partner_id=eq.${resetRecord.partner_id}`, {
    method: "DELETE",
    headers,
  });

  queueSecurityEvent(context, env, request, {
    eventType: "partner_password_reset_succeeded",
    actorType: "partner",
    success: true,
    metadata: { partner_id: resetRecord.partner_id },
  });

  return json({ ok: true, message: "Password updated successfully. You can now sign in with your new password." });
}

// ==================== HELPERS ====================
async function isCompromisedPassword(password) {
  try {
    // HIBP's k-anonymity API only receives the first five characters of a
    // SHA-1 hash. The password and complete hash never leave this Worker.
    const digest = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(password));
    const fullHash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0"))
      .join("")
      .toUpperCase();
    const prefix = fullHash.slice(0, 5);
    const suffix = fullHash.slice(5);
    const response = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
      headers: {
        "Add-Padding": "true",
        "User-Agent": "SearsMelvin-PartnerPortal/1.0",
      },
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) {
      console.error(JSON.stringify({ message: "pwned_password_check_failed", status: response.status }));
      return null;
    }
    const range = await response.text();
    return range.split(/\r?\n/).some((line) => {
      const [candidate, count] = line.split(":", 2);
      return candidate === suffix && Number(count) > 0;
    });
  } catch {
    // Fail closed: a password is not accepted unless its breach status was
    // actually checked. The one-time reset token remains unused for a retry.
    console.error(JSON.stringify({ message: "pwned_password_check_unavailable" }));
    return null;
  }
}

async function getPartnerFromToken(env, token) {
  const headers = sbHeaders(env);
  const now = new Date().toISOString();

  const tokenHash = await hashOpaqueToken(token);
  let sessRows = await findPartnerSession(env, tokenHash, now, headers);
  if (sessRows === null) return null;
  // Compatibility for sessions issued before cookie/hash hardening. They expire
  // within seven days and are never issued by the new code.
  if (sessRows.length === 0) sessRows = await findPartnerSession(env, token, now, headers) || [];
  if (sessRows.length === 0) return null;

  const partnerId = sessRows[0].partner_id;
  const partRes = await fetch(
    `${env.SUPABASE_URL}/rest/v1/partners?id=eq.${partnerId}&active=eq.true&status=eq.approved&select=id,email,name,company&limit=1`,
    { headers },
  );
  if (!partRes.ok) return null;
  const partRows = await partRes.json();
  return partRows.length > 0 ? partRows[0] : null;
}

// PBKDF2-SHA256 with a per-user random salt. Format:
//   pbkdf2$<iterations>$<saltHex>$<hashHex>
// Legacy unsalted SHA-256 hashes (64 hex chars, no '$') are still verified, then
// transparently upgraded on the next successful login.
const PBKDF2_ITERATIONS = 600000;
const PBKDF2_KEYLEN_BITS = 256;
const PBKDF2_SALT_BYTES = 16;

async function hashPassword(password, saltHex = null, iterations = PBKDF2_ITERATIONS) {
  const salt = saltHex ? hexToBytes(saltHex) : crypto.getRandomValues(new Uint8Array(PBKDF2_SALT_BYTES));
  const baseKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveBits"],
  );
  const derived = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    baseKey,
    PBKDF2_KEYLEN_BITS,
  );
  return `pbkdf2$${iterations}$${bytesToHex(salt)}$${bytesToHex(new Uint8Array(derived))}`;
}

async function verifyPassword(password, stored) {
  if (!stored) return false;
  if (isLegacyHash(stored)) {
    const legacy = await sha256Hex(password);
    return timingSafeEqual(legacy, stored);
  }
  const parts = stored.split("$");
  if (parts.length !== 4 || parts[0] !== "pbkdf2") return false;
  const iterations = parseInt(parts[1], 10);
  if (!Number.isFinite(iterations) || iterations < 100000 || iterations > 1000000) return false;
  if (!/^[0-9a-f]{32}$/i.test(parts[2]) || !/^[0-9a-f]{64}$/i.test(parts[3])) return false;
  const candidate = await hashPassword(password, parts[2], iterations);
  return timingSafeEqual(candidate, stored);
}

function isLegacyHash(stored) {
  return typeof stored === "string" && !stored.includes("$") && /^[0-9a-f]{64}$/i.test(stored);
}

async function sha256Hex(input) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return bytesToHex(new Uint8Array(buf));
}

function bytesToHex(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += bytes[i].toString(16).padStart(2, "0");
  return s;
}

function hexToBytes(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

function timingSafeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function generateToken(length = 64) {
  const arr = new Uint8Array(length);
  crypto.getRandomValues(arr);
  return Array.from(arr, b => b.toString(16).padStart(2, "0")).join("");
}

function validPassword(password) {
  return typeof password === "string"
    && password.length >= MIN_PASSWORD_LENGTH
    && password.length <= MAX_PASSWORD_LENGTH;
}

async function hashOpaqueToken(token) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return "sha256:" + bytesToHex(new Uint8Array(digest));
}

function getCookie(request, name) {
  const cookieHeader = request.headers.get("Cookie") || "";
  for (const part of cookieHeader.split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    if (part.slice(0, index).trim() === name) return decodeURIComponent(part.slice(index + 1).trim());
  }
  return "";
}

function sessionCookie(name, value, maxAge) {
  return `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Strict`;
}

function clearCookie(name) {
  return `${name}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`;
}

async function findPartnerSession(env, token, now, headers) {
  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/partner_sessions?token=eq.${encodeURIComponent(token)}&expires_at=gt.${encodeURIComponent(now)}&select=partner_id&limit=1`,
    { headers },
  );
  return res.ok ? res.json() : null;
}

async function findResetToken(env, token, now, headers) {
  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/password_reset_tokens?token=eq.${encodeURIComponent(token)}&used=eq.false&expires_at=gt.${encodeURIComponent(now)}&select=id,partner_id&limit=1`,
    { headers },
  );
  return res.ok ? res.json() : null;
}

async function deleteSessionByEitherToken(env, tokenHash, legacyToken, headers) {
  await Promise.all([
    fetch(`${env.SUPABASE_URL}/rest/v1/partner_sessions?token=eq.${encodeURIComponent(tokenHash)}`, { method: "DELETE", headers }),
    fetch(`${env.SUPABASE_URL}/rest/v1/partner_sessions?token=eq.${encodeURIComponent(legacyToken)}`, { method: "DELETE", headers }),
  ]);
}

function sbHeaders(env) {
  return supabaseHeaders(env);
}

function json(data, status = 200, extraHeaders = {}) {
  return hardenedJson(data, status, extraHeaders);
}

function normaliseEmail(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function boundedText(value, maxLength, optional = false) {
  if (value == null || value === "") return optional ? "" : null;
  if (typeof value !== "string") return null;
  const clean = value.trim();
  if (clean.length === 0) return optional ? "" : null;
  return clean.length <= maxLength ? clean : null;
}

function forgotPasswordMessage() {
  return "If an account with that email exists, we've sent a password reset link.";
}

function partnerRequestMessage() {
  return "If this request can be accepted, our team will review it and contact you shortly.";
}

function esc(str) {
  return String(str || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

async function sendPartnerRequestEmails(env, { name, email, company, phone, message }) {
  if (!env.RESEND_API_KEY) {
    console.error("RESEND_API_KEY not set — cannot send partner request emails");
    return;
  }

  const firstName = (name || "").split(" ")[0] || "there";

  // Notify the business
  try {
    const emailRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: "Sears Melvin Memorials <info@searsmelvin.co.uk>",
        to: "info@searsmelvin.co.uk",
        subject: `New Partner Request — ${name}${company ? ` (${company})` : ""}`,
        html: `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#F5F3F0;font-family:-apple-system,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#F5F3F0;padding:24px 0;">
<tr><td align="center">
<table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border-radius:10px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.08);">
  <tr><td style="background:#2C2C2C;padding:18px 28px;">
    <table width="100%" cellpadding="0" cellspacing="0"><tr>
      <td><span style="font-family:Georgia,serif;font-size:18px;color:#fff;">Sears Melvin <span style="opacity:0.55;">Memorials</span></span></td>
      <td align="right"><span style="background:#8B7355;color:#fff;padding:4px 11px;border-radius:3px;font-size:11px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;">Partner Request</span></td>
    </tr></table>
  </td></tr>
  <tr><td style="padding:24px 28px;">
    <h2 style="font-family:Georgia,serif;font-size:20px;color:#2C2C2C;font-weight:normal;margin:0 0 16px;">New Partner Access Request</h2>
    <table width="100%" cellpadding="0" cellspacing="0" style="font-size:13px;margin-bottom:16px;">
      <tr><td style="color:#999;padding:5px 0;width:100px;">Name</td><td style="color:#1A1A1A;font-weight:600;">${esc(name)}</td></tr>
      <tr><td style="color:#999;padding:5px 0;">Email</td><td><a href="mailto:${esc(email)}" style="color:#8B7355;">${esc(email)}</a></td></tr>
      ${company ? `<tr><td style="color:#999;padding:5px 0;">Company</td><td style="color:#1A1A1A;">${esc(company)}</td></tr>` : ""}
      ${phone ? `<tr><td style="color:#999;padding:5px 0;">Phone</td><td style="color:#1A1A1A;">${esc(phone)}</td></tr>` : ""}
    </table>
    ${message ? `<div style="background:#F5F3F0;border-radius:8px;padding:16px 20px;">
      <div style="font-size:10px;letter-spacing:0.1em;text-transform:uppercase;color:#8B7355;font-weight:700;margin-bottom:8px;">Message</div>
      <p style="margin:0;font-size:13px;color:#1A1A1A;line-height:1.6;">${esc(message)}</p>
    </div>` : ""}
    <p style="margin-top:16px;font-size:13px;color:#555;">
      <a href="https://searsmelvin.co.uk/admin" style="color:#8B7355;font-weight:600;">Review in Admin Panel &rarr;</a>
    </p>
  </td></tr>
  <tr><td style="background:#F5F3F0;border-top:1px solid #E0DCD5;padding:12px 28px;text-align:center;">
    <span style="font-size:11px;color:#BBB;">Sears Melvin Memorials &middot; Partner Portal</span>
  </td></tr>
</table>
</td></tr></table></body></html>`,
      }),
    });
    if (!emailRes.ok) {
      console.error(JSON.stringify({ message: "partner_request_notification_failed", status: emailRes.status }));
    }
  } catch {
    console.error(JSON.stringify({ message: "partner_request_notification_unavailable" }));
  }

  // Confirm to the requester
  try {
    const emailRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: "Sears Melvin Memorials <info@searsmelvin.co.uk>",
        to: email,
        subject: "Partner request received — Sears Melvin Memorials",
        html: `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#F5F3F0;font-family:-apple-system,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#F5F3F0;padding:24px 0;">
<tr><td align="center">
<table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border-radius:10px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.08);">
  <tr><td style="background:#2C2C2C;padding:20px 28px;">
    <span style="font-family:Georgia,serif;font-size:18px;color:#fff;">Sears Melvin <span style="opacity:0.55;">Memorials</span></span>
  </td></tr>
  <tr><td style="padding:32px 28px;">
    <h2 style="font-family:Georgia,serif;font-size:22px;color:#2C2C2C;font-weight:normal;margin:0 0 12px;">Request received, ${esc(firstName)}.</h2>
    <p style="color:#555;font-size:15px;line-height:1.7;margin:0 0 20px;">
      Thank you for requesting access to the Sears Melvin Partner Portal. Our team will review your application and get back to you shortly.
    </p>
    <p style="color:#555;font-size:14px;line-height:1.7;margin:0 0 10px;">
      If approved, we'll email this address a one-time link to create your password. This verifies that you control the partner mailbox before access begins.
    </p>
    <p style="color:#555;font-size:14px;line-height:1.7;margin:20px 0 0;">
      If you have any questions, please contact us at <a href="mailto:info@searsmelvin.co.uk" style="color:#8B7355;">info@searsmelvin.co.uk</a>.
    </p>
    <hr style="border:none;border-top:1px solid #E0DCD5;margin:24px 0 16px;">
    <p style="color:#888;font-size:13px;margin:0;">With care,<br><strong style="color:#2C2C2C;">The Sears Melvin Team</strong></p>
  </td></tr>
  <tr><td style="background:#F5F3F0;border-top:1px solid #E0DCD5;padding:14px 28px;text-align:center;">
    <span style="font-size:11px;color:#BBB;">Sears Melvin Memorials &middot; <a href="mailto:info@searsmelvin.co.uk" style="color:#BBB;">info@searsmelvin.co.uk</a></span>
  </td></tr>
</table>
</td></tr></table></body></html>`,
      }),
    });
    if (!emailRes.ok) {
      console.error(JSON.stringify({ message: "partner_request_confirmation_failed", status: emailRes.status }));
    }
  } catch {
    console.error(JSON.stringify({ message: "partner_request_confirmation_unavailable" }));
  }
}

export { getPartnerFromToken, sbHeaders, json };
