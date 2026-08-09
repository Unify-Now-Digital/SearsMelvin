/**
 * Partner Orders API — /api/partner-orders
 *
 * All requests require a valid HttpOnly partner session cookie.
 *
 * GET                        → list partner's orders
 * GET ?id=123                → single order detail with comments
 * POST { action: "create" }  → create order on behalf of customer
 * POST { action: "comment" } → add comment to an order
 */

import { upsertPerson } from "./submit.js";
import {
  RequestValidationError,
  checkRateLimit,
  getClientAddress,
  hardenedJson,
  isSameOriginRequest,
  queueSecurityEvent,
  rateLimitResponse,
  readBoundedJson,
  supabaseHeaders,
} from "./_security.js";

const PARTNER_COOKIE = "__Host-sm_partner_session";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: { "Allow": "GET, POST, OPTIONS" } });
}

export async function onRequest(context) {
  const { request, env } = context;
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY || !UUID_PATTERN.test(String(env.SM_ORG_ID || ""))) {
    return json({ ok: false, error: "Server config error" }, 500);
  }
  if (!isSameOriginRequest(request)) {
    return json({ ok: false, error: "Forbidden" }, 403);
  }

  const broadLimit = await checkRateLimit(env, request, "partner-orders-ip", getClientAddress(request), {
    maxAttempts: 600,
    windowSeconds: 300,
    blockSeconds: 300,
    failClosed: true,
  });
  if (!broadLimit.allowed) return rateLimitResponse(json, broadLimit.retryAfter);

  // Authenticate
  const token = getCookie(request, PARTNER_COOKIE)
    || (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return json({ ok: false, error: "Authentication required" }, 401);

  const partner = await getPartnerFromToken(env, token);
  if (!partner) return json({ ok: false, error: "Invalid or expired session" }, 401);

  const partnerLimit = await checkRateLimit(env, request, "partner-orders-account", String(partner.id), {
    maxAttempts: 300,
    windowSeconds: 300,
    blockSeconds: 300,
    failClosed: true,
  });
  if (!partnerLimit.allowed) {
    queueSecurityEvent(context, env, request, {
      eventType: "partner_orders_rate_limited",
      actorType: "partner",
      success: false,
      metadata: { partner_id: partner.id, retry_after: partnerLimit.retryAfter },
    });
    return rateLimitResponse(json, partnerLimit.retryAfter);
  }

  const url = new URL(request.url);

  if (request.method === "GET") {
    const orderId = url.searchParams.get("id");
    if (orderId) {
      if (!UUID_PATTERN.test(orderId)) return json({ ok: false, error: "Invalid order ID" }, 400);
      return getOrderDetail(env, partner, orderId);
    }
    return listOrders(env, partner, url.searchParams);
  }

  if (request.method === "POST") {
    let data;
    try { data = await readBoundedJson(request); }
    catch (error) {
      const status = error instanceof RequestValidationError ? error.status : 400;
      return json({ ok: false, error: error instanceof RequestValidationError ? error.message : "Invalid JSON" }, status);
    }

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
  if (search && search.length > 100) return json({ ok: false, error: "Search is too long" }, 400);
  if (status && status.length > 40) return json({ ok: false, error: "Invalid status" }, 400);

  let url = `${env.SUPABASE_URL}/rest/v1/orders?organization_id=eq.${encodeURIComponent(env.SM_ORG_ID)}&partner_id=eq.${partner.id}&select=*,people(id,first_name,last_name,email,phone,is_customer)&order=created_at.desc&limit=50`;
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
    `${env.SUPABASE_URL}/rest/v1/orders?id=eq.${encodeURIComponent(orderId)}&organization_id=eq.${encodeURIComponent(env.SM_ORG_ID)}&partner_id=eq.${partner.id}&select=*,people(id,first_name,last_name,email,phone,is_customer)&limit=1`,
    { headers },
  );
  if (!res.ok) return json({ ok: false, error: "Database error" }, 500);
  const rows = await res.json();
  if (rows.length === 0) return json({ ok: false, error: "Order not found" }, 404);

  const order = mapOrder(rows[0]);

  // Get comments
  const commentsRes = await fetch(
    `${env.SUPABASE_URL}/rest/v1/partner_comments?order_id=eq.${orderId}&partner_id=eq.${partner.id}&select=id,comment,created_at&order=created_at.asc`,
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

  const cleanName = boundedText(customerName, 120);
  const cleanEmail = typeof customerEmail === "string" ? customerEmail.trim().toLowerCase() : "";
  const cleanPhone = boundedText(customerPhone, 40, true);
  const cleanProduct = boundedText(product, 160, true);
  const cleanColour = boundedText(colour, 80, true);
  const cleanSize = boundedText(size, 80, true);
  const cleanLocation = boundedText(location, 250, true);
  const cleanNotes = boundedText(notes, 2000, true);
  const numericValue = value === "" || value == null ? null : Number(value);

  if (!cleanName || !cleanEmail) {
    return json({ ok: false, error: "Customer name and email are required" }, 400);
  }
  if (cleanEmail.length > 254 || !/^\S+@\S+\.\S+$/.test(cleanEmail)) {
    return json({ ok: false, error: "A valid customer email is required" }, 400);
  }
  if ([cleanPhone, cleanProduct, cleanColour, cleanSize, cleanLocation, cleanNotes].some(value => value === null)) {
    return json({ ok: false, error: "One or more fields are too long" }, 400);
  }
  if (numericValue !== null && (!Number.isFinite(numericValue) || numericValue < 0 || numericValue > 1000000)) {
    return json({ ok: false, error: "Invalid order value" }, 400);
  }

  const headers = sbHeaders(env);

  // Upsert the retail customer into the unified `people` table first.
  let person;
  try {
    person = await upsertPerson(env, {
      name: cleanName,
      email: cleanEmail,
      phone: cleanPhone,
    });
  } catch {
    return json({ ok: false, error: "Failed to register customer" }, 500);
  }
  if (!person) return json({ ok: false, error: "Failed to register customer" }, 500);

  // Create order linked to partner AND to the person record.
  const orderBody = {
    organization_id: env.SM_ORG_ID,
    person_id: person.id,
    order_type: "quote",
    sku: cleanProduct || null,
    color: cleanColour || null,
    value: numericValue,
    location: cleanLocation || null,
    partner_id: partner.id,
    status: "pending",
    notes: cleanNotes || null,
    product_config: cleanProduct ? JSON.stringify({
      name: cleanProduct,
      colour: cleanColour,
      size: cleanSize,
      price: numericValue,
    }) : null,
  };

  const orderRes = await fetch(`${env.SUPABASE_URL}/rest/v1/orders?select=*,people(id,first_name,last_name,email,phone,is_customer)`, {
    method: "POST",
    headers: { ...headers, "Prefer": "return=representation" },
    body: JSON.stringify(orderBody),
  });

  if (!orderRes.ok) {
    return json({ ok: false, error: "Failed to create order" }, 500);
  }

  const orderRows = await orderRes.json();
  return json({ ok: true, order: mapOrder(orderRows[0]) });
}

// ==================== ADD COMMENT ====================
async function addComment(env, partner, data) {
  const { orderId, comment } = data;
  if (!orderId || !comment) return json({ ok: false, error: "Order ID and comment required" }, 400);
  if (typeof orderId !== "string" || !UUID_PATTERN.test(orderId)) {
    return json({ ok: false, error: "Invalid order ID" }, 400);
  }
  const cleanComment = boundedText(comment, 2000);
  if (!cleanComment) return json({ ok: false, error: "Comment must be 1-2000 characters" }, 400);

  const headers = sbHeaders(env);

  // Verify order belongs to partner
  const checkRes = await fetch(
    `${env.SUPABASE_URL}/rest/v1/orders?id=eq.${encodeURIComponent(orderId)}&organization_id=eq.${encodeURIComponent(env.SM_ORG_ID)}&partner_id=eq.${partner.id}&select=id&limit=1`,
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
      comment: cleanComment,
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
  const tokenHash = await hashOpaqueToken(token);
  let sessRows = await findPartnerSession(env, tokenHash, now, headers);
  if (sessRows === null) return null;
  // Compatibility for pre-hardening sessions; no new plaintext token is stored.
  if (sessRows.length === 0) sessRows = await findPartnerSession(env, token, now, headers) || [];
  if (sessRows.length === 0) return null;

  const partRes = await fetch(
    `${env.SUPABASE_URL}/rest/v1/partners?id=eq.${sessRows[0].partner_id}&active=eq.true&status=eq.approved&select=id,email,name,company&limit=1`,
    { headers },
  );
  if (!partRes.ok) return null;
  const partRows = await partRes.json();
  return partRows.length > 0 ? partRows[0] : null;
}

function safeParse(str) {
  try { return JSON.parse(str); } catch { return null; }
}

function boundedText(value, maxLength, optional = false) {
  if (value == null || value === "") return optional ? "" : null;
  if (typeof value !== "string") return null;
  const clean = value.trim();
  if (clean.length === 0) return optional ? "" : null;
  return clean.length <= maxLength ? clean : null;
}

async function hashOpaqueToken(token) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return "sha256:" + Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("");
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

async function findPartnerSession(env, token, now, headers) {
  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/partner_sessions?token=eq.${encodeURIComponent(token)}&expires_at=gt.${encodeURIComponent(now)}&select=partner_id&limit=1`,
    { headers },
  );
  return res.ok ? res.json() : null;
}

function sbHeaders(env) {
  return supabaseHeaders(env);
}

function json(data, status = 200, extraHeaders = {}) {
  return hardenedJson(data, status, extraHeaders);
}
