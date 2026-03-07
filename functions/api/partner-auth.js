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

  // Verify password
  const hash = await hashPassword(password);
  if (hash !== partner.password_hash) {
    return json({ ok: false, error: "Invalid email or password" }, 401);
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
      // If declined, allow re-request by updating
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
          declined_at: null,
          active: true,
        }),
      });
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
  if (!insertRes.ok) return json({ ok: true, message: successMsg });

  // Send reset email via Resend
  if (env.RESEND_API_KEY) {
    const resetUrl = `https://searsmelvin.co.uk/partner.html?reset=${token}`;
    const firstName = (partner.name || "").split(" ")[0] || "there";
    try {
      await fetch("https://api.resend.com/emails", {
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

async function hashPassword(password) {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
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

export { getPartnerFromToken, sbHeaders, json, CORS };
