/**
 * Customer Order Tracking API — /api/customer-order
 *
 * Customers access their order via a unique tracking token (sent in emails).
 * No login required — the token IS the authentication.
 *
 * GET  ?token=xxx                → view order status, inscription, proof
 * POST { action: "request-inscription-change", token, text, reason } → request inscription edit
 * POST { action: "approve-inscription", token }  → approve current inscription
 */

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function onRequest(context) {
  const { request, env } = context;
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) {
    return json({ ok: false, error: "Server config error" }, 500);
  }

  const url = new URL(request.url);

  if (request.method === "GET") {
    const token = url.searchParams.get("token");
    if (!token) return json({ ok: false, error: "Tracking token required" }, 400);
    return getOrderStatus(env, token);
  }

  if (request.method === "POST") {
    let data;
    try { data = await request.json(); }
    catch { return json({ ok: false, error: "Invalid JSON" }, 400); }

    if (data.action === "request-inscription-change") return requestInscriptionChange(env, data);
    if (data.action === "approve-inscription") return approveInscription(env, data);
    return json({ ok: false, error: "Unknown action" }, 400);
  }

  return json({ ok: false, error: "Method not allowed" }, 405);
}

// ==================== GET ORDER STATUS ====================
async function getOrderStatus(env, token) {
  const headers = sbHeaders(env);

  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/orders?tracking_token=eq.${encodeURIComponent(token)}&select=id,customer_name,sku,color,location,stage,status,inscription_text,inscription_status,proof_url,proof_uploaded_at,proof_notes,estimated_completion,installation_date,created_at,updated_at,product_config&limit=1`,
    { headers },
  );
  if (!res.ok) return json({ ok: false, error: "Database error" }, 500);
  const rows = await res.json();
  if (rows.length === 0) return json({ ok: false, error: "Order not found. Please check your tracking link." }, 404);

  const order = rows[0];

  // Log customer view
  await fetch(`${env.SUPABASE_URL}/rest/v1/customer_activity`, {
    method: "POST",
    headers: { ...headers, "Prefer": "return=minimal" },
    body: JSON.stringify({ order_id: order.id, action: "viewed" }),
  });

  // Get inscription change history
  const reqRes = await fetch(
    `${env.SUPABASE_URL}/rest/v1/inscription_requests?order_id=eq.${order.id}&select=id,requested_text,reason,status,created_at&order=created_at.desc&limit=10`,
    { headers },
  );
  let inscriptionHistory = [];
  if (reqRes.ok) {
    inscriptionHistory = await reqRes.json();
  }

  // Parse product config for display details
  const config = order.product_config ? safeParse(order.product_config) : null;

  // Build customer-safe response — NO internal notes, partner info, or pricing
  return json({
    ok: true,
    order: {
      ref: "SM-" + String(order.id).padStart(4, "0"),
      customerName: order.customer_name,
      product: order.sku || (config && config.name) || null,
      colour: order.color || (config && config.colour) || null,
      size: config && config.size || null,
      location: order.location || null,
      stage: order.stage || "quote_received",
      paymentStatus: order.status || "pending",
      inscription: {
        text: order.inscription_text || (config && config.inscription) || null,
        status: order.inscription_status || "pending",
      },
      proof: order.proof_url ? {
        url: order.proof_url,
        uploadedAt: order.proof_uploaded_at,
        notes: order.proof_notes || null,
      } : null,
      estimatedCompletion: order.estimated_completion || null,
      installationDate: order.installation_date || null,
      createdAt: order.created_at,
      updatedAt: order.updated_at || null,
    },
    inscriptionHistory,
  });
}

// ==================== REQUEST INSCRIPTION CHANGE ====================
async function requestInscriptionChange(env, { token, text, reason }) {
  if (!token) return json({ ok: false, error: "Tracking token required" }, 400);
  if (!text || !text.trim()) return json({ ok: false, error: "New inscription text is required" }, 400);

  const headers = sbHeaders(env);

  // Find order
  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/orders?tracking_token=eq.${encodeURIComponent(token)}&select=id,stage&limit=1`,
    { headers },
  );
  if (!res.ok) return json({ ok: false, error: "Database error" }, 500);
  const rows = await res.json();
  if (rows.length === 0) return json({ ok: false, error: "Order not found" }, 404);

  const order = rows[0];

  // Don't allow changes once in production or completed
  if (order.stage === "in_production" || order.stage === "installation_scheduled" || order.stage === "completed") {
    return json({ ok: false, error: "Inscription changes cannot be made at this stage. Please contact us directly." }, 400);
  }

  // Create inscription change request
  const reqRes = await fetch(`${env.SUPABASE_URL}/rest/v1/inscription_requests`, {
    method: "POST",
    headers: { ...headers, "Prefer": "return=representation" },
    body: JSON.stringify({
      order_id: order.id,
      requested_text: text.trim(),
      reason: reason ? reason.trim() : null,
      status: "pending",
    }),
  });
  if (!reqRes.ok) return json({ ok: false, error: "Failed to submit request" }, 500);

  // Update order inscription status
  await fetch(`${env.SUPABASE_URL}/rest/v1/orders?id=eq.${order.id}`, {
    method: "PATCH",
    headers: { ...headers, "Prefer": "return=minimal" },
    body: JSON.stringify({
      inscription_status: "change_requested",
      updated_at: new Date().toISOString(),
    }),
  });

  // Log activity
  await fetch(`${env.SUPABASE_URL}/rest/v1/customer_activity`, {
    method: "POST",
    headers: { ...headers, "Prefer": "return=minimal" },
    body: JSON.stringify({ order_id: order.id, action: "inscription_change", detail: text.trim() }),
  });

  return json({ ok: true, message: "Your inscription change request has been submitted. We'll review it and update your proof." });
}

// ==================== APPROVE INSCRIPTION ====================
async function approveInscription(env, { token }) {
  if (!token) return json({ ok: false, error: "Tracking token required" }, 400);

  const headers = sbHeaders(env);

  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/orders?tracking_token=eq.${encodeURIComponent(token)}&select=id,inscription_text&limit=1`,
    { headers },
  );
  if (!res.ok) return json({ ok: false, error: "Database error" }, 500);
  const rows = await res.json();
  if (rows.length === 0) return json({ ok: false, error: "Order not found" }, 404);

  const order = rows[0];

  await fetch(`${env.SUPABASE_URL}/rest/v1/orders?id=eq.${order.id}`, {
    method: "PATCH",
    headers: { ...headers, "Prefer": "return=minimal" },
    body: JSON.stringify({
      inscription_status: "approved",
      updated_at: new Date().toISOString(),
    }),
  });

  // Log activity
  await fetch(`${env.SUPABASE_URL}/rest/v1/customer_activity`, {
    method: "POST",
    headers: { ...headers, "Prefer": "return=minimal" },
    body: JSON.stringify({ order_id: order.id, action: "inscription_approved" }),
  });

  return json({ ok: true, message: "Inscription approved. We'll proceed with production." });
}

// ==================== HELPERS ====================
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
