/**
 * Partner Orders API — /api/partner-orders
 *
 * All requests require Authorization: Bearer <session-token>
 *
 * GET                        → list partner's orders
 * GET ?id=123                → single order detail with comments
 * POST { action: "create" }  → create order on behalf of customer
 * POST { action: "comment" } → add comment to an order
 */

import { upsertPerson } from "./submit.js";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function onRequest(context) {
  const { request, env } = context;
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) {
    return json({ ok: false, error: "Server config error" }, 500);
  }

  // Authenticate
  const token = (request.headers.get("Authorization") || "").replace("Bearer ", "");
  if (!token) return json({ ok: false, error: "Authentication required" }, 401);

  const partner = await getPartnerFromToken(env, token);
  if (!partner) return json({ ok: false, error: "Invalid or expired session" }, 401);

  const url = new URL(request.url);

  if (request.method === "GET") {
    const orderId = url.searchParams.get("id");
    if (orderId) return getOrderDetail(env, partner, orderId);
    return listOrders(env, partner, url.searchParams);
  }

  if (request.method === "POST") {
    let data;
    try { data = await request.json(); }
    catch { return json({ ok: false, error: "Invalid JSON" }, 400); }

    if (data.action === "create") return createOrder(env, partner, data);
    if (data.action === "comment") return addComment(env, partner, data);
    return json({ ok: false, error: "Unknown action" }, 400);
  }

  return json({ ok: false, error: "Method not allowed" }, 405);
}

// ==================== LIST ORDERS ====================
async function listOrders(env, partner, params) {
  const headers = sbHeaders(env);
  const status = params.get("status");
  const search = params.get("search");

  let url = `${env.SUPABASE_URL}/rest/v1/orders?partner_id=eq.${partner.id}&select=*,people(id,first_name,last_name,email,phone,is_customer)&order=created_at.desc&limit=50`;
  if (status && status !== "all") {
    url += `&status=eq.${encodeURIComponent(status)}`;
  }

  const res = await fetch(url, { headers });
  if (!res.ok) return json({ ok: false, error: "Database error" }, 500);
  let rows = await res.json();

  // Client-side search filter
  if (search) {
    const q = search.toLowerCase();
    rows = rows.filter(r => {
      const fullName = [r.people?.first_name, r.people?.last_name].filter(Boolean).join(" ");
      return fullName.toLowerCase().includes(q) ||
        (r.people?.email || "").toLowerCase().includes(q) ||
        (r.sku || "").toLowerCase().includes(q) ||
        (r.location || "").toLowerCase().includes(q);
    });
  }

  const orders = rows.map(mapOrder);

  // Compute summary stats
  const totalValue = rows.reduce((s, r) => s + (parseFloat(r.value) || 0), 0);
  const pending = rows.filter(r => !r.status || r.status === "pending").length;
  const completed = rows.filter(r => r.status === "completed").length;

  return json({
    ok: true,
    orders,
    stats: { total: rows.length, totalValue, pending, completed },
  });
}

// ==================== ORDER DETAIL ====================
async function getOrderDetail(env, partner, orderId) {
  const headers = sbHeaders(env);

  // Get order (verify it belongs to this partner)
  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/orders?id=eq.${encodeURIComponent(orderId)}&partner_id=eq.${partner.id}&select=*,people(id,first_name,last_name,email,phone,is_customer)&limit=1`,
    { headers },
  );
  if (!res.ok) return json({ ok: false, error: "Database error" }, 500);
  const rows = await res.json();
  if (rows.length === 0) return json({ ok: false, error: "Order not found" }, 404);

  const order = mapOrder(rows[0]);

  // Get comments
  const commentsRes = await fetch(
    `${env.SUPABASE_URL}/rest/v1/partner_comments?order_id=eq.${orderId}&select=*&order=created_at.asc`,
    { headers },
  );
  let comments = [];
  if (commentsRes.ok) {
    comments = (await commentsRes.json()).map(c => ({
      id: c.id,
      comment: c.comment,
      created_at: c.created_at,
    }));
  }

  return json({ ok: true, order, comments });
}

// ==================== CREATE ORDER ====================
async function createOrder(env, partner, data) {
  const { customerName, customerEmail, customerPhone, product, colour, size, location, value, notes } = data;

  if (!customerName || !customerEmail) {
    return json({ ok: false, error: "Customer name and email are required" }, 400);
  }

  const headers = sbHeaders(env);

  // Upsert the retail customer into the unified `people` table first.
  let person;
  try {
    person = await upsertPerson(env, {
      name: customerName,
      email: customerEmail,
      phone: customerPhone,
    });
  } catch (err) {
    return json({ ok: false, error: "Failed to register customer", detail: String(err) }, 500);
  }
  if (!person) return json({ ok: false, error: "Failed to register customer" }, 500);

  // Create order linked to partner AND to the person record.
  const orderBody = {
    organization_id: env.SM_ORG_ID,
    person_id: person.id,
    order_type: "quote",
    sku: product || null,
    color: colour || null,
    value: value ? parseFloat(value) : null,
    location: location || null,
    partner_id: partner.id,
    status: "pending",
    notes: notes || null,
    product_config: product ? JSON.stringify({ name: product, colour, size, price: value }) : null,
  };

  const orderRes = await fetch(`${env.SUPABASE_URL}/rest/v1/orders?select=*,people(id,first_name,last_name,email,phone,is_customer)`, {
    method: "POST",
    headers: { ...headers, "Prefer": "return=representation" },
    body: JSON.stringify(orderBody),
  });

  if (!orderRes.ok) {
    const errText = await orderRes.text();
    return json({ ok: false, error: "Failed to create order", detail: errText }, 500);
  }

  const orderRows = await orderRes.json();
  return json({ ok: true, order: mapOrder(orderRows[0]) });
}

// ==================== ADD COMMENT ====================
async function addComment(env, partner, data) {
  const { orderId, comment } = data;
  if (!orderId || !comment) return json({ ok: false, error: "Order ID and comment required" }, 400);

  const headers = sbHeaders(env);

  // Verify order belongs to partner
  const checkRes = await fetch(
    `${env.SUPABASE_URL}/rest/v1/orders?id=eq.${encodeURIComponent(orderId)}&partner_id=eq.${partner.id}&select=id&limit=1`,
    { headers },
  );
  if (!checkRes.ok) return json({ ok: false, error: "Database error" }, 500);
  const checkRows = await checkRes.json();
  if (checkRows.length === 0) return json({ ok: false, error: "Order not found" }, 404);

  const commentRes = await fetch(`${env.SUPABASE_URL}/rest/v1/partner_comments`, {
    method: "POST",
    headers: { ...headers, "Prefer": "return=representation" },
    body: JSON.stringify({
      order_id: orderId,
      partner_id: partner.id,
      comment: comment.trim(),
    }),
  });

  if (!commentRes.ok) return json({ ok: false, error: "Failed to add comment" }, 500);
  const commentRows = await commentRes.json();

  return json({
    ok: true,
    comment: {
      id: commentRows[0].id,
      comment: commentRows[0].comment,
      created_at: commentRows[0].created_at,
    },
  });
}

// ==================== HELPERS ====================
function mapOrder(row) {
  return {
    id: row.id,
    customer_name: [row.people?.first_name, row.people?.last_name].filter(Boolean).join(" ") || null,
    customer_email: row.people?.email || null,
    customer_phone: row.people?.phone || null,
    is_customer: row.people?.is_customer || false,
    product: row.sku,
    colour: row.color,
    value: row.value,
    location: row.location,
    status: row.status || "pending",
    notes: row.notes || null,
    config: row.product_config ? safeParse(row.product_config) : null,
    created_at: row.created_at,
    updated_at: row.updated_at || null,
  };
}

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

  const partRes = await fetch(
    `${env.SUPABASE_URL}/rest/v1/partners?id=eq.${sessRows[0].partner_id}&active=eq.true&select=id,email,name,company&limit=1`,
    { headers },
  );
  if (!partRes.ok) return null;
  const partRows = await partRes.json();
  return partRows.length > 0 ? partRows[0] : null;
}

function safeParse(str) {
  try { return JSON.parse(str); } catch { return null; }
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
