/**
 * Partner Auth API — /api/partner-auth
 *
 * POST { action: "login", email, password }  → authenticate partner, return session token
 * POST { action: "verify", token }           → verify session token, return partner info
 * POST { action: "logout", token }           → invalidate session
 * POST { action: "register", email, password, name, company, adminKey } → create partner (admin only)
 * POST { action: "request", email, password, name, company, phone, message } → self-service request (pending approval)
 * POST { action: "forgot-password", email }      → send password reset email
 * POST { action: "reset-password", token, password } → set new password using reset token
 */

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method !== "POST") {
    return json({ ok: false, error: "Method not allowed" }, 405);
  }
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) {
    return json({ ok: false, error: "Server config error" }, 500);
  }

  let data;
  try { data = await request.json(); }
  catch { return json({ ok: false, error: "Invalid JSON" }, 400); }

  const { action } = data;

  if (action === "login") return handleLogin(env, data);
  if (action === "verify") return handleVerify(env, data);
  if (action === "logout") return handleLogout(env, data);
  if (action === "register") return handleRegister(env, data);
  if (action === "request") return handleRequest(env, data);
  if (action === "forgot-password") return handleForgotPassword(env, data);
  if (action === "reset-password") return handleResetPassword(env, data);

  return json({ ok: false, error: "Unknown action" }, 400);
}

// ==================== LOGIN ====================
async function handleLogin(env, { email, password }) {
  if (!email || !password) return json({ ok: false, error: "Email and password required" }, 400);

  const headers = sbHeaders(env);
  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/partners?email=eq.${encodeURIComponent(email.toLowerCase())}&active=eq.true&status=eq.approved&select=id,email,name,company,password_hash&limit=1`,
    { headers },
  );
  if (!res.ok) return json({ ok: false, error: "Database error" }, 500);
  const rows = await res.json();
  if (rows.length === 0) {
    // Check if they exist but are pending/declined
    const checkRes = await fetch(
      `${env.SUPABASE_URL}/rest/v1/partners?email=eq.${encodeURIComponent(email.toLowerCase())}&select=status&limit=1`,
      { headers },
    );
    if (checkRes.ok) {
      const checkRows = await checkRes.json();
      if (checkRows.length > 0 && checkRows[0].status === "pending") {
        return json({ ok: false, error: "Your account is awaiting approval. We'll be in touch soon." }, 401);
      }
      if (checkRows.length > 0 && checkRows[0].status === "declined") {
        return json({ ok: false, error: "Your account request was not approved. Please contact us for more information." }, 401);
      }
    }
    return json({ ok: false, error: "Invalid email or password" }, 401);
  }

  const partner = rows[0];

  const verified = await verifyPassword(password, partner.password_hash);
  if (!verified) {
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
    } catch (err) {
      console.error("Password hash upgrade failed:", err);
    }
  }

  // Create session token
  const token = generateToken(64);
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(); // 7 days

  const sessRes = await fetch(`${env.SUPABASE_URL}/rest/v1/partner_sessions`, {
    method: "POST",
    headers: { ...headers, "Prefer": "return=minimal" },
    body: JSON.stringify({ partner_id: partner.id, token, expires_at: expiresAt }),
  });
  if (!sessRes.ok) return json({ ok: false, error: "Failed to create session" }, 500);

  return json({
    ok: true,
    token,
    partner: { id: partner.id, email: partner.email, name: partner.name, company: partner.company },
  });
}

// ==================== VERIFY ====================
async function handleVerify(env, { token }) {
  if (!token) return json({ ok: false, error: "Token required" }, 400);
  const partner = await getPartnerFromToken(env, token);
  if (!partner) return json({ ok: false, error: "Invalid or expired session" }, 401);
  return json({ ok: true, partner });
}

// ==================== LOGOUT ====================
async function handleLogout(env, { token }) {
  if (!token) return json({ ok: true });
  const headers = sbHeaders(env);
  await fetch(`${env.SUPABASE_URL}/rest/v1/partner_sessions?token=eq.${encodeURIComponent(token)}`, {
    method: "DELETE",
    headers,
  });
  return json({ ok: true });
}

// ==================== REGISTER (admin only) ====================
async function handleRegister(env, { email, password, name, company, adminKey }) {
  // Require admin key to create partners
  if (!adminKey || adminKey !== env.PARTNER_ADMIN_KEY) {
    return json({ ok: false, error: "Unauthorized" }, 403);
  }
  if (!email || !password || !name) {
    return json({ ok: false, error: "Email, password, and name required" }, 400);
  }

  const headers = sbHeaders(env);
  const hash = await hashPassword(password);

  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/partners`, {
    method: "POST",
    headers: { ...headers, "Prefer": "return=representation" },
    body: JSON.stringify({
      email: email.toLowerCase(),
      password_hash: hash,
      name,
      company: company || null,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    if (errText.includes("duplicate")) {
      return json({ ok: false, error: "A partner with this email already exists" }, 409);
    }
    return json({ ok: false, error: "Failed to create partner" }, 500);
  }

  const rows = await res.json();
  return json({ ok: true, partner: { id: rows[0].id, email: rows[0].email, name: rows[0].name } });
}

// ==================== REQUEST (self-service, pending approval) ====================
async function handleRequest(env, { email, password, name, company, phone, message }) {
  if (!email || !password || !name) {
    return json({ ok: false, error: "Name, email, and password are required" }, 400);
  }
  // The signup form marks company required; enforce here so a scripted POST
  // can't slip an empty company through.
  if (!company || !String(company).trim()) {
    return json({ ok: false, error: "Company / business name is required" }, 400);
  }
  if (typeof password !== "string" || password.length < 6) {
    return json({ ok: false, error: "Password must be at least 6 characters" }, 400);
  }

  const headers = sbHeaders(env);

  // Check if email already exists
  const checkRes = await fetch(
    `${env.SUPABASE_URL}/rest/v1/partners?email=eq.${encodeURIComponent(email.toLowerCase())}&select=id,status&limit=1`,
    { headers },
  );
  if (checkRes.ok) {
    const existing = await checkRes.json();
    if (existing.length > 0) {
      if (existing[0].status === "pending") {
        return json({ ok: false, error: "A request with this email is already pending approval." }, 409);
      }
      if (existing[0].status === "approved") {
        return json({ ok: false, error: "An account with this email already exists. Please sign in." }, 409);
      }
      // If declined, allow re-request by updating. Preserve declined_at as audit history.
      const hash = await hashPassword(password);
      await fetch(`${env.SUPABASE_URL}/rest/v1/partners?id=eq.${existing[0].id}`, {
        method: "PATCH",
        headers: { ...headers, "Prefer": "return=minimal" },
        body: JSON.stringify({
          password_hash: hash,
          name,
          company: company || null,
          phone: phone || null,
          notes: message || null,
          status: "pending",
          active: true,
        }),
      });
      await sendPartnerRequestEmails(env, { name, email, company, phone, message });
      return json({ ok: true, message: "Your request has been resubmitted and is pending approval." });
    }
  }

  const hash = await hashPassword(password);
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/partners`, {
    method: "POST",
    headers: { ...headers, "Prefer": "return=representation" },
    body: JSON.stringify({
      email: email.toLowerCase(),
      password_hash: hash,
      name,
      company: company || null,
      phone: phone || null,
      notes: message || null,
      status: "pending",
      active: true,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    if (errText.includes("duplicate")) {
      return json({ ok: false, error: "A request with this email already exists." }, 409);
    }
    return json({ ok: false, error: "Failed to submit request" }, 500);
  }

  await sendPartnerRequestEmails(env, { name, email, company, phone, message });
  return json({ ok: true, message: "Your request has been submitted. We'll review it and get back to you soon." });
}

// ==================== FORGOT PASSWORD ====================
async function handleForgotPassword(env, { email }) {
  // Always return success to prevent email enumeration
  const successMsg = "If an account with that email exists, we've sent a password reset link.";
  if (!email) return json({ ok: true, message: successMsg });

  const headers = sbHeaders(env);
  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/partners?email=eq.${encodeURIComponent(email.toLowerCase())}&select=id,name,email&limit=1`,
    { headers },
  );
  if (!res.ok) return json({ ok: true, message: successMsg });
  const rows = await res.json();
  if (rows.length === 0) return json({ ok: true, message: successMsg });

  const partner = rows[0];
  const token = generateToken(32);
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hour

  // Save reset token
  const insertRes = await fetch(`${env.SUPABASE_URL}/rest/v1/password_reset_tokens`, {
    method: "POST",
    headers: { ...headers, "Prefer": "return=minimal" },
    body: JSON.stringify({ partner_id: partner.id, token, expires_at: expiresAt }),
  });
  if (!insertRes.ok) {
    const errBody = await insertRes.text();
    console.error(`Failed to save reset token (${insertRes.status}): ${errBody}`);
    return json({ ok: true, message: successMsg });
  }

  // Send reset email via Resend
  if (!env.RESEND_API_KEY) {
    console.error("RESEND_API_KEY not set — cannot send password reset email");
  } else {
    const resetUrl = `https://searsmelvin.co.uk/partner.html?reset=${token}`;
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
            <p>Hi ${firstName},</p>
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
        const body = await emailRes.text();
        console.error(`Resend error ${emailRes.status} sending reset to ${partner.email}: ${body}`);
      }
    } catch (err) {
      console.error("Failed to send reset email:", err);
    }
  }

  return json({ ok: true, message: successMsg });
}

// ==================== RESET PASSWORD ====================
async function handleResetPassword(env, { token, password }) {
  if (!token || !password) return json({ ok: false, error: "Token and new password are required" }, 400);
  if (password.length < 6) return json({ ok: false, error: "Password must be at least 6 characters" }, 400);

  const headers = sbHeaders(env);
  const now = new Date().toISOString();

  // Find valid reset token
  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/password_reset_tokens?token=eq.${encodeURIComponent(token)}&used=eq.false&expires_at=gt.${now}&select=id,partner_id&limit=1`,
    { headers },
  );
  if (!res.ok) return json({ ok: false, error: "Database error" }, 500);
  const rows = await res.json();
  if (rows.length === 0) return json({ ok: false, error: "This reset link is invalid or has expired. Please request a new one." }, 400);

  const resetRecord = rows[0];
  const hash = await hashPassword(password);

  // Update partner password
  const updateRes = await fetch(`${env.SUPABASE_URL}/rest/v1/partners?id=eq.${resetRecord.partner_id}`, {
    method: "PATCH",
    headers: { ...headers, "Prefer": "return=minimal" },
    body: JSON.stringify({ password_hash: hash }),
  });
  if (!updateRes.ok) return json({ ok: false, error: "Failed to update password" }, 500);

  // Mark token as used
  await fetch(`${env.SUPABASE_URL}/rest/v1/password_reset_tokens?id=eq.${resetRecord.id}`, {
    method: "PATCH",
    headers: { ...headers, "Prefer": "return=minimal" },
    body: JSON.stringify({ used: true }),
  });

  // Invalidate all existing sessions for this partner (security)
  await fetch(`${env.SUPABASE_URL}/rest/v1/partner_sessions?partner_id=eq.${resetRecord.partner_id}`, {
    method: "DELETE",
    headers,
  });

  return json({ ok: true, message: "Password updated successfully. You can now sign in with your new password." });
}

// ==================== HELPERS ====================
async function getPartnerFromToken(env, token) {
  const headers = sbHeaders(env);
  const now = new Date().toISOString();

  const sessRes = await fetch(
    `${env.SUPABASE_URL}/rest/v1/partner_sessions?token=eq.${encodeURIComponent(token)}&expires_at=gt.${now}&select=partner_id&limit=1`,
    { headers },
  );
  if (!sessRes.ok) return null;
  const sessRows = await sessRes.json();
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
  if (!Number.isFinite(iterations) || iterations <= 0) return false;
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

function sbHeaders(env) {
  return {
    "apikey": env.SUPABASE_SERVICE_KEY,
    "Authorization": `Bearer ${env.SUPABASE_SERVICE_KEY}`,
    "Content-Type": "application/json",
  };
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
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
      <a href="https://searsmelvin.co.uk/admin.html" style="color:#8B7355;font-weight:600;">Review in Admin Panel &rarr;</a>
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
      const body = await emailRes.text();
      console.error(`Resend error ${emailRes.status} sending partner request business email: ${body}`);
    }
  } catch (err) {
    console.error("Failed to send partner request business email:", err);
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
      Once approved, you'll be able to sign in at <a href="https://searsmelvin.co.uk/partner.html" style="color:#8B7355;font-weight:600;">searsmelvin.co.uk/partner.html</a> using the email and password you provided.
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
      const body = await emailRes.text();
      console.error(`Resend error ${emailRes.status} sending partner request confirmation: ${body}`);
    }
  } catch (err) {
    console.error("Failed to send partner request confirmation email:", err);
  }
}

export { getPartnerFromToken, sbHeaders, json, CORS };
