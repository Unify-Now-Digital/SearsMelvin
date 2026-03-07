/**
 * Admin API — /api/admin
 *
 * All requests require admin authentication via PARTNER_ADMIN_KEY.
 *
 * POST { action: "login", adminKey }                    → get admin session token
 * POST { action: "verify", token }                      → verify admin session
 * POST { action: "logout", token }                      → end admin session
 * POST { action: "list-partners", token }               → list all partners with stats
 * POST { action: "approve-partner", token, partnerId }  → approve a pending partner
 * POST { action: "decline-partner", token, partnerId }  → decline a pending partner
 * POST { action: "dashboard", token }                   → get overview stats
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
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY || !env.PARTNER_ADMIN_KEY) {
    return json({ ok: false, error: "Server config error" }, 500);
  }

  let data;
  try { data = await request.json(); }
  catch { return json({ ok: false, error: "Invalid JSON" }, 400); }

  const { action } = data;

  if (action === "login") return handleAdminLogin(env, data);
  if (action === "verify") return handleAdminVerify(env, data);
  if (action === "logout") return handleAdminLogout(env, data);

  // All other actions require valid admin session
  const valid = await verifyAdminToken(env, data.token);
  if (!valid) return json({ ok: false, error: "Unauthorized" }, 401);

  if (action === "list-partners") return listPartners(env, data);
  if (action === "approve-partner") return approvePartner(env, data);
  if (action === "decline-partner") return declinePartner(env, data);
  if (action === "dashboard") return getDashboard(env);

  return json({ ok: false, error: "Unknown action" }, 400);
}

// ==================== ADMIN AUTH ====================
async function handleAdminLogin(env, { adminKey }) {
  if (!adminKey || adminKey !== env.PARTNER_ADMIN_KEY) {
    return json({ ok: false, error: "Invalid admin key" }, 401);
  }

  const token = generateToken(64);
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(); // 24 hours

  const headers = sbHeaders(env);
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/admin_sessions`, {
    method: "POST",
    headers: { ...headers, "Prefer": "return=minimal" },
    body: JSON.stringify({ token, expires_at: expiresAt }),
  });
  if (!res.ok) return json({ ok: false, error: "Failed to create session" }, 500);

  return json({ ok: true, token });
}

async function handleAdminVerify(env, { token }) {
  if (!token) return json({ ok: false, error: "Token required" }, 400);
  const valid = await verifyAdminToken(env, token);
  if (!valid) return json({ ok: false, error: "Invalid or expired session" }, 401);
  return json({ ok: true });
}

async function handleAdminLogout(env, { token }) {
  if (!token) return json({ ok: true });
  const headers = sbHeaders(env);
  await fetch(`${env.SUPABASE_URL}/rest/v1/admin_sessions?token=eq.${encodeURIComponent(token)}`, {
    method: "DELETE",
    headers,
  });
  return json({ ok: true });
}

async function verifyAdminToken(env, token) {
  if (!token) return false;
  const headers = sbHeaders(env);
  const now = new Date().toISOString();
  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/admin_sessions?token=eq.${encodeURIComponent(token)}&expires_at=gt.${now}&select=id&limit=1`,
    { headers },
  );
  if (!res.ok) return false;
  const rows = await res.json();
  return rows.length > 0;
}

// ==================== LIST PARTNERS ====================
async function listPartners(env, { filter }) {
  const headers = sbHeaders(env);

  let url = `${env.SUPABASE_URL}/rest/v1/partners?select=id,email,name,company,phone,status,active,notes,created_at,approved_at,declined_at&order=created_at.desc`;
  if (filter && filter !== "all") {
    url += `&status=eq.${encodeURIComponent(filter)}`;
  }

  const res = await fetch(url, { headers });
  if (!res.ok) return json({ ok: false, error: "Database error" }, 500);
  const partners = await res.json();

  // Get order counts per partner
  const orderRes = await fetch(
    `${env.SUPABASE_URL}/rest/v1/orders?partner_id=not.is.null&select=partner_id,id,value,status`,
    { headers },
  );
  let ordersByPartner = {};
  if (orderRes.ok) {
    const orders = await orderRes.json();
    orders.forEach(o => {
      if (!ordersByPartner[o.partner_id]) {
        ordersByPartner[o.partner_id] = { count: 0, value: 0, pending: 0, completed: 0 };
      }
      const stats = ordersByPartner[o.partner_id];
      stats.count++;
      stats.value += parseFloat(o.value) || 0;
      if (o.status === "completed") stats.completed++;
      else if (!o.status || o.status === "pending") stats.pending++;
    });
  }

  const enriched = partners.map(p => ({
    ...p,
    orders: ordersByPartner[p.id] || { count: 0, value: 0, pending: 0, completed: 0 },
  }));

  return json({ ok: true, partners: enriched });
}

// ==================== APPROVE PARTNER ====================
async function approvePartner(env, { partnerId }) {
  if (!partnerId) return json({ ok: false, error: "Partner ID required" }, 400);

  const headers = sbHeaders(env);
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/partners?id=eq.${encodeURIComponent(partnerId)}`, {
    method: "PATCH",
    headers: { ...headers, "Prefer": "return=representation" },
    body: JSON.stringify({
      status: "approved",
      active: true,
      approved_at: new Date().toISOString(),
    }),
  });

  if (!res.ok) return json({ ok: false, error: "Failed to approve partner" }, 500);
  const rows = await res.json();
  if (rows.length === 0) return json({ ok: false, error: "Partner not found" }, 404);

  return json({ ok: true, partner: rows[0] });
}

// ==================== DECLINE PARTNER ====================
async function declinePartner(env, { partnerId }) {
  if (!partnerId) return json({ ok: false, error: "Partner ID required" }, 400);

  const headers = sbHeaders(env);
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/partners?id=eq.${encodeURIComponent(partnerId)}`, {
    method: "PATCH",
    headers: { ...headers, "Prefer": "return=representation" },
    body: JSON.stringify({
      status: "declined",
      active: false,
      declined_at: new Date().toISOString(),
    }),
  });

  if (!res.ok) return json({ ok: false, error: "Failed to decline partner" }, 500);
  const rows = await res.json();
  if (rows.length === 0) return json({ ok: false, error: "Partner not found" }, 404);

  return json({ ok: true, partner: rows[0] });
}

// ==================== DASHBOARD STATS ====================
async function getDashboard(env) {
  const headers = sbHeaders(env);

  // Get all partners
  const partRes = await fetch(
    `${env.SUPABASE_URL}/rest/v1/partners?select=id,status,created_at`,
    { headers },
  );
  let partnerStats = { total: 0, pending: 0, approved: 0, declined: 0 };
  let recentRequests = [];
  if (partRes.ok) {
    const partners = await partRes.json();
    partnerStats.total = partners.length;
    partners.forEach(p => {
      if (p.status === "pending") partnerStats.pending++;
      else if (p.status === "approved") partnerStats.approved++;
      else if (p.status === "declined") partnerStats.declined++;
    });
  }

  // Get all orders with partner_id
  const orderRes = await fetch(
    `${env.SUPABASE_URL}/rest/v1/orders?select=id,partner_id,value,status,created_at&order=created_at.desc&limit=200`,
    { headers },
  );
  let orderStats = { total: 0, partnerOrders: 0, totalValue: 0, partnerValue: 0, pending: 0, completed: 0 };
  let recentOrders = [];
  if (orderRes.ok) {
    const orders = await orderRes.json();
    orderStats.total = orders.length;
    orders.forEach(o => {
      const val = parseFloat(o.value) || 0;
      orderStats.totalValue += val;
      if (o.partner_id) {
        orderStats.partnerOrders++;
        orderStats.partnerValue += val;
      }
      if (!o.status || o.status === "pending") orderStats.pending++;
      if (o.status === "completed") orderStats.completed++;
    });
    recentOrders = orders.slice(0, 10);
  }

  return json({
    ok: true,
    partners: partnerStats,
    orders: orderStats,
    recentOrders,
  });
}

// ==================== HELPERS ====================
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
