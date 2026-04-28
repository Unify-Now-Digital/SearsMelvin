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
 * POST { action: "list-orders", token }                 → list all orders with tracking info
 * POST { action: "update-order", token, orderId, ... }  → update order stage, inscription, proof, dates
 * POST { action: "generate-tracking", token, orderId }  → generate tracking token for customer
 * POST { action: "list-inscription-requests", token }   → list pending inscription change requests
 * POST { action: "resolve-inscription", token, requestId, accept } → accept/decline inscription change
 * POST { action: "list-products", token }                → list all products incl. hidden (bypasses RLS)
 * POST { action: "get-product", token, slug }             → fetch one product (with sizes) by slug, incl. hidden
 * POST { action: "list-order-events", token, orderId }    → fetch chronological event log for an order
 * POST { action: "send-customer-email", token, orderId, kind } → email customer (proof_ready|tracking|inscription_confirm)
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
  if (action === "send-magic-link") return handleSendMagicLink(env, request);
  if (action === "verify-magic-link") return handleVerifyMagicLink(env, data);
  if (action === "verify") return handleAdminVerify(env, data);
  if (action === "logout") return handleAdminLogout(env, data);

  // All other actions require valid admin session
  const valid = await verifyAdminToken(env, data.token);
  if (!valid) return json({ ok: false, error: "Unauthorized" }, 401);

  if (action === "list-partners") return listPartners(env, data);
  if (action === "approve-partner") return approvePartner(env, data);
  if (action === "decline-partner") return declinePartner(env, data);
  if (action === "dashboard") return getDashboard(env);
  if (action === "list-orders") return listOrders(env, data);
  if (action === "update-order") return updateOrder(env, data);
  if (action === "generate-tracking") return generateTracking(env, data);
  if (action === "list-inscription-requests") return listInscriptionRequests(env);
  if (action === "resolve-inscription") return resolveInscription(env, data);
  if (action === "list-products") return listProducts(env);
  if (action === "get-product") return getProduct(env, data);
  if (action === "list-order-events") return listOrderEvents(env, data);
  if (action === "send-customer-email") return sendCustomerEmail(env, data);

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

const ADMIN_EMAIL = "info@searsmelvin.co.uk";

async function handleSendMagicLink(env, request) {
  if (!env.RESEND_API_KEY) return json({ ok: false, error: "Email not configured" }, 500);

  const token = generateToken(48);
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString(); // 15 minutes

  const headers = sbHeaders(env);
  // Prefix token so we can identify magic links on verify
  const magicTokenValue = "magic_" + token;
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/admin_sessions`, {
    method: "POST",
    headers: { ...headers, "Prefer": "return=minimal" },
    body: JSON.stringify({ token: magicTokenValue, expires_at: expiresAt }),
  });
  if (!res.ok) return json({ ok: false, error: "Failed to create magic link" }, 500);

  const origin = new URL(request.url).origin;
  const magicUrl = `${origin}/admin.html?magic=${magicTokenValue}`;

  const emailRes = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Authorization": `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: "Sears Melvin Memorials <info@searsmelvin.co.uk>",
      to: ADMIN_EMAIL,
      subject: "Admin login link — Sears Melvin Memorials",
      html: magicLinkEmail(magicUrl),
    }),
  });
  if (!emailRes.ok) {
    const errBody = await emailRes.text();
    console.error("Magic link email failed:", errBody);
    return json({ ok: false, error: "Failed to send email" }, 500);
  }

  return json({ ok: true });
}

async function handleVerifyMagicLink(env, { magicToken }) {
  if (!magicToken) return json({ ok: false, error: "Token required" }, 400);
  // Magic link tokens are prefixed with "magic_"
  if (!magicToken.startsWith("magic_")) {
    return json({ ok: false, error: "Invalid magic link" }, 401);
  }

  const headers = sbHeaders(env);
  const now = new Date().toISOString();
  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/admin_sessions?token=eq.${encodeURIComponent(magicToken)}&expires_at=gt.${now}&select=id&limit=1`,
    { headers },
  );
  if (!res.ok) return json({ ok: false, error: "Database error" }, 500);
  const rows = await res.json();
  if (rows.length === 0) {
    return json({ ok: false, error: "Invalid or expired magic link" }, 401);
  }

  // Delete the one-time magic link token
  await fetch(`${env.SUPABASE_URL}/rest/v1/admin_sessions?id=eq.${rows[0].id}`, {
    method: "DELETE",
    headers,
  });

  // Create a proper session token (24hr)
  const sessionToken = generateToken(64);
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  await fetch(`${env.SUPABASE_URL}/rest/v1/admin_sessions`, {
    method: "POST",
    headers: { ...headers, "Prefer": "return=minimal" },
    body: JSON.stringify({ token: sessionToken, expires_at: expiresAt }),
  });

  return json({ ok: true, token: sessionToken });
}

function magicLinkEmail(url) {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#F5F3F0;font-family:-apple-system,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#F5F3F0;padding:24px 0;">
<tr><td align="center">
<table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border-radius:10px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.08);">
  <tr><td style="background:#2C2C2C;padding:20px 28px;">
    <span style="font-family:Georgia,serif;font-size:18px;color:#fff;">Sears Melvin <span style="opacity:0.55;">Memorials</span></span>
  </td></tr>
  <tr><td style="padding:32px 28px;">
    <h2 style="font-family:Georgia,serif;font-size:22px;color:#2C2C2C;font-weight:normal;margin:0 0 12px;">Admin Login</h2>
    <p style="color:#555;font-size:15px;line-height:1.7;margin:0 0 24px;">Click the button below to sign in to the admin dashboard. This link expires in 15 minutes.</p>
    <a href="${url}" style="display:inline-block;background:#2C2C2C;color:#fff;padding:14px 32px;border-radius:6px;font-size:15px;font-weight:600;text-decoration:none;">Sign In to Dashboard</a>
    <p style="color:#999;font-size:12px;margin-top:24px;">If you didn't request this, you can safely ignore this email.</p>
  </td></tr>
  <tr><td style="background:#F5F3F0;border-top:1px solid #E0DCD5;padding:14px 28px;text-align:center;">
    <span style="font-size:11px;color:#BBB;">Sears Melvin Memorials</span>
  </td></tr>
</table>
</td></tr></table></body></html>`;
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

// ==================== LIST ORDERS ====================
async function listOrders(env, { filter, search, partnerId, dateFrom, dateTo }) {
  const headers = sbHeaders(env);
  const select = [
    "id", "person_id", "people(id,name,email,phone,is_customer)",
    "sku", "color", "value", "permit_fee", "status", "stage",
    "location", "tracking_token", "inscription_text", "inscription_status",
    "proof_url", "proof_uploaded_at", "proof_notes",
    "estimated_completion", "installation_date",
    "partner_id", "admin_notes", "product_config", "notes",
    "edit_token", "order_type", "created_at", "updated_at",
    "partners(id,name,company,email)"
  ].join(",");
  let url = `${env.SUPABASE_URL}/rest/v1/orders?select=${select}&order=created_at.desc&limit=200`;

  if (filter && filter !== "all") {
    url += `&stage=eq.${encodeURIComponent(filter)}`;
  }
  if (partnerId) {
    url += `&partner_id=eq.${encodeURIComponent(partnerId)}`;
  }
  if (dateFrom) {
    url += `&created_at=gte.${encodeURIComponent(dateFrom)}`;
  }
  if (dateTo) {
    url += `&created_at=lte.${encodeURIComponent(dateTo)}`;
  }

  const res = await fetch(url, { headers });
  if (!res.ok) return json({ ok: false, error: "Database error" }, 500);
  let orders = await res.json();

  // Decode product_config JSON for line items
  orders = orders.map(o => {
    let config = null;
    if (o.product_config) {
      try { config = JSON.parse(o.product_config); } catch { /* ignore */ }
    }
    return { ...o, product_config: config };
  });

  if (search) {
    const q = search.toLowerCase();
    orders = orders.filter(o =>
      (o.people?.name || "").toLowerCase().includes(q) ||
      (o.people?.email || "").toLowerCase().includes(q) ||
      (o.sku || "").toLowerCase().includes(q) ||
      (o.location || "").toLowerCase().includes(q) ||
      String(o.id || "").includes(q)
    );
  }

  return json({ ok: true, orders });
}

// ==================== LIST PRODUCTS (admin, includes hidden) ====================
async function listProducts(env) {
  const headers = sbHeaders(env);
  const url = `${env.SUPABASE_URL}/rest/v1/products?select=*,product_categories(name,slug)&order=display_order.asc`;
  const res = await fetch(url, { headers });
  if (!res.ok) return json({ ok: false, error: "Database error" }, 500);
  return json({ ok: true, products: await res.json() });
}

// ==================== GET PRODUCT (admin, by slug, includes hidden) ====================
async function getProduct(env, { slug }) {
  if (!slug) return json({ ok: false, error: "Slug required" }, 400);
  const headers = sbHeaders(env);
  const productRes = await fetch(
    `${env.SUPABASE_URL}/rest/v1/products?slug=eq.${encodeURIComponent(slug)}&select=*,product_categories(name,slug)&limit=1`,
    { headers }
  );
  if (!productRes.ok) return json({ ok: false, error: "Database error" }, 500);
  const products = await productRes.json();
  const product = products[0];
  if (!product) return json({ ok: false, error: "Not found" }, 404);

  const sizesRes = await fetch(
    `${env.SUPABASE_URL}/rest/v1/product_sizes?product_id=eq.${encodeURIComponent(product.id)}&select=*&order=display_order.asc`,
    { headers }
  );
  const sizes = sizesRes.ok ? await sizesRes.json() : [];
  return json({ ok: true, product, sizes });
}

// ==================== UPDATE ORDER ====================
async function updateOrder(env, { orderId, stage, inscriptionText, inscriptionStatus, proofUrl, proofNotes, estimatedCompletion, installationDate, adminNotes }) {
  if (!orderId) return json({ ok: false, error: "Order ID required" }, 400);

  const headers = sbHeaders(env);

  // Fetch the row first so we can produce a meaningful audit trail.
  const beforeRes = await fetch(
    `${env.SUPABASE_URL}/rest/v1/orders?id=eq.${encodeURIComponent(orderId)}&select=stage,inscription_text,inscription_status,proof_url,proof_notes,estimated_completion,installation_date,admin_notes&limit=1`,
    { headers }
  );
  const beforeRows = beforeRes.ok ? await beforeRes.json() : [];
  const before = beforeRows[0] || {};

  const updates = {};
  if (stage !== undefined) updates.stage = stage;
  if (inscriptionText !== undefined) updates.inscription_text = inscriptionText;
  if (inscriptionStatus !== undefined) updates.inscription_status = inscriptionStatus;
  if (proofUrl !== undefined) {
    updates.proof_url = proofUrl;
    updates.proof_uploaded_at = new Date().toISOString();
  }
  if (proofNotes !== undefined) updates.proof_notes = proofNotes;
  if (estimatedCompletion !== undefined) updates.estimated_completion = estimatedCompletion;
  if (installationDate !== undefined) updates.installation_date = installationDate;
  if (adminNotes !== undefined) updates.admin_notes = adminNotes;
  updates.updated_at = new Date().toISOString();

  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/orders?id=eq.${encodeURIComponent(orderId)}`, {
    method: "PATCH",
    headers: { ...headers, "Prefer": "return=representation" },
    body: JSON.stringify(updates),
  });

  if (!res.ok) return json({ ok: false, error: "Failed to update order" }, 500);
  const rows = await res.json();
  if (rows.length === 0) return json({ ok: false, error: "Order not found" }, 404);

  // Append events for any field that actually changed.
  const events = [];
  if (stage !== undefined && stage !== before.stage) {
    events.push({ event_type: "stage_changed", summary: `Stage: ${before.stage || "—"} → ${stage}`, detail: { from: before.stage, to: stage } });
  }
  if (inscriptionText !== undefined && inscriptionText !== before.inscription_text) {
    events.push({ event_type: "inscription_changed", summary: "Inscription text updated", detail: { from: before.inscription_text, to: inscriptionText } });
  }
  if (inscriptionStatus !== undefined && inscriptionStatus !== before.inscription_status) {
    events.push({ event_type: "inscription_status", summary: `Inscription status: ${before.inscription_status || "—"} → ${inscriptionStatus}`, detail: { from: before.inscription_status, to: inscriptionStatus } });
  }
  if (proofUrl !== undefined && proofUrl !== before.proof_url) {
    events.push({ event_type: "proof_uploaded", summary: proofUrl ? "Proof image uploaded" : "Proof image removed", detail: { url: proofUrl } });
  }
  if (proofNotes !== undefined && proofNotes !== before.proof_notes) {
    events.push({ event_type: "proof_notes_updated", summary: "Proof notes updated", detail: { from: before.proof_notes, to: proofNotes } });
  }
  if (estimatedCompletion !== undefined && estimatedCompletion !== before.estimated_completion) {
    events.push({ event_type: "dates_updated", summary: `Estimated completion: ${before.estimated_completion || "—"} → ${estimatedCompletion || "—"}`, detail: { field: "estimated_completion", from: before.estimated_completion, to: estimatedCompletion } });
  }
  if (installationDate !== undefined && installationDate !== before.installation_date) {
    events.push({ event_type: "dates_updated", summary: `Installation date: ${before.installation_date || "—"} → ${installationDate || "—"}`, detail: { field: "installation_date", from: before.installation_date, to: installationDate } });
  }
  if (adminNotes !== undefined && adminNotes !== before.admin_notes) {
    events.push({ event_type: "notes_updated", summary: "Admin notes updated", detail: { from: before.admin_notes, to: adminNotes } });
  }
  if (events.length > 0) {
    await logOrderEvents(env, orderId, events);
  }

  return json({ ok: true, order: rows[0] });
}

// ==================== GENERATE TRACKING TOKEN ====================
async function generateTracking(env, { orderId }) {
  if (!orderId) return json({ ok: false, error: "Order ID required" }, 400);

  const headers = sbHeaders(env);

  // Check if order already has a tracking token
  const checkRes = await fetch(
    `${env.SUPABASE_URL}/rest/v1/orders?id=eq.${encodeURIComponent(orderId)}&select=id,tracking_token&limit=1`,
    { headers },
  );
  if (!checkRes.ok) return json({ ok: false, error: "Database error" }, 500);
  const rows = await checkRes.json();
  if (rows.length === 0) return json({ ok: false, error: "Order not found" }, 404);

  if (rows[0].tracking_token) {
    return json({ ok: true, trackingToken: rows[0].tracking_token, alreadyExists: true });
  }

  const token = generateToken(32);
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/orders?id=eq.${encodeURIComponent(orderId)}`, {
    method: "PATCH",
    headers: { ...headers, "Prefer": "return=representation" },
    body: JSON.stringify({ tracking_token: token }),
  });

  if (!res.ok) return json({ ok: false, error: "Failed to generate token" }, 500);

  return json({ ok: true, trackingToken: token });
}

// ==================== LIST INSCRIPTION REQUESTS ====================
async function listInscriptionRequests(env) {
  const headers = sbHeaders(env);

  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/inscription_requests?status=eq.pending&select=id,order_id,requested_text,reason,created_at&order=created_at.desc&limit=50`,
    { headers },
  );
  if (!res.ok) return json({ ok: false, error: "Database error" }, 500);
  const requests = await res.json();

  // Enrich with order info
  const enriched = [];
  for (const req of requests) {
    const orderRes = await fetch(
      `${env.SUPABASE_URL}/rest/v1/orders?id=eq.${req.order_id}&select=id,people(name,email),sku,inscription_text&limit=1`,
      { headers },
    );
    let orderInfo = null;
    if (orderRes.ok) {
      const orderRows = await orderRes.json();
      if (orderRows.length > 0) orderInfo = orderRows[0];
    }
    enriched.push({ ...req, order: orderInfo });
  }

  return json({ ok: true, requests: enriched });
}

// ==================== RESOLVE INSCRIPTION REQUEST ====================
async function resolveInscription(env, { requestId, accept }) {
  if (!requestId) return json({ ok: false, error: "Request ID required" }, 400);

  const headers = sbHeaders(env);

  // Get the request
  const reqRes = await fetch(
    `${env.SUPABASE_URL}/rest/v1/inscription_requests?id=eq.${encodeURIComponent(requestId)}&select=id,order_id,requested_text&limit=1`,
    { headers },
  );
  if (!reqRes.ok) return json({ ok: false, error: "Database error" }, 500);
  const reqRows = await reqRes.json();
  if (reqRows.length === 0) return json({ ok: false, error: "Request not found" }, 404);

  const inscReq = reqRows[0];

  // Update request status
  await fetch(`${env.SUPABASE_URL}/rest/v1/inscription_requests?id=eq.${requestId}`, {
    method: "PATCH",
    headers: { ...headers, "Prefer": "return=minimal" },
    body: JSON.stringify({
      status: accept ? "accepted" : "declined",
      resolved_at: new Date().toISOString(),
    }),
  });

  // If accepted, update the order's inscription text
  if (accept) {
    await fetch(`${env.SUPABASE_URL}/rest/v1/orders?id=eq.${inscReq.order_id}`, {
      method: "PATCH",
      headers: { ...headers, "Prefer": "return=minimal" },
      body: JSON.stringify({
        inscription_text: inscReq.requested_text,
        inscription_status: "awaiting_approval",
        updated_at: new Date().toISOString(),
      }),
    });
  } else {
    // Declined — revert to previous status
    await fetch(`${env.SUPABASE_URL}/rest/v1/orders?id=eq.${inscReq.order_id}`, {
      method: "PATCH",
      headers: { ...headers, "Prefer": "return=minimal" },
      body: JSON.stringify({
        inscription_status: "awaiting_approval",
        updated_at: new Date().toISOString(),
      }),
    });
  }

  return json({ ok: true });
}

// ==================== ORDER EVENTS LOG ====================
async function logOrderEvents(env, orderId, events) {
  if (!events || events.length === 0) return;
  const headers = sbHeaders(env);
  const rows = events.map(e => ({
    order_id: orderId,
    event_type: e.event_type,
    summary: e.summary,
    detail: e.detail || null,
  }));
  try {
    await fetch(`${env.SUPABASE_URL}/rest/v1/order_events`, {
      method: "POST",
      headers: { ...headers, "Prefer": "return=minimal" },
      body: JSON.stringify(rows),
    });
  } catch (err) {
    // Non-fatal: don't block the user-visible action if logging fails.
    console.error("Failed to log order events:", err);
  }
}

async function listOrderEvents(env, { orderId }) {
  if (!orderId) return json({ ok: false, error: "Order ID required" }, 400);
  const headers = sbHeaders(env);
  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/order_events?order_id=eq.${encodeURIComponent(orderId)}&select=*&order=created_at.desc&limit=200`,
    { headers }
  );
  if (!res.ok) return json({ ok: false, error: "Database error" }, 500);
  return json({ ok: true, events: await res.json() });
}

// ==================== SEND CUSTOMER EMAIL ====================
async function sendCustomerEmail(env, { orderId, kind }) {
  if (!orderId) return json({ ok: false, error: "Order ID required" }, 400);
  if (!env.RESEND_API_KEY) return json({ ok: false, error: "Email not configured" }, 500);

  const headers = sbHeaders(env);
  const orderRes = await fetch(
    `${env.SUPABASE_URL}/rest/v1/orders?id=eq.${encodeURIComponent(orderId)}&select=id,people(name,email),sku,proof_url,proof_notes,inscription_text,tracking_token&limit=1`,
    { headers }
  );
  if (!orderRes.ok) return json({ ok: false, error: "Database error" }, 500);
  const orders = await orderRes.json();
  const order = orders[0];
  if (!order) return json({ ok: false, error: "Order not found" }, 404);
  const customerEmail = order.people?.email;
  const customerName = order.people?.name;
  if (!customerEmail) return json({ ok: false, error: "Order has no customer email" }, 400);

  // Generate a tracking token if one doesn't exist yet (used by tracking + proof emails).
  let trackingToken = order.tracking_token;
  if (!trackingToken && (kind === "tracking" || kind === "proof_ready" || kind === "inscription_confirm")) {
    trackingToken = generateToken(32);
    await fetch(`${env.SUPABASE_URL}/rest/v1/orders?id=eq.${encodeURIComponent(orderId)}`, {
      method: "PATCH",
      headers: { ...headers, "Prefer": "return=minimal" },
      body: JSON.stringify({ tracking_token: trackingToken }),
    });
  }

  const trackUrl = `https://searsmelvin.co.uk/track.html?token=${encodeURIComponent(trackingToken || "")}`;
  const greeting = customerName ? `Dear ${customerName},` : "Hello,";

  let subject, html;
  if (kind === "proof_ready") {
    subject = "Your memorial proof is ready to review";
    html = adminEmailHtml(
      "Your proof is ready",
      `${greeting}<br><br>Your memorial proof is ready for review. Please follow the link below to view it and let us know if you'd like any changes before we begin production.`,
      [{ label: "Review your proof", href: trackUrl }],
      order.proof_notes ? `<p style="margin-top:1rem;color:#666;font-size:14px;"><em>Note from our team:</em> ${escapeHtml(order.proof_notes)}</p>` : ""
    );
  } else if (kind === "tracking") {
    subject = "Your order tracking link";
    html = adminEmailHtml(
      "Track your order",
      `${greeting}<br><br>You can follow the progress of your memorial at the link below.`,
      [{ label: "Track my order", href: trackUrl }],
      ""
    );
  } else if (kind === "inscription_confirm") {
    subject = "Please confirm your inscription";
    const inscBlock = order.inscription_text
      ? `<div style="background:#FAF8F5;border-left:3px solid #8B7355;padding:1rem 1.25rem;margin:1.5rem 0;font-style:italic;white-space:pre-wrap;">${escapeHtml(order.inscription_text)}</div>`
      : `<p style="color:#b44;">No inscription is currently on file.</p>`;
    html = adminEmailHtml(
      "Please confirm your inscription",
      `${greeting}<br><br>Please review and confirm the inscription wording below before we engrave your memorial. If anything needs changing, you can reply to this email or request a change from your tracking page.`,
      [{ label: "Open tracking page", href: trackUrl }],
      inscBlock
    );
  } else {
    return json({ ok: false, error: "Unknown email kind" }, 400);
  }

  try {
    await sendResend(env.RESEND_API_KEY, {
      from: "Sears Melvin Memorials <info@searsmelvin.co.uk>",
      to: customerEmail,
      subject,
      html,
    });
  } catch (err) {
    return json({ ok: false, error: "Email failed: " + err.message }, 500);
  }

  await logOrderEvents(env, orderId, [{
    event_type: "email_sent",
    summary: `Sent "${subject}" to ${customerEmail}`,
    detail: { kind, to: customerEmail },
  }]);

  return json({ ok: true });
}

function adminEmailHtml(title, body, buttons, extraHtml) {
  const buttonsHtml = (buttons || []).map(b =>
    `<a href="${b.href}" style="display:inline-block;padding:0.85rem 1.75rem;background:#2C2C2C;color:#fff;text-decoration:none;border-radius:6px;font-family:'DM Sans',sans-serif;font-size:14px;font-weight:600;letter-spacing:0.02em;margin-right:0.5rem;">${b.label}</a>`
  ).join("");
  return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#FAF8F5;font-family:'DM Sans',-apple-system,sans-serif;color:#1a1a1a;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#FAF8F5;padding:2rem 1rem;">
      <tr><td align="center">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#fff;border-radius:12px;overflow:hidden;">
          <tr><td style="padding:2rem 2rem 1rem;border-bottom:1px solid #E0DCD5;">
            <div style="font-family:'Cormorant Garamond',Georgia,serif;font-size:1.5rem;color:#2C2C2C;">Sears Melvin <span style="color:#8B7355;font-weight:300;">Memorials</span></div>
          </td></tr>
          <tr><td style="padding:2rem;">
            <h1 style="font-family:'Cormorant Garamond',Georgia,serif;font-weight:400;font-size:1.75rem;color:#2C2C2C;margin:0 0 1rem;">${title}</h1>
            <p style="font-size:15px;line-height:1.6;color:#1a1a1a;margin:0 0 1.5rem;">${body}</p>
            ${extraHtml || ""}
            <div style="margin-top:1.5rem;">${buttonsHtml}</div>
          </td></tr>
          <tr><td style="padding:1.5rem 2rem;background:#FAF8F5;border-top:1px solid #E0DCD5;font-size:12px;color:#666;">
            Sears Melvin Memorials · 020 3835 2548 · info@searsmelvin.co.uk
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body></html>`;
}

async function sendResend(apiKey, { from, to, subject, html }) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to, subject, html }),
  });
  if (!res.ok) throw new Error(await res.text());
}

function escapeHtml(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
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
