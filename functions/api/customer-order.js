/**
 * Customer Portal API — /api/customer-order
 *
 * POST { action: "send-portal-link", email }         → email customer their portal link
 * POST { action: "get-order-status", token }         → single order view
 * POST { action: "get-portal", portal }              → customer portal: all quotes + orders
 * POST { action: "request-inscription-change", token, text, reason }
 * POST { action: "approve-inscription", token }
 * POST { action: "update-quote", portal, quoteId, inscription, notes }
 * POST { action: "accept-quote", portal, quoteId }
 */

import {
  RequestValidationError,
  checkRateLimit,
  getClientAddress,
  hardenedJson,
  isSameOriginRequest,
  rateLimitResponse,
  readBoundedJson,
} from "./_security.js";

const CAPABILITY_TOKEN_RE = /^[A-Za-z0-9_-]{24,256}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CUSTOMER_PORTAL_TOKEN_SECONDS = 7 * 24 * 60 * 60;

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: { "Allow": "POST, OPTIONS" } });
}

export async function onRequest(context) {
  const { request, env } = context;
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY || !UUID_RE.test(String(env.SM_ORG_ID || ""))) {
    return json({ ok: false, error: "Server config error" }, 500);
  }
  if (!isSameOriginRequest(request)) return json({ ok: false, error: "Forbidden" }, 403);

  const broadLimit = await checkRateLimit(env, request, "customer-portal-ip", getClientAddress(request), {
    maxAttempts: 240,
    windowSeconds: 3600,
    blockSeconds: 3600,
    failClosed: true,
  });
  if (!broadLimit.allowed) return rateLimitResponse(json, broadLimit.retryAfter);

  if (request.method === "GET") {
    return json({ ok: false, error: "Method not allowed" }, 405);
  }

  if (request.method === "POST") {
    let data;
    try { data = await readBoundedJson(request); }
    catch (error) {
      const status = error instanceof RequestValidationError ? error.status : 400;
      return json({ ok: false, error: error instanceof RequestValidationError ? error.message : "Invalid JSON" }, status);
    }

    if (data.action === "send-portal-link" || data.action === "resend-tracking") {
      const email = normaliseEmail(data.email);
      const [ipLimit, emailLimit] = await Promise.all([
        checkRateLimit(env, request, "portal-link-ip", getClientAddress(request), {
          maxAttempts: 8, windowSeconds: 3600, blockSeconds: 3600, failClosed: true,
        }),
        checkRateLimit(env, request, "portal-link-email", email || "invalid", {
          maxAttempts: 3, windowSeconds: 3600, blockSeconds: 3600, failClosed: true,
        }),
      ]);
      if (!ipLimit.allowed || !emailLimit.allowed) {
        return json({ ok: true, message: portalLinkMessage() });
      }
      return sendPortalLink(env, { email });
    }
    if (data.action === "get-portal") {
      if (!CAPABILITY_TOKEN_RE.test(String(data.portal || ""))) return json({ ok: false, error: "Invalid link" }, 403);
      return getPortal(env, data.portal);
    }
    if (data.action === "get-order-status") {
      if (!CAPABILITY_TOKEN_RE.test(String(data.token || ""))) return json({ ok: false, error: "Invalid link" }, 403);
      return getOrderStatus(env, data.token);
    }
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
  const tokenHash = await hashCapabilityToken(portalToken);
  const now = new Date().toISOString();

  // Portal capabilities are organisation-specific, short-lived and stored only
  // as hashes. A token from another tenant cannot open Sears Melvin records.
  const tokenRes = await fetch(
    `${env.SUPABASE_URL}/rest/v1/customer_portal_tokens?organization_id=eq.${encodeURIComponent(env.SM_ORG_ID)}&token_hash=eq.${encodeURIComponent(tokenHash)}&expires_at=gt.${encodeURIComponent(now)}&select=person_id&limit=1`,
    { headers },
  );
  if (!tokenRes.ok) return json({ ok: false, error: "Database error" }, 500);
  const tokenRows = await tokenRes.json();
  if (tokenRows.length === 0) return json({ ok: false, error: "Invalid or expired link. Please request a new one." }, 404);

  const custRes = await fetch(
    `${env.SUPABASE_URL}/rest/v1/people?id=eq.${encodeURIComponent(tokenRows[0].person_id)}&select=id,first_name,last_name,email&limit=1`,
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
    "product_config", "notes",
    "created_at", "updated_at",
    "people(first_name,last_name,email)",
  ].join(",");
  const ordersRes = await fetch(
    `${env.SUPABASE_URL}/rest/v1/orders?organization_id=eq.${encodeURIComponent(env.SM_ORG_ID)}&person_id=eq.${encodeURIComponent(personId)}&select=${ordersSelect}&order=created_at.desc&limit=40`,
    { headers },
  );
  const allOrders = ordersRes.ok ? await ordersRes.json() : [];
  const quoteRows = allOrders.filter(o => o.order_type === "quote");
  const orderRows = allOrders.filter(o => o.order_type !== "quote");

  // Enquiries history.
  const enqRes = await fetch(
    `${env.SUPABASE_URL}/rest/v1/enquiries?organization_id=eq.${encodeURIComponent(env.SM_ORG_ID)}&person_id=eq.${encodeURIComponent(personId)}&select=id,channel,sub_type,message,appointment_at,appointment_kind,status,created_at&order=created_at.desc&limit=30`,
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
    createdAt: o.created_at,
    updatedAt: o.updated_at || null,
  };
}

// ==================== GET SINGLE ORDER (backward compat) ====================
async function getOrderStatus(env, token) {
  const headers = sbHeaders(env);
  const orderId = await getOrderIdFromTrackingToken(env, token, headers);
  if (!orderId) return json({ ok: false, error: "Order not found. Please check your tracking link." }, 404);

  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/orders?id=eq.${encodeURIComponent(orderId)}&organization_id=eq.${encodeURIComponent(env.SM_ORG_ID)}&select=id,order_number,sku,color,location,stage,status,inscription_text,inscription_status,proof_url,proof_uploaded_at,proof_notes,estimated_completion,installation_date,created_at,updated_at,product_config,people(first_name,last_name,email)&limit=1`,
    { headers },
  );
  if (!res.ok) return json({ ok: false, error: "Database error" }, 500);
  const rows = await res.json();
  if (rows.length === 0) return json({ ok: false, error: "Order not found. Please check your tracking link." }, 404);

  const order = rows[0];
  const config = order.product_config ? safeParse(order.product_config) : null;

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
async function sendPortalLink(env, { email }) {
  const safeMsg = portalLinkMessage();
  const cleanEmail = normaliseEmail(email);
  if (!cleanEmail) return json({ ok: true, message: safeMsg });
  const headers = sbHeaders(env);

  // People are globally deduplicated by email in the shared CRM, so confirm the
  // person has Sears Melvin activity before issuing a Sears capability.
  const custRes = await fetch(
    `${env.SUPABASE_URL}/rest/v1/people?email=eq.${encodeURIComponent(cleanEmail)}&select=id,first_name,last_name&limit=1`,
    { headers },
  );
  let customer = null;
  if (custRes.ok) {
    const rows = await custRes.json();
    if (rows.length > 0) customer = rows[0];
  }
  if (!customer) return json({ ok: true, message: safeMsg });
  if (!await hasOrganizationActivity(env, customer.id)) return json({ ok: true, message: safeMsg });

  // Rotate the seven-day link every time. Only its SHA-256 fingerprint is
  // stored, so a database read cannot recover a usable portal capability.
  const token = generateCapabilityToken();
  const tokenHash = await hashCapabilityToken(token);
  const tokenRes = await fetch(`${env.SUPABASE_URL}/rest/v1/customer_portal_tokens?on_conflict=organization_id,person_id`, {
    method: "POST",
    headers: { ...headers, "Prefer": "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({
      organization_id: env.SM_ORG_ID,
      person_id: customer.id,
      token_hash: tokenHash,
      expires_at: new Date(Date.now() + CUSTOMER_PORTAL_TOKEN_SECONDS * 1000).toISOString(),
      updated_at: new Date().toISOString(),
    }),
  });
  if (!tokenRes.ok) {
    console.error(JSON.stringify({ message: "portal_token_rotation_failed", status: tokenRes.status }));
    return json({ ok: true, message: safeMsg });
  }
  // Send email
  if (!env.RESEND_API_KEY) {
    console.error("RESEND_API_KEY not configured");
    return json({ ok: true, message: safeMsg });
  }

  const firstName = customer.first_name || "there";
  const portalUrl = `https://searsmelvin.co.uk/track#portal=${encodeURIComponent(token)}`;

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
          <p>Hi ${escapeHtml(firstName)},</p>
          <p>Click the button below to view your quotes and track your orders with Sears Melvin Memorials.</p>
          <div style="text-align:center;margin:2rem 0;">
            <a href="${portalUrl}" style="display:inline-block;padding:0.85rem 2rem;background:#2C2C2C;color:white;text-decoration:none;border-radius:6px;font-weight:500;font-size:1rem;">View My Quotes & Orders</a>
          </div>
          <p style="color:#666;font-size:0.85rem;">This link is unique to you and expires in 7 days — please don't share it. You can request a new link at any time from our website.</p>
          <hr style="border:none;border-top:1px solid #E0DCD5;margin:2rem 0;">
          <p style="color:#999;font-size:0.75rem;">Sears Melvin Memorials</p>
        </div>`,
      }),
    });
    if (!emailRes.ok) {
      console.error(JSON.stringify({ message: "portal_email_failed", status: emailRes.status }));
      return json({ ok: true, message: safeMsg });
    }
  } catch {
    console.error(JSON.stringify({ message: "portal_email_unavailable" }));
    return json({ ok: true, message: safeMsg });
  }

  return json({ ok: true, message: safeMsg });
}

// ==================== UPDATE QUOTE ====================
// Quotes live in `orders` (order_type='quote'). The frontend calls this with
// `quoteId` = orders.id; we verify ownership by joining person_id back to the
// portal's customer.
async function updateQuote(env, { portal, quoteId, inscription, notes }) {
  if (!CAPABILITY_TOKEN_RE.test(String(portal || "")) || !UUID_RE.test(String(quoteId || ""))) {
    return json({ ok: false, error: "Invalid link or quote" }, 400);
  }
  if (inscription !== undefined && (typeof inscription !== "string" || inscription.length > 1000)) {
    return json({ ok: false, error: "Inscription is too long" }, 400);
  }
  if (notes !== undefined && (typeof notes !== "string" || notes.length > 2000)) {
    return json({ ok: false, error: "Notes are too long" }, 400);
  }

  const headers = sbHeaders(env);
  const customer = await getCustomerByPortal(env, portal);
  if (!customer) return json({ ok: false, error: "Invalid link" }, 403);

  const qRes = await fetch(
    `${env.SUPABASE_URL}/rest/v1/orders?id=eq.${encodeURIComponent(quoteId)}&organization_id=eq.${encodeURIComponent(env.SM_ORG_ID)}&person_id=eq.${encodeURIComponent(customer.id)}&order_type=eq.quote&select=id,status&limit=1`,
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

  await fetch(`${env.SUPABASE_URL}/rest/v1/orders?id=eq.${encodeURIComponent(quoteId)}&organization_id=eq.${encodeURIComponent(env.SM_ORG_ID)}`, {
    method: "PATCH",
    headers: { ...headers, "Prefer": "return=minimal" },
    body: JSON.stringify(updates),
  });

  return json({ ok: true, message: "Quote updated." });
}

// ==================== ACCEPT QUOTE ====================
async function acceptQuote(env, { portal, quoteId }) {
  if (!CAPABILITY_TOKEN_RE.test(String(portal || "")) || !UUID_RE.test(String(quoteId || ""))) {
    return json({ ok: false, error: "Invalid link or quote" }, 400);
  }

  const headers = sbHeaders(env);
  const customer = await getCustomerByPortal(env, portal);
  if (!customer) return json({ ok: false, error: "Invalid link" }, 403);

  const qRes = await fetch(
    `${env.SUPABASE_URL}/rest/v1/orders?id=eq.${encodeURIComponent(quoteId)}&organization_id=eq.${encodeURIComponent(env.SM_ORG_ID)}&person_id=eq.${encodeURIComponent(customer.id)}&order_type=eq.quote&select=id,status&limit=1`,
    { headers },
  );
  if (!qRes.ok) return json({ ok: false, error: "Database error" }, 500);
  const quotes = await qRes.json();
  if (quotes.length === 0) return json({ ok: false, error: "Quote not found" }, 404);

  if (quotes[0].status === "accepted" || quotes[0].status === "partial" || quotes[0].status === "completed") {
    return json({ ok: false, error: "This quote has already been accepted." }, 400);
  }
  if (quotes[0].status === "expired") return json({ ok: false, error: "This quote has expired. Please contact us for a new quote." }, 400);

  await fetch(`${env.SUPABASE_URL}/rest/v1/orders?id=eq.${encodeURIComponent(quoteId)}&organization_id=eq.${encodeURIComponent(env.SM_ORG_ID)}`, {
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
async function requestInscriptionChange(env, { token, portal, orderId, text, reason }) {
  if (typeof text !== "string" || !text.trim() || text.length > 1000) {
    return json({ ok: false, error: "New inscription text is required and must be under 1,000 characters" }, 400);
  }
  if (reason !== undefined && reason !== null && (typeof reason !== "string" || reason.length > 1000)) {
    return json({ ok: false, error: "Reason is too long" }, 400);
  }

  const headers = sbHeaders(env);
  const resolvedOrderId = await resolveOrderCapability(env, { token, portal, orderId }, headers);
  if (!resolvedOrderId) return json({ ok: false, error: "Invalid or expired link" }, 403);

  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/orders?id=eq.${encodeURIComponent(resolvedOrderId)}&organization_id=eq.${encodeURIComponent(env.SM_ORG_ID)}&select=id,stage&limit=1`,
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

  await fetch(`${env.SUPABASE_URL}/rest/v1/orders?id=eq.${encodeURIComponent(order.id)}&organization_id=eq.${encodeURIComponent(env.SM_ORG_ID)}`, {
    method: "PATCH",
    headers: { ...headers, "Prefer": "return=minimal" },
    body: JSON.stringify({ inscription_status: "change_requested", updated_at: new Date().toISOString() }),
  });

  return json({ ok: true, message: "Your inscription change request has been submitted. We'll review it and update your proof." });
}

// ==================== APPROVE INSCRIPTION ====================
async function approveInscription(env, { token, portal, orderId }) {
  const headers = sbHeaders(env);
  const resolvedOrderId = await resolveOrderCapability(env, { token, portal, orderId }, headers);
  if (!resolvedOrderId) return json({ ok: false, error: "Invalid or expired link" }, 403);

  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/orders?id=eq.${encodeURIComponent(resolvedOrderId)}&organization_id=eq.${encodeURIComponent(env.SM_ORG_ID)}&select=id&limit=1`,
    { headers },
  );
  if (!res.ok) return json({ ok: false, error: "Database error" }, 500);
  const rows = await res.json();
  if (rows.length === 0) return json({ ok: false, error: "Order not found" }, 404);

  await fetch(`${env.SUPABASE_URL}/rest/v1/orders?id=eq.${encodeURIComponent(rows[0].id)}&organization_id=eq.${encodeURIComponent(env.SM_ORG_ID)}`, {
    method: "PATCH",
    headers: { ...headers, "Prefer": "return=minimal" },
    body: JSON.stringify({ inscription_status: "approved", updated_at: new Date().toISOString() }),
  });

  return json({ ok: true, message: "Inscription approved. We'll proceed with production." });
}

// ==================== HELPERS ====================
async function getCustomerByPortal(env, portalToken) {
  const headers = sbHeaders(env);
  const tokenHash = await hashCapabilityToken(portalToken);
  const now = new Date().toISOString();
  const tokenRes = await fetch(
    `${env.SUPABASE_URL}/rest/v1/customer_portal_tokens?organization_id=eq.${encodeURIComponent(env.SM_ORG_ID)}&token_hash=eq.${encodeURIComponent(tokenHash)}&expires_at=gt.${encodeURIComponent(now)}&select=person_id&limit=1`,
    { headers },
  );
  if (!tokenRes.ok) return null;
  const tokenRows = await tokenRes.json();
  if (tokenRows.length === 0) return null;
  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/people?id=eq.${encodeURIComponent(tokenRows[0].person_id)}&select=id,first_name,email&limit=1`,
    { headers },
  );
  if (!res.ok) return null;
  const rows = await res.json();
  return rows.length > 0 ? rows[0] : null;
}

async function getOrderIdFromTrackingToken(env, token, headers = sbHeaders(env)) {
  if (!CAPABILITY_TOKEN_RE.test(String(token || ""))) return null;
  const tokenHash = await hashCapabilityToken(token);
  const response = await fetch(
    `${env.SUPABASE_URL}/rest/v1/order_tracking_tokens?organization_id=eq.${encodeURIComponent(env.SM_ORG_ID)}&token_hash=eq.${encodeURIComponent(tokenHash)}&expires_at=gt.${encodeURIComponent(new Date().toISOString())}&select=order_id&limit=1`,
    { headers },
  );
  if (!response.ok) return null;
  const rows = await response.json();
  return rows[0]?.order_id || null;
}

async function resolveOrderCapability(env, { token, portal, orderId }, headers = sbHeaders(env)) {
  if (CAPABILITY_TOKEN_RE.test(String(token || ""))) {
    return getOrderIdFromTrackingToken(env, token, headers);
  }
  if (!CAPABILITY_TOKEN_RE.test(String(portal || "")) || !UUID_RE.test(String(orderId || ""))) return null;
  const customer = await getCustomerByPortal(env, portal);
  if (!customer) return null;
  const response = await fetch(
    `${env.SUPABASE_URL}/rest/v1/orders?id=eq.${encodeURIComponent(orderId)}&organization_id=eq.${encodeURIComponent(env.SM_ORG_ID)}&person_id=eq.${encodeURIComponent(customer.id)}&select=id&limit=1`,
    { headers },
  );
  if (!response.ok) return null;
  const rows = await response.json();
  return rows[0]?.id || null;
}

async function hasOrganizationActivity(env, personId) {
  const headers = sbHeaders(env);
  const [ordersRes, enquiriesRes] = await Promise.all([
    fetch(`${env.SUPABASE_URL}/rest/v1/orders?organization_id=eq.${encodeURIComponent(env.SM_ORG_ID)}&person_id=eq.${encodeURIComponent(personId)}&select=id&limit=1`, { headers }),
    fetch(`${env.SUPABASE_URL}/rest/v1/enquiries?organization_id=eq.${encodeURIComponent(env.SM_ORG_ID)}&person_id=eq.${encodeURIComponent(personId)}&select=id&limit=1`, { headers }),
  ]);
  if (!ordersRes.ok || !enquiriesRes.ok) return false;
  const [orders, enquiries] = await Promise.all([ordersRes.json(), enquiriesRes.json()]);
  return orders.length > 0 || enquiries.length > 0;
}

async function hashCapabilityToken(token) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return "sha256:" + Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

function safeParse(str) {
  try { return JSON.parse(str); } catch { return null; }
}

function normaliseEmail(value) {
  if (typeof value !== "string") return "";
  const email = value.trim().toLowerCase();
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "";
}

function portalLinkMessage() {
  return "If that email is in our records, a secure portal link is on its way.";
}

function generateCapabilityToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return "cust-portal-" + Array.from(bytes, value => value.toString(16).padStart(2, "0")).join("");
}

function escapeHtml(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function sbHeaders(env) {
  return {
    "apikey": env.SUPABASE_SERVICE_KEY,
    "Authorization": `Bearer ${env.SUPABASE_SERVICE_KEY}`,
    "Content-Type": "application/json",
  };
}

function json(data, status = 200) {
  return hardenedJson(data, status);
}
