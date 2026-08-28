/**
 * Partner Auth API — /api/partner-auth
 *
 * DEPRECATED. The public-site /partner UI is retired; the only partner
 * workspace is https://partner.searsmelvin.co.uk/. Do not add features here.
 * This Function is left in place so deploys keep working until a later PR
 * removes the leftover public-site partner stack.
 *
 * POST { action: "google-login", credential } → sign in SM staff with Google Workspace
 * POST { action: "request-magic-link", email } → email a short-lived link to an approved partner
 * POST { action: "consume-magic-link", token } → consume one-time link, set HttpOnly session cookie
 * POST { action: "verify" }                  → verify session cookie, return partner info
 * POST { action: "logout" }                  → invalidate session
 * POST { action: "request", email, name, company, phone, message } → self-service request (pending approval)
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
import { GoogleVerificationUnavailable, verifyGoogleIdToken } from "./_google-identity.js";

const PARTNER_COOKIE = "__Host-sm_partner_session";
const PARTNER_SESSION_SECONDS = 12 * 60 * 60;
const MAGIC_LINK_SECONDS = 15 * 60;
const MAGIC_TOKEN_RE = /^[0-9a-f]{64}$/;
const SM_WORKSPACE_DOMAIN = "searsmelvin.co.uk";

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
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY || !getInternalPartnerId(env)) {
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

  if (action === "google-login") {
    const loginLimit = await checkRateLimit(env, request, "partner-google-login-ip", getClientAddress(request), {
      maxAttempts: 10, windowSeconds: 900, blockSeconds: 1800, failClosed: true,
    });
    if (!loginLimit.allowed) {
      queueSecurityEvent(context, env, request, {
        eventType: "partner_google_login_rate_limited",
        actorType: "anonymous",
        success: false,
        metadata: { retry_after: loginLimit.retryAfter },
      });
      return rateLimitResponse(json, loginLimit.retryAfter);
    }
    return handleGoogleLogin(context, env, request, data);
  }
  if (action === "request-magic-link") {
    const normalisedEmail = normaliseEmail(data.email);
    const [ipLimit, emailLimit] = await Promise.all([
      checkRateLimit(env, request, "partner-magic-request-ip", getClientAddress(request), {
        maxAttempts: 8, windowSeconds: 3600, blockSeconds: 3600, failClosed: true,
      }),
      checkRateLimit(env, request, "partner-magic-request-email", normalisedEmail || "invalid", {
        maxAttempts: 3, windowSeconds: 3600, blockSeconds: 3600, failClosed: true,
      }),
    ]);
    if (!ipLimit.allowed || !emailLimit.allowed) {
      queueSecurityEvent(context, env, request, {
        eventType: "partner_magic_link_rate_limited",
        actorType: "anonymous",
        success: false,
        identifierHash: await hashIdentifier(normalisedEmail || "invalid"),
      });
      return json({ ok: true, message: magicLinkMessage() });
    }
    return handleMagicLinkRequest(context, env, request, data);
  }
  if (action === "consume-magic-link") {
    const tokenIdentifier = typeof data.token === "string" ? data.token : "invalid";
    const consumeLimit = await checkRateLimit(env, request, "partner-magic-consume", tokenIdentifier, {
      maxAttempts: 5, windowSeconds: 3600, blockSeconds: 3600, failClosed: true,
    });
    if (!consumeLimit.allowed) return rateLimitResponse(json, consumeLimit.retryAfter);
    return handleMagicLinkConsume(context, env, request, data);
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
  return json({ ok: false, error: "Unknown action" }, 400);
}

// ==================== GOOGLE WORKSPACE SIGN-IN ====================
async function handleGoogleLogin(context, env, request, { credential }) {
  if (!credential) return json({ ok: false, error: "Missing credential" }, 400);
  if (!env.GOOGLE_CLIENT_ID) return json({ ok: false, error: "Google sign-in not configured" }, 500);

  let payload;
  try {
    payload = await verifyGoogleIdToken(credential, env.GOOGLE_CLIENT_ID);
  } catch (error) {
    if (error instanceof GoogleVerificationUnavailable) {
      return json({ ok: false, error: "Google verification is temporarily unavailable" }, 502);
    }
    queueSecurityEvent(context, env, request, {
      eventType: "partner_google_login_rejected",
      actorType: "anonymous",
      success: false,
      metadata: { reason: "invalid_google_credential" },
    });
    return json({ ok: false, error: "Invalid Google credential" }, 401);
  }

  if (payload.email_verified !== "true" && payload.email_verified !== true) {
    return json({ ok: false, error: "Google email is not verified" }, 401);
  }
  if (typeof payload.email !== "string" || payload.email.length > 254) {
    return json({ ok: false, error: "Invalid Google credential" }, 401);
  }

  const email = normaliseEmail(payload.email);
  const domainEmail = new RegExp(`^[a-z0-9._%+-]{1,64}@${SM_WORKSPACE_DOMAIN.replaceAll(".", "\\.")}$`);
  if (!domainEmail.test(email) || payload.hd !== SM_WORKSPACE_DOMAIN) {
    queueSecurityEvent(context, env, request, {
      eventType: "partner_google_login_rejected",
      actorType: "anonymous",
      success: false,
      identifierHash: await hashIdentifier(email || "invalid"),
      metadata: { reason: "workspace_domain" },
    });
    return json({ ok: false, error: "Use an authorised searsmelvin.co.uk Google Workspace account" }, 403);
  }

  const internalPartnerId = getInternalPartnerId(env);
  const headers = sbHeaders(env);
  const partnerRes = await fetch(
    `${env.SUPABASE_URL}/rest/v1/partners?id=eq.${encodeURIComponent(internalPartnerId)}&active=eq.true&status=eq.approved&select=id,email,name,company&limit=1`,
    { headers },
  );
  if (!partnerRes.ok) return json({ ok: false, error: "Internal workspace is temporarily unavailable" }, 503);
  const partners = await partnerRes.json();
  if (partners.length === 0) return json({ ok: false, error: "Internal workspace is not configured" }, 500);

  const sessionToken = await createPartnerSession(env, partners[0].id, headers);
  if (!sessionToken) return json({ ok: false, error: "Failed to create session" }, 500);

  queueSecurityEvent(context, env, request, {
    eventType: "partner_google_login_succeeded",
    actorType: "partner",
    success: true,
    identifierHash: await hashIdentifier(email),
    metadata: { partner_id: partners[0].id, auth_method: "google_workspace" },
  });

  return json({ ok: true, partner: partners[0] }, 200, {
    "Set-Cookie": sessionCookie(PARTNER_COOKIE, sessionToken, PARTNER_SESSION_SECONDS),
  });
}

// ==================== PASSWORDLESS PARTNER SIGN-IN ====================
async function handleMagicLinkRequest(context, env, request, { email }) {
  const success = json({ ok: true, message: magicLinkMessage() });
  if (typeof email !== "string" || email.length > 254 || !/^\S+@\S+\.\S+$/.test(email)) return success;
  const headers = sbHeaders(env);
  const normalisedEmail = normaliseEmail(email);
  const identifierHash = await hashIdentifier(normalisedEmail);
  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/partners?email=eq.${encodeURIComponent(normalisedEmail)}&active=eq.true&status=eq.approved&select=id,email,name,company&limit=1`,
    { headers },
  );
  if (!res.ok) return success;
  const rows = await res.json();
  if (rows.length === 0) {
    queueSecurityEvent(context, env, request, {
      eventType: "partner_magic_link_requested",
      actorType: "anonymous",
      success: true,
      identifierHash,
      metadata: { eligible: false },
    });
    return success;
  }

  const partner = rows[0];
  if (String(partner.id) === getInternalPartnerId(env)) {
    // Internal staff authenticate through Google Workspace only. A mailbox
    // link here would bypass Workspace account suspension and access policy.
    await fetch(`${env.SUPABASE_URL}/rest/v1/partner_magic_link_tokens?partner_id=eq.${encodeURIComponent(partner.id)}`, {
      method: "DELETE",
      headers,
    });
    queueSecurityEvent(context, env, request, {
      eventType: "partner_magic_link_requested",
      actorType: "anonymous",
      success: true,
      identifierHash,
      metadata: { eligible: false, reason: "internal_google_only" },
    });
    return success;
  }
  const token = generateToken(32);
  const expiresAt = new Date(Date.now() + MAGIC_LINK_SECONDS * 1000).toISOString();
  const revokeRes = await fetch(`${env.SUPABASE_URL}/rest/v1/partner_magic_link_tokens?partner_id=eq.${partner.id}`, {
    method: "DELETE",
    headers,
  });
  if (!revokeRes.ok) {
    console.error(JSON.stringify({ message: "partner_magic_link_revoke_failed", status: revokeRes.status }));
    return success;
  }
  const tokenRes = await fetch(`${env.SUPABASE_URL}/rest/v1/partner_magic_link_tokens`, {
    method: "POST",
    headers: { ...headers, "Prefer": "return=minimal" },
    body: JSON.stringify({
      partner_id: partner.id,
      token_hash: await hashOpaqueToken(token),
      expires_at: expiresAt,
    }),
  });
  if (!tokenRes.ok) {
    console.error(JSON.stringify({ message: "partner_magic_link_write_failed", status: tokenRes.status }));
    return success;
  }

  queueEmail(context, sendPartnerMagicLinkEmail(env, partner, token));

  queueSecurityEvent(context, env, request, {
    eventType: "partner_magic_link_requested",
    actorType: "anonymous",
    success: true,
    identifierHash,
    metadata: { partner_id: partner.id, eligible: true },
  });
  return success;
}

async function handleMagicLinkConsume(context, env, request, { token }) {
  if (typeof token !== "string" || !MAGIC_TOKEN_RE.test(token)) {
    return invalidMagicLinkResponse();
  }

  const headers = sbHeaders(env);
  const now = new Date().toISOString();
  const tokenHash = await hashOpaqueToken(token);
  const findRes = await fetch(
    `${env.SUPABASE_URL}/rest/v1/partner_magic_link_tokens?token_hash=eq.${encodeURIComponent(tokenHash)}&consumed_at=is.null&expires_at=gt.${encodeURIComponent(now)}&select=id,partner_id&limit=1`,
    { headers },
  );
  if (!findRes.ok) return json({ ok: false, error: "Sign-in is temporarily unavailable" }, 503);
  const links = await findRes.json();
  if (links.length === 0) return invalidMagicLinkResponse();

  const link = links[0];
  if (String(link.partner_id) === getInternalPartnerId(env)) {
    // Reject links created before this rule or by an older admin deployment.
    await fetch(`${env.SUPABASE_URL}/rest/v1/partner_magic_link_tokens?id=eq.${encodeURIComponent(link.id)}`, {
      method: "DELETE",
      headers,
    });
    return invalidMagicLinkResponse();
  }
  const partnerRes = await fetch(
    `${env.SUPABASE_URL}/rest/v1/partners?id=eq.${link.partner_id}&active=eq.true&status=eq.approved&select=id,email,name,company&limit=1`,
    { headers },
  );
  if (!partnerRes.ok) return json({ ok: false, error: "Sign-in is temporarily unavailable" }, 503);
  const partners = await partnerRes.json();
  if (partners.length === 0) return invalidMagicLinkResponse();

  const consumeRes = await fetch(
    `${env.SUPABASE_URL}/rest/v1/partner_magic_link_tokens?id=eq.${link.id}&consumed_at=is.null&expires_at=gt.${encodeURIComponent(now)}`,
    {
      method: "PATCH",
      headers: { ...headers, "Prefer": "return=representation" },
      body: JSON.stringify({ consumed_at: now }),
    },
  );
  if (!consumeRes.ok) return json({ ok: false, error: "Sign-in is temporarily unavailable" }, 503);
  const consumed = await consumeRes.json();
  if (consumed.length === 0) return invalidMagicLinkResponse();

  const sessionToken = await createPartnerSession(env, link.partner_id, headers);
  if (!sessionToken) return json({ ok: false, error: "Failed to create session" }, 500);

  const partner = partners[0];
  queueEmail(context, sendPartnerSignInNotice(env, partner));
  queueSecurityEvent(context, env, request, {
    eventType: "partner_magic_link_consumed",
    actorType: "partner",
    success: true,
    identifierHash: await hashIdentifier(partner.email),
    metadata: { partner_id: partner.id },
  });

  return json({
    ok: true,
    partner: { id: partner.id, email: partner.email, name: partner.name, company: partner.company },
  }, 200, { "Set-Cookie": sessionCookie(PARTNER_COOKIE, sessionToken, PARTNER_SESSION_SECONDS) });
}

// ==================== VERIFY ====================
async function handleVerify(env, request, data) {
  const token = getCookie(request, PARTNER_COOKIE);
  if (!token) return json({ ok: false, error: "Token required" }, 400);
  const partner = await getPartnerFromToken(env, token);
  if (!partner) return json({ ok: false, error: "Invalid or expired session" }, 401);
  return json({ ok: true, partner });
}

// ==================== LOGOUT ====================
async function handleLogout(context, env, request, data) {
  const token = getCookie(request, PARTNER_COOKIE);
  const logoutHeaders = {
    "Set-Cookie": clearCookie(PARTNER_COOKIE),
    "Clear-Site-Data": '"cache", "storage"',
  };
  if (!token) return json({ ok: true }, 200, logoutHeaders);
  const headers = sbHeaders(env);
  const tokenHash = await hashOpaqueToken(token);
  await deleteSession(env, tokenHash, headers);
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
      await fetch(`${env.SUPABASE_URL}/rest/v1/partners?id=eq.${existing[0].id}`, {
        method: "PATCH",
        headers: { ...headers, "Prefer": "return=minimal" },
        body: JSON.stringify({
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

  // Access requests do not establish credentials. Approval enables the exact
  // mailbox, which can then request a short-lived, one-time sign-in link.
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/partners`, {
    method: "POST",
    headers: { ...headers, "Prefer": "return=representation" },
    body: JSON.stringify({
      email: cleanEmail,
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

// ==================== HELPERS ====================
async function getPartnerFromToken(env, token) {
  const headers = sbHeaders(env);
  const now = new Date().toISOString();

  const tokenHash = await hashOpaqueToken(token);
  const sessRows = await findPartnerSession(env, tokenHash, now, headers);
  if (sessRows === null) return null;
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

async function createPartnerSession(env, partnerId, headers = sbHeaders(env)) {
  const sessionToken = generateToken(64);
  const expiresAt = new Date(Date.now() + PARTNER_SESSION_SECONDS * 1000).toISOString();
  const sessionRes = await fetch(`${env.SUPABASE_URL}/rest/v1/partner_sessions`, {
    method: "POST",
    headers: { ...headers, "Prefer": "return=minimal" },
    body: JSON.stringify({
      partner_id: partnerId,
      token: await hashOpaqueToken(sessionToken),
      expires_at: expiresAt,
    }),
  });
  return sessionRes.ok ? sessionToken : null;
}

function bytesToHex(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += bytes[i].toString(16).padStart(2, "0");
  return s;
}

function generateToken(length = 64) {
  const arr = new Uint8Array(length);
  crypto.getRandomValues(arr);
  return Array.from(arr, b => b.toString(16).padStart(2, "0")).join("");
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

async function deleteSession(env, tokenHash, headers) {
  await fetch(`${env.SUPABASE_URL}/rest/v1/partner_sessions?token=eq.${encodeURIComponent(tokenHash)}`, {
    method: "DELETE",
    headers,
  });
}

function getInternalPartnerId(env) {
  const value = String(env.SM_INTERNAL_PARTNER_ID || "").trim();
  return /^[1-9]\d{0,9}$/.test(value) ? value : "";
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

function magicLinkMessage() {
  return "If that email belongs to an approved partner, we've sent a secure sign-in link.";
}

function invalidMagicLinkResponse() {
  return json({
    ok: false,
    error: "This sign-in link is invalid, expired, or has already been used. Request a new link.",
  }, 400);
}

function partnerRequestMessage() {
  return "If this request can be accepted, our team will review it and contact you shortly.";
}

function queueEmail(context, task) {
  if (typeof context.waitUntil === "function") context.waitUntil(task);
  else void task;
}

async function sendPartnerMagicLinkEmail(env, partner, token) {
  if (!env.RESEND_API_KEY) {
    console.error(JSON.stringify({ message: "partner_magic_link_email_not_configured" }));
    return;
  }
  const firstName = String(partner.name || "").trim().split(/\s+/)[0] || "there";
  // Leftover public-site URL: /partner now redirects to partner.searsmelvin.co.uk.
  // Do not build new partner email flows here; this sender is deprecated with the UI.
  const loginUrl = `https://searsmelvin.co.uk/partner#login=${encodeURIComponent(token)}`;
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: "Sears Melvin Memorials <info@searsmelvin.co.uk>",
        to: partner.email,
        subject: "Your secure Partner Portal sign-in link",
        html: `<!DOCTYPE html><html><body style="margin:0;padding:24px;background:#F5F3F0;font-family:-apple-system,sans-serif;color:#2C2C2C;">
          <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:10px;padding:32px;">
            <h2 style="font-family:Georgia,serif;font-weight:400;">Sign in to the Partner Portal</h2>
            <p>Hi ${esc(firstName)},</p>
            <p>Use the one-time button below to sign in. No password is required.</p>
            <p style="text-align:center;margin:28px 0;"><a href="${loginUrl}" style="display:inline-block;background:#2C2C2C;color:#fff;text-decoration:none;padding:12px 24px;border-radius:6px;">Sign in securely</a></p>
            <p style="font-size:13px;color:#666;">This link expires in 15 minutes and works once. If you did not request it, you can safely ignore this email.</p>
          </div>
        </body></html>`,
      }),
    });
    if (!response.ok) {
      console.error(JSON.stringify({ message: "partner_magic_link_email_failed", status: response.status }));
    }
  } catch {
    console.error(JSON.stringify({ message: "partner_magic_link_email_unavailable" }));
  }
}

async function sendPartnerSignInNotice(env, partner) {
  if (!env.RESEND_API_KEY) return;
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: "Sears Melvin Memorials <info@searsmelvin.co.uk>",
        to: partner.email,
        subject: "New Partner Portal sign-in",
        html: `<div style="font-family:-apple-system,sans-serif;max-width:520px;margin:0 auto;padding:32px;color:#2C2C2C;">
          <h2 style="font-family:Georgia,serif;font-weight:400;">New sign-in confirmed</h2>
          <p>A secure email link was just used to sign in to your Sears Melvin Partner Portal.</p>
          <p style="font-size:13px;color:#666;">If this was not you, contact <a href="mailto:info@searsmelvin.co.uk">info@searsmelvin.co.uk</a> immediately so we can disable access.</p>
        </div>`,
      }),
    });
    if (!response.ok) {
      console.error(JSON.stringify({ message: "partner_sign_in_notice_failed", status: response.status }));
    }
  } catch {
    console.error(JSON.stringify({ message: "partner_sign_in_notice_unavailable" }));
  }
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
      If approved, this address can request a short-lived, one-time sign-in link. This verifies that you control the partner mailbox before access begins.
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
