/**
 * Customer Portal API — /api/customer-order
 *
 * GET  ?token=xxx               → single order view (backward compat)
 * GET  ?portal=xxx              → customer portal: all quotes + orders
 * POST { action: "send-portal-link", email }         → email customer their portal link
 * POST { action: "request-inscription-change", token, text, reason }
 * POST { action: "approve-inscription", token }
 * POST { action: "update-quote", portal, quoteId, inscription, notes }
 * POST { action: "accept-quote", portal, quoteId }
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
    const portalToken = url.searchParams.get("portal");
    if (portalToken) return getPortal(env, portalToken);
    const token = url.searchParams.get("token");
    if (token) return getOrderStatus(env, token);
    return json({ ok: false, error: "Token required" }, 400);
  }

  if (request.method === "POST") {
    let data;
    try { data = await request.json(); }
    catch { return json({ ok: false, error: "Invalid JSON" }, 400); }

    if (data.action === "send-portal-link") return sendPortalLink(env, data);
    // Legacy alias
    if (data.action === "resend-tracking") return sendPortalLink(env, data);
    if (data.action === "request-inscription-change") return requestInscriptionChange(env, data);
    if (data.action === "approve-inscription") return approveInscription(env, data);
    if (data.action === "update-quote") return updateQuote(env, data);
    if (data.action === "accept-quote") return acceptQuote(env, data);
    return json({ ok: false, error: "Unknown action" }, 400);
  }

  return json({ ok: false, error: "Method not allowed" }, 405);
}

// ==================== CUSTOMER PORTAL ====================
async function getPortal(env, portalToken) {
  const headers = sbHeaders(env);

  // Find person by portal token (covers leads + paying customers).
  const custRes = await fetch(
    `${env.SUPABASE_URL}/rest/v1/people?portal_token=eq.${encodeURIComponent(portalToken)}&select=id,first_name,last_name,email&limit=1`,
    { headers },
  );
  if (!custRes.ok) return json({ ok: false, error: "Database error" }, 500);
  const customers = await custRes.json();
  if (customers.length === 0) return json({ ok: false, error: "Invalid or expired link. Please request a new one." }, 404);

  const customer = customers[0];
  const personId = customer.id;

  // Single source of truth: every quote and order lives in `orders` (distinguished
  // by `order_type`). Fetch both with one round-trip and split client-side.
  const ordersSelect = [
    "id", "order_number", "order_type", "sku", "color", "value", "permit_fee",
    "location", "stage", "status",
    "inscription_text", "inscription_status",
    "proof_url", "proof_uploaded_at", "proof_notes",
    "estimated_completion", "installation_date",
    "tracking_token", "edit_token", "product_config", "notes",
    "created_at", "updated_at",
    "people(first_name,last_name,email)",
  ].join(",");
  const ordersRes = await fetch(
    `${env.SUPABASE_URL}/rest/v1/orders?person_id=eq.${personId}&select=${ordersSelect}&order=created_at.desc&limit=40`,
    { headers },
  );
  const allOrders = ordersRes.ok ? await ordersRes.json() : [];
  const quoteRows = allOrders.filter(o => o.order_type === "quote");
  const orderRows = allOrders.filter(o => o.order_type !== "quote");

  // Enquiries history.
  const enqRes = await fetch(
    `${env.SUPABASE_URL}/rest/v1/enquiries?person_id=eq.${personId}&select=id,channel,sub_type,message,appointment_at,appointment_kind,status,created_at&order=created_at.desc&limit=30`,
    { headers },
  );
  const enquiries = enqRes.ok ? await enqRes.json() : [];

  return json({
    ok: true,
    portal: true,
    customer: {
      firstName: customer.first_name,
      lastName: customer.last_name,
    },
    quotes: quoteRows.map(mapOrderRowToQuote),
    orders: orderRows.map(mapOrderRowToOrder),
    enquiries: enquiries.map(e => ({
      id: e.id,
      channel: e.channel,
      subType: e.sub_type || null,
      message: e.message || null,
      appointmentAt: e.appointment_at || null,
      appointmentKind: e.appointment_kind || null,
      status: e.status || "new",
      createdAt: e.created_at,
    })),
  });
}

function mapOrderRowToQuote(o) {
  const config = o.product_config ? safeParse(o.product_config) : null;
  const value = o.value != null ? Number(o.value) : null;
  const permit = o.permit_fee != null ? Number(o.permit_fee) : null;
  const total = (value != null || permit != null) ? (value || 0) + (permit || 0) : null;
  return {
    id: o.id,
    ref: "QT-" + String(o.order_number || "0000").padStart(4, "0"),
    product: o.sku || (config && config.name) || null,
    material: (config && config.material) || null,
    colour: o.color || (config && config.colour) || null,
    location: o.location || null,
    inscription: o.inscription_text || (config && config.inscription) || null,
    value,
    permitCost: permit,
    total,
    status: o.status || "pending",
    sentAt: o.created_at,
    expiresAt: null,
    notes: o.notes || null,
    createdAt: o.created_at,
  };
}

function mapOrderRowToOrder(o) {
  const config = o.product_config ? safeParse(o.product_config) : null;
  const personName = [o.people?.first_name, o.people?.last_name].filter(Boolean).join(" ") || null;
  return {
    id: o.id,
    ref: "SM-" + String(o.order_number || "0000"),
    customerName: personName,
    product: o.sku || (config && config.name) || null,
    colour: o.color || (config && config.colour) || null,
    location: o.location || null,
    stage: o.stage || "quote_received",
    paymentStatus: o.status || "pending",
    inscription: {
      text: o.inscription_text || (config && config.inscription) || null,
      status: o.inscription_status || "pending",
    },
    proof: o.proof_url ? {
      url: o.proof_url,
      uploadedAt: o.proof_uploaded_at,
      notes: o.proof_notes || null,
    } : null,
    estimatedCompletion: o.estimated_completion || null,
    installationDate: o.installation_date || null,
    trackingToken: o.tracking_token || null,
    createdAt: o.created_at,
    updatedAt: o.updated_at || null,
  };
}

// ==================== GET SINGLE ORDER (backward compat) ====================
async function getOrderStatus(env, token) {
  const headers = sbHeaders(env);

  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/orders?tracking_token=eq.${encodeURIComponent(token)}&select=id,order_number,sku,color,location,stage,status,inscription_text,inscription_status,proof_url,proof_uploaded_at,proof_notes,estimated_completion,installation_date,created_at,updated_at,product_config,people(first_name,last_name,email)&limit=1`,
    { headers },
  );
  if (!res.ok) return json({ ok: false, error: "Database error" }, 500);
  const rows = await res.json();
  if (rows.length === 0) return json({ ok: false, error: "Order not found. Please check your tracking link." }, 404);

  const order = rows[0];
  const config = order.product_config ? safeParse(order.product_config) : null;

  // Log customer view
  await fetch(`${env.SUPABASE_URL}/rest/v1/customer_activity`, {
    method: "POST",
    headers: { ...headers, "Prefer": "return=minimal" },
    body: JSON.stringify({ order_id: order.id, action: "viewed" }),
  }).catch(() => {});

  // Get inscription change history
  const reqRes = await fetch(
    `${env.SUPABASE_URL}/rest/v1/inscription_requests?order_id=eq.${order.id}&select=id,requested_text,reason,status,created_at&order=created_at.desc&limit=10`,
    { headers },
  );
  let inscriptionHistory = [];
  if (reqRes.ok) inscriptionHistory = await reqRes.json();

  return json({
    ok: true,
    order: {
      ref: "SM-" + String(order.order_number || "0000"),
      customerName: [order.people?.first_name, order.people?.last_name].filter(Boolean).join(" ") || null,
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

// ==================== SEND PORTAL LINK ====================
// Per-isolate cooldown for portal-link emails. Defends against scripted abuse
// from a single edge — a determined attacker can still spread requests across
// regions, so pair this with a Cloudflare zone-level rate-limit rule for full
// coverage. Map<email, timestamp_ms>; entries older than 60s are ignored.
const PORTAL_LINK_COOLDOWN_MS = 60_000;
const portalLinkRecent = new Map();
function _markPortalLinkSent(email) {
  portalLinkRecent.set(email, Date.now());
  // Sweep stale entries periodically so the map doesn't grow unbounded.
  if (portalLinkRecent.size > 200) {
    const cutoff = Date.now() - PORTAL_LINK_COOLDOWN_MS;
    for (const [k, t] of portalLinkRecent) if (t < cutoff) portalLinkRecent.delete(k);
  }
}
function _portalLinkOnCooldown(email) {
  const last = portalLinkRecent.get(email);
  return last != null && (Date.now() - last) < PORTAL_LINK_COOLDOWN_MS;
}

async function sendPortalLink(env, { email }) {
  const safeMsg = "If we have an account for that email, we've sent your portal link.";
  if (!email || !email.trim()) return json({ ok: true, message: safeMsg });

  const cleanEmail = email.trim().toLowerCase();
  // Same response either way so scripted callers can't infer cooldown vs no-account.
  if (_portalLinkOnCooldown(cleanEmail)) return json({ ok: true, message: safeMsg });
  const headers = sbHeaders(env);

  // Single lookup — `people.email` is stored lower-cased on insert/upsert.
  const custRes = await fetch(
    `${env.SUPABASE_URL}/rest/v1/people?email=eq.${encodeURIComponent(cleanEmail)}&select=id,first_name,last_name,portal_token&limit=1`,
    { headers },
  );
  let customer = null;
  if (custRes.ok) {
    const rows = await custRes.json();
    if (rows.length > 0) customer = rows[0];
  }
  if (!customer) return json({ ok: true, message: safeMsg });

  // Generate portal token if missing
  if (!customer.portal_token) {
    const token = "cust-portal-" + crypto.randomUUID().replace(/-/g, "");
    await fetch(`${env.SUPABASE_URL}/rest/v1/people?id=eq.${customer.id}`, {
      method: "PATCH",
      headers: { ...headers, "Prefer": "return=minimal" },
      body: JSON.stringify({ portal_token: token }),
    });
    customer.portal_token = token;
  }

  // Send email
  if (!env.RESEND_API_KEY) {
    console.error("RESEND_API_KEY not configured");
    return json({ ok: false, error: "Email service is temporarily unavailable. Please contact us directly." }, 500);
  }

  const firstName = customer.first_name || "there";
  const portalUrl = `https://searsmelvin.co.uk/track.html?portal=${customer.portal_token}`;

  try {
    const emailRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: "Sears Melvin Memorials <info@searsmelvin.co.uk>",
        to: cleanEmail,
        subject: "Your Quotes & Orders — Sears Melvin Memorials",
        html: `<div style="font-family:-apple-system,sans-serif;max-width:480px;margin:0 auto;padding:2rem;">
          <h2 style="font-family:Georgia,serif;color:#2C2C2C;font-weight:400;">Your Portal Link</h2>
          <p>Hi ${firstName},</p>
          <p>Click the button below to view your quotes and track your orders with Sears Melvin Memorials.</p>
          <div style="text-align:center;margin:2rem 0;">
            <a href="${portalUrl}" style="display:inline-block;padding:0.85rem 2rem;background:#2C2C2C;color:white;text-decoration:none;border-radius:6px;font-weight:500;font-size:1rem;">View My Quotes & Orders</a>
          </div>
          <p style="color:#666;font-size:0.85rem;">This link is unique to you — please don't share it. You can request a new link at any time from our website.</p>
          <hr style="border:none;border-top:1px solid #E0DCD5;margin:2rem 0;">
          <p style="color:#999;font-size:0.75rem;">Sears Melvin Memorials</p>
        </div>`,
      }),
    });
    if (!emailRes.ok) {
      const body = await emailRes.text();
      console.error(`Resend error ${emailRes.status}: ${body}`);
      return json({ ok: false, error: "Failed to send email. Please try again or contact us directly." }, 500);
    }
  } catch (err) {
    console.error("Failed to send portal email:", err);
    return json({ ok: false, error: "Failed to send email. Please try again or contact us directly." }, 500);
  }

  _markPortalLinkSent(cleanEmail);
  return json({ ok: true, message: "We've sent your portal link to " + cleanEmail + ". Please check your inbox and spam folder." });
}

// ==================== UPDATE QUOTE ====================
// Quotes live in `orders` (order_type='quote'). The frontend calls this with
// `quoteId` = orders.id; we verify ownership by joining person_id back to the
// portal's customer.
async function updateQuote(env, { portal, quoteId, inscription, notes }) {
  if (!portal || !quoteId) return json({ ok: false, error: "Missing required fields" }, 400);

  const headers = sbHeaders(env);
  const customer = await getCustomerByPortal(env, portal);
  if (!customer) return json({ ok: false, error: "Invalid link" }, 403);

  const qRes = await fetch(
    `${env.SUPABASE_URL}/rest/v1/orders?id=eq.${encodeURIComponent(quoteId)}&person_id=eq.${customer.id}&order_type=eq.quote&select=id,status&limit=1`,
    { headers },
  );
  if (!qRes.ok) return json({ ok: false, error: "Database error" }, 500);
  const quotes = await qRes.json();
  if (quotes.length === 0) return json({ ok: false, error: "Quote not found" }, 404);

  const quote = quotes[0];
  if (quote.status === "completed" || quote.status === "expired") {
    return json({ ok: false, error: "This quote can no longer be edited." }, 400);
  }

  const updates = { updated_at: new Date().toISOString() };
  if (inscription !== undefined) updates.inscription_text = inscription.trim();
  if (notes !== undefined) updates.notes = notes.trim();

  await fetch(`${env.SUPABASE_URL}/rest/v1/orders?id=eq.${quoteId}`, {
    method: "PATCH",
    headers: { ...headers, "Prefer": "return=minimal" },
    body: JSON.stringify(updates),
  });

  return json({ ok: true, message: "Quote updated." });
}

// ==================== ACCEPT QUOTE ====================
async function acceptQuote(env, { portal, quoteId }) {
  if (!portal || !quoteId) return json({ ok: false, error: "Missing required fields" }, 400);

  const headers = sbHeaders(env);
  const customer = await getCustomerByPortal(env, portal);
  if (!customer) return json({ ok: false, error: "Invalid link" }, 403);

  const qRes = await fetch(
    `${env.SUPABASE_URL}/rest/v1/orders?id=eq.${encodeURIComponent(quoteId)}&person_id=eq.${customer.id}&order_type=eq.quote&select=id,status&limit=1`,
    { headers },
  );
  if (!qRes.ok) return json({ ok: false, error: "Database error" }, 500);
  const quotes = await qRes.json();
  if (quotes.length === 0) return json({ ok: false, error: "Quote not found" }, 404);

  if (quotes[0].status === "accepted" || quotes[0].status === "partial" || quotes[0].status === "completed") {
    return json({ ok: false, error: "This quote has already been accepted." }, 400);
  }
  if (quotes[0].status === "expired") return json({ ok: false, error: "This quote has expired. Please contact us for a new quote." }, 400);

  await fetch(`${env.SUPABASE_URL}/rest/v1/orders?id=eq.${quoteId}`, {
    method: "PATCH",
    headers: { ...headers, "Prefer": "return=minimal" },
    body: JSON.stringify({
      status: "accepted",
      updated_at: new Date().toISOString(),
    }),
  });

  return json({ ok: true, message: "Quote accepted! We'll be in touch shortly to arrange next steps." });
}

// ==================== REQUEST INSCRIPTION CHANGE ====================
async function requestInscriptionChange(env, { token, text, reason }) {
  if (!token) return json({ ok: false, error: "Tracking token required" }, 400);
  if (!text || !text.trim()) return json({ ok: false, error: "New inscription text is required" }, 400);

  const headers = sbHeaders(env);

  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/orders?tracking_token=eq.${encodeURIComponent(token)}&select=id,stage&limit=1`,
    { headers },
  );
  if (!res.ok) return json({ ok: false, error: "Database error" }, 500);
  const rows = await res.json();
  if (rows.length === 0) return json({ ok: false, error: "Order not found" }, 404);

  const order = rows[0];
  if (order.stage === "in_production" || order.stage === "installation_scheduled" || order.stage === "completed") {
    return json({ ok: false, error: "Inscription changes cannot be made at this stage. Please contact us directly." }, 400);
  }

  await fetch(`${env.SUPABASE_URL}/rest/v1/inscription_requests`, {
    method: "POST",
    headers: { ...headers, "Prefer": "return=minimal" },
    body: JSON.stringify({
      order_id: order.id,
      requested_text: text.trim(),
      reason: reason ? reason.trim() : null,
      status: "pending",
    }),
  });

  await fetch(`${env.SUPABASE_URL}/rest/v1/orders?id=eq.${order.id}`, {
    method: "PATCH",
    headers: { ...headers, "Prefer": "return=minimal" },
    body: JSON.stringify({ inscription_status: "change_requested", updated_at: new Date().toISOString() }),
  });

  return json({ ok: true, message: "Your inscription change request has been submitted. We'll review it and update your proof." });
}

// ==================== APPROVE INSCRIPTION ====================
async function approveInscription(env, { token }) {
  if (!token) return json({ ok: false, error: "Tracking token required" }, 400);

  const headers = sbHeaders(env);

  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/orders?tracking_token=eq.${encodeURIComponent(token)}&select=id&limit=1`,
    { headers },
  );
  if (!res.ok) return json({ ok: false, error: "Database error" }, 500);
  const rows = await res.json();
  if (rows.length === 0) return json({ ok: false, error: "Order not found" }, 404);

  await fetch(`${env.SUPABASE_URL}/rest/v1/orders?id=eq.${rows[0].id}`, {
    method: "PATCH",
    headers: { ...headers, "Prefer": "return=minimal" },
    body: JSON.stringify({ inscription_status: "approved", updated_at: new Date().toISOString() }),
  });

  return json({ ok: true, message: "Inscription approved. We'll proceed with production." });
}

// ==================== HELPERS ====================
async function getCustomerByPortal(env, portalToken) {
  const headers = sbHeaders(env);
  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/people?portal_token=eq.${encodeURIComponent(portalToken)}&select=id,first_name,email&limit=1`,
    { headers },
  );
  if (!res.ok) return null;
  const rows = await res.json();
  return rows.length > 0 ? rows[0] : null;
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
