/**
 * Admin API — /api/admin
 *
 * Sign-in actions establish a short-lived admin session. All other actions
 * require a valid, unexpired session token.
 *
 * POST { action: "google-login", credential }           → sign in with a Sears Melvin Workspace account
 * POST { action: "verify" }                             → verify the HttpOnly admin session cookie
 * POST { action: "logout" }                             → end the admin session
 * All remaining actions require the valid admin session cookie.
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
  sha256Hex,
  supabaseHeaders,
} from "./_security.js";
import { GoogleVerificationUnavailable, verifyGoogleIdToken } from "./_google-identity.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STAGE_VALUES = new Set([
  "quote_received", "deposit_paid", "design_in_progress", "proof_ready",
  "inscription_approved", "in_production", "installation_scheduled", "completed",
]);
const INSCRIPTION_STATUS_VALUES = new Set(["pending", "awaiting_approval", "approved", "change_requested"]);
const PARTNER_STATUS_VALUES = new Set(["pending", "approved", "declined"]);
const ENQUIRY_CHANNEL_VALUES = new Set(["quote", "contact", "appointment", "call", "shortlist"]);
const CUSTOMER_EMAIL_KINDS = new Set(["proof_ready", "tracking", "inscription_confirm"]);

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
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY || !UUID_RE.test(String(env.SM_ORG_ID || ""))) {
    return json({ ok: false, error: "Server config error" }, 500);
  }

  const broadLimit = await checkRateLimit(env, request, "admin-api-ip", getClientAddress(request), {
    maxAttempts: 600,
    windowSeconds: 300,
    blockSeconds: 300,
    failClosed: true,
  });
  if (!broadLimit.allowed) {
    queueSecurityEvent(context, env, request, {
      eventType: "admin_api_rate_limited",
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
    const loginLimit = await checkRateLimit(env, request, "admin-google-login-ip", getClientAddress(request), {
      maxAttempts: 10,
      windowSeconds: 900,
      blockSeconds: 1800,
      failClosed: true,
    });
    if (!loginLimit.allowed) {
      queueSecurityEvent(context, env, request, {
        eventType: "admin_login_rate_limited",
        actorType: "anonymous",
        success: false,
        metadata: { retry_after: loginLimit.retryAfter },
      });
      return rateLimitResponse(json, loginLimit.retryAfter);
    }
    return handleGoogleLogin(context, env, request, data);
  }
  if (action === "verify") return handleAdminVerify(env, request, data);
  if (action === "logout") return handleAdminLogout(context, env, request, data);

  // All other actions require valid admin session
  const valid = await verifyAdminToken(env, getCookie(request, ADMIN_COOKIE));
  if (!valid) return json({ ok: false, error: "Unauthorized" }, 401);

  if (action === "list-partners") return listPartners(env, data);
  if (action === "approve-partner") return approvePartner(env, data);
  if (action === "decline-partner") return declinePartner(env, data);
  if (action === "dashboard") return getDashboard(env);
  if (action === "list-orders") return listOrders(env, data);
  if (action === "list-enquiries") return listEnquiries(env, data);
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

// Google sign-in also requires a valid signature, issuer, audience, lifetime and
// verified email. Access is limited to the Sears Melvin Google Workspace domain.
const ADMIN_DOMAIN = "searsmelvin.co.uk";
const ADMIN_COOKIE = "__Host-sm_admin_session";
const ADMIN_SESSION_SECONDS = 8 * 60 * 60;
const TRACKING_TOKEN_SECONDS = 30 * 24 * 60 * 60;

async function createAdminSession(env) {
  const token = generateToken(64);
  const tokenHash = await hashSessionToken(token);
  const expiresAt = new Date(Date.now() + ADMIN_SESSION_SECONDS * 1000).toISOString();

  const headers = sbHeaders(env);
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/admin_sessions`, {
    method: "POST",
    headers: { ...headers, "Prefer": "return=minimal" },
    body: JSON.stringify({ token: tokenHash, expires_at: expiresAt }),
  });
  if (!res.ok) return null;
  return token;
}

// Verifies a Google Identity Services ID token locally against Google's rotating
// public signing keys, then requires the Workspace hosted-domain claim.
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
      eventType: "admin_login_rejected",
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
  const email = payload.email.toLowerCase();
  const identifierHash = await sha256Hex(email);
  const domainEmail = new RegExp(`^[a-z0-9._%+-]{1,64}@${ADMIN_DOMAIN.replaceAll(".", "\\.")}$`);
  if (!domainEmail.test(email) || payload.hd !== ADMIN_DOMAIN) {
    queueSecurityEvent(context, env, request, {
      eventType: "admin_login_rejected",
      actorType: "anonymous",
      success: false,
      identifierHash,
      metadata: { reason: "workspace_domain" },
    });
    return json({ ok: false, error: "This Google account is not authorised for admin access" }, 403);
  }

  const token = await createAdminSession(env);
  if (!token) return json({ ok: false, error: "Failed to create session" }, 500);

  queueSecurityEvent(context, env, request, {
    eventType: "admin_login_succeeded",
    actorType: "admin",
    success: true,
    identifierHash,
  });

  return json({ ok: true }, 200, { "Set-Cookie": sessionCookie(ADMIN_COOKIE, token, ADMIN_SESSION_SECONDS) });
}

async function handleAdminVerify(env, request, data) {
  const token = getCookie(request, ADMIN_COOKIE);
  if (!token) return json({ ok: false, error: "Token required" }, 400);
  const valid = await verifyAdminToken(env, token);
  if (!valid) return json({ ok: false, error: "Invalid or expired session" }, 401);
  return json({ ok: true });
}

async function handleAdminLogout(context, env, request, data) {
  const token = getCookie(request, ADMIN_COOKIE);
  const headers = sbHeaders(env);
  if (token) {
    const tokenHash = await hashSessionToken(token);
    await deleteSession(env, "admin_sessions", tokenHash, headers);
  }
  queueSecurityEvent(context, env, request, {
    eventType: "admin_logout",
    actorType: "admin",
    success: true,
  });
  return json({ ok: true }, 200, {
    "Set-Cookie": clearCookie(ADMIN_COOKIE),
    "Clear-Site-Data": '"cache", "storage"',
  });
}

async function verifyAdminToken(env, token) {
  if (!token) return false;
  const headers = sbHeaders(env);
  const now = new Date().toISOString();
  const tokenHash = await hashSessionToken(token);
  return sessionExists(env, "admin_sessions", tokenHash, now, headers);
}

// ==================== LIST PARTNERS ====================
async function listPartners(env, { filter }) {
  if (filter && filter !== "all" && !PARTNER_STATUS_VALUES.has(filter)) {
    return json({ ok: false, error: "Invalid partner filter" }, 400);
  }
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
    `${env.SUPABASE_URL}/rest/v1/orders?organization_id=eq.${encodeURIComponent(env.SM_ORG_ID)}&partner_id=not.is.null&select=partner_id,id,value,status`,
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
  if (!isPositiveInteger(partnerId)) return json({ ok: false, error: "Valid partner ID required" }, 400);
  const internalPartnerId = getInternalPartnerId(env);
  if (!internalPartnerId) return json({ ok: false, error: "Internal workspace is not configured" }, 500);
  if (String(partnerId) === internalPartnerId) {
    return json({ ok: false, error: "Sears Melvin staff access is managed through Google Workspace" }, 400);
  }

  const headers = sbHeaders(env);
  const lookupRes = await fetch(
    `${env.SUPABASE_URL}/rest/v1/partners?id=eq.${encodeURIComponent(partnerId)}&select=id,email,name,company&limit=1`,
    { headers },
  );
  if (!lookupRes.ok) return json({ ok: false, error: "Failed to load partner" }, 500);
  const existing = await lookupRes.json();
  if (existing.length === 0) return json({ ok: false, error: "Partner not found" }, 404);
  const partner = existing[0];

  const setupToken = generateToken(32);
  const setupTokenHash = await hashSessionToken(setupToken);
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

  const revokeLinkRes = await fetch(`${env.SUPABASE_URL}/rest/v1/partner_magic_link_tokens?partner_id=eq.${partner.id}`, {
    method: "DELETE",
    headers,
  });
  if (!revokeLinkRes.ok) return json({ ok: false, error: "Failed to revoke previous partner sign-in links" }, 500);
  const tokenRes = await fetch(`${env.SUPABASE_URL}/rest/v1/partner_magic_link_tokens`, {
    method: "POST",
    headers: { ...headers, "Prefer": "return=minimal" },
    body: JSON.stringify({ partner_id: partner.id, token_hash: setupTokenHash, expires_at: expiresAt }),
  });
  if (!tokenRes.ok) return json({ ok: false, error: "Failed to create partner sign-in link" }, 500);

  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/partners?id=eq.${encodeURIComponent(partnerId)}&select=id,email,name,company,status,active,approved_at,declined_at`, {
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

  // A pending account should never have a session, but delete any stale rows
  // defensively before activation.
  await fetch(`${env.SUPABASE_URL}/rest/v1/partner_sessions?partner_id=eq.${partner.id}`, {
    method: "DELETE",
    headers,
  });

  let setupEmailSent = false;
  if (env.RESEND_API_KEY) {
    try {
      await sendPartnerSetupEmail(env.RESEND_API_KEY, partner, setupToken);
      setupEmailSent = true;
    } catch {
      console.error(JSON.stringify({ message: "partner_setup_email_failed", partner_id: partner.id }));
    }
  }

  return json({ ok: true, partner: rows[0], setupEmailSent });
}

// ==================== DECLINE PARTNER ====================
async function declinePartner(env, { partnerId }) {
  if (!isPositiveInteger(partnerId)) return json({ ok: false, error: "Valid partner ID required" }, 400);

  const headers = sbHeaders(env);
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/partners?id=eq.${encodeURIComponent(partnerId)}&select=id,email,name,company,status,active,approved_at,declined_at`, {
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

  await Promise.all([
    fetch(`${env.SUPABASE_URL}/rest/v1/partner_sessions?partner_id=eq.${encodeURIComponent(partnerId)}`, {
      method: "DELETE", headers,
    }),
    fetch(`${env.SUPABASE_URL}/rest/v1/partner_magic_link_tokens?partner_id=eq.${encodeURIComponent(partnerId)}`, {
      method: "DELETE", headers,
    }),
  ]);

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
    `${env.SUPABASE_URL}/rest/v1/orders?organization_id=eq.${encodeURIComponent(env.SM_ORG_ID)}&select=id,partner_id,value,status,created_at&order=created_at.desc&limit=200`,
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
async function listOrders(env, { filter, search, partnerId, dateFrom, dateTo, offset, limit }) {
  if (filter && filter !== "all" && !STAGE_VALUES.has(filter)) {
    return json({ ok: false, error: "Invalid order filter" }, 400);
  }
  if (partnerId && !isPositiveInteger(partnerId)) {
    return json({ ok: false, error: "Invalid partner ID" }, 400);
  }
  if (search !== undefined && (typeof search !== "string" || search.length > 200)) {
    return json({ ok: false, error: "Invalid search" }, 400);
  }
  if ((dateFrom && !isIsoDate(dateFrom)) || (dateTo && !isIsoDate(dateTo))) {
    return json({ ok: false, error: "Invalid date filter" }, 400);
  }
  const headers = sbHeaders(env);
  const select = [
    "id", "order_number", "person_id",
    "people(id,first_name,last_name,email,phone,is_customer)",
    "sku", "color", "value", "permit_fee", "status", "stage",
    "location", "inscription_text", "inscription_status",
    "proof_url", "proof_uploaded_at", "proof_notes",
    "estimated_completion", "installation_date",
    "partner_id", "admin_notes", "product_config", "notes",
    "order_type", "created_at", "updated_at",
    "partners(id,name,company,email)"
  ].join(",");
  const orgFilter = `&organization_id=eq.${encodeURIComponent(env.SM_ORG_ID)}`;
  const pageSize = Math.min(Math.max(parseInt(limit, 10) || 100, 1), 200);
  const pageOffset = Math.max(parseInt(offset, 10) || 0, 0);
  let url = `${env.SUPABASE_URL}/rest/v1/orders?select=${select}&order=created_at.desc&limit=${pageSize}&offset=${pageOffset}${orgFilter}`;

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
      personFullName(o.people).toLowerCase().includes(q) ||
      (o.people?.email || "").toLowerCase().includes(q) ||
      (o.sku || "").toLowerCase().includes(q) ||
      (o.location || "").toLowerCase().includes(q) ||
      String(o.id || "").includes(q)
    );
  }

  // hasMore is true if the page came back fully populated; the next call should
  // bump `offset` by `limit`. Search is client-side, so we report on the raw page.
  const hasMore = orders.length >= pageSize;
  return json({ ok: true, orders, offset: pageOffset, limit: pageSize, hasMore });
}

function personFullName(p) {
  if (!p) return "";
  return [p.first_name, p.last_name].filter(Boolean).join(" ");
}

// ==================== LIST ENQUIRIES ====================
async function listEnquiries(env, { channel, status, limit, offset }) {
  if (channel && channel !== "all" && !ENQUIRY_CHANNEL_VALUES.has(channel)) {
    return json({ ok: false, error: "Invalid enquiry channel" }, 400);
  }
  if (status && status !== "all" && (typeof status !== "string" || !/^[a-z][a-z_]{0,31}$/.test(status))) {
    return json({ ok: false, error: "Invalid enquiry status" }, 400);
  }
  const headers = sbHeaders(env);
  const pageSize = Math.min(Math.max(parseInt(limit, 10) || 100, 1), 200);
  const pageOffset = Math.max(parseInt(offset, 10) || 0, 0);
  const params = new URLSearchParams({
    select: "*,people(id,first_name,last_name,email,phone,is_customer),orders(id,order_number,stage,value)",
    order: "created_at.desc",
    limit: String(pageSize),
    offset: String(pageOffset),
  });
  params.append("organization_id", `eq.${env.SM_ORG_ID}`);
  if (channel && channel !== "all") params.append("channel", `eq.${channel}`);
  if (status && status !== "all") params.append("status", `eq.${status}`);

  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/enquiries?${params}`, { headers });
  if (!res.ok) return json({ ok: false, error: "Database error" }, 500);
  const enquiries = await res.json();

  // Sign every photo path across every enquiry in a single batch call, then redistribute.
  const allPaths = [];
  for (const e of enquiries) {
    if (Array.isArray(e.photo_urls)) {
      for (const p of e.photo_urls) if (p) allPaths.push(p);
    }
  }
  if (allPaths.length > 0) {
    const signed = await signPhotoPaths(env, allPaths);
    const signedByPath = new Map();
    allPaths.forEach((p, i) => { if (signed[i]) signedByPath.set(p, signed[i]); });
    for (const e of enquiries) {
      if (Array.isArray(e.photo_urls) && e.photo_urls.length > 0) {
        e.photo_signed_urls = e.photo_urls.map(p => signedByPath.get(p)).filter(Boolean);
      }
    }
  }
  const hasMore = enquiries.length >= pageSize;
  return json({ ok: true, enquiries, offset: pageOffset, limit: pageSize, hasMore });
}

async function signPhotoPaths(env, paths) {
  // Supabase Storage supports a single batch sign endpoint:
  //   POST /storage/v1/object/sign/{bucket}
  //   body: { paths: [...], expiresIn: 3600 }
  // Returns positional results — preserve null gaps so callers can zip back to the
  // original paths array.
  const res = await fetch(`${env.SUPABASE_URL}/storage/v1/object/sign/enquiry-photos`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ expiresIn: 3600, paths }),
  });
  if (!res.ok) {
    console.error(JSON.stringify({ message: "storage_sign_failed", status: res.status }));
    return paths.map(() => null);
  }
  const rows = await res.json();
  return rows.map(r => (r.signedURL ? `${env.SUPABASE_URL}/storage/v1${r.signedURL}` : null));
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
  if (typeof slug !== "string" || !/^[a-z0-9-]{1,120}$/.test(slug)) {
    return json({ ok: false, error: "Valid slug required" }, 400);
  }
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
  if (!UUID_RE.test(String(orderId || ""))) return json({ ok: false, error: "Valid order ID required" }, 400);
  if (stage !== undefined && !STAGE_VALUES.has(stage)) return json({ ok: false, error: "Invalid order stage" }, 400);
  if (inscriptionStatus !== undefined && !INSCRIPTION_STATUS_VALUES.has(inscriptionStatus)) {
    return json({ ok: false, error: "Invalid inscription status" }, 400);
  }
  if (!isNullableText(inscriptionText, 5000)) return json({ ok: false, error: "Invalid inscription text" }, 400);
  if (!isNullableText(proofNotes, 2000)) return json({ ok: false, error: "Invalid proof notes" }, 400);
  if (!isNullableText(estimatedCompletion, 120)) return json({ ok: false, error: "Invalid estimated completion" }, 400);
  if (!isNullableText(adminNotes, 5000)) return json({ ok: false, error: "Invalid admin notes" }, 400);
  if (proofUrl !== undefined && !isAllowedProofUrl(proofUrl, env)) {
    return json({ ok: false, error: "Proof URL must use approved Sears Melvin storage" }, 400);
  }
  if (installationDate !== undefined && installationDate !== null && !isIsoDate(installationDate)) {
    return json({ ok: false, error: "Installation date must be YYYY-MM-DD" }, 400);
  }
  if ([stage, inscriptionText, inscriptionStatus, proofUrl, proofNotes, estimatedCompletion, installationDate, adminNotes].every(value => value === undefined)) {
    return json({ ok: false, error: "No order changes supplied" }, 400);
  }

  const headers = sbHeaders(env);

  // Fetch the row first so we can produce a meaningful audit trail.
  const beforeRes = await fetch(
    `${env.SUPABASE_URL}/rest/v1/orders?id=eq.${encodeURIComponent(orderId)}&organization_id=eq.${encodeURIComponent(env.SM_ORG_ID)}&select=stage,inscription_text,inscription_status,proof_url,proof_notes,estimated_completion,installation_date,admin_notes&limit=1`,
    { headers }
  );
  const beforeRows = beforeRes.ok ? await beforeRes.json() : [];
  const before = beforeRows[0] || {};

  const updates = {};
  if (stage !== undefined) updates.stage = stage;
  if (inscriptionText !== undefined) updates.inscription_text = normaliseNullableText(inscriptionText);
  if (inscriptionStatus !== undefined) updates.inscription_status = inscriptionStatus;
  if (proofUrl !== undefined) {
    updates.proof_url = normaliseNullableText(proofUrl);
    updates.proof_uploaded_at = proofUrl ? new Date().toISOString() : null;
  }
  if (proofNotes !== undefined) updates.proof_notes = normaliseNullableText(proofNotes);
  if (estimatedCompletion !== undefined) updates.estimated_completion = normaliseNullableText(estimatedCompletion);
  if (installationDate !== undefined) updates.installation_date = installationDate;
  if (adminNotes !== undefined) updates.admin_notes = normaliseNullableText(adminNotes);
  updates.updated_at = new Date().toISOString();

  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/orders?id=eq.${encodeURIComponent(orderId)}&organization_id=eq.${encodeURIComponent(env.SM_ORG_ID)}`, {
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
  if (!UUID_RE.test(String(orderId || ""))) return json({ ok: false, error: "Valid order ID required" }, 400);

  const headers = sbHeaders(env);

  // Confirm the order belongs to this organisation before issuing a capability.
  const checkRes = await fetch(
    `${env.SUPABASE_URL}/rest/v1/orders?id=eq.${encodeURIComponent(orderId)}&organization_id=eq.${encodeURIComponent(env.SM_ORG_ID)}&select=id&limit=1`,
    { headers },
  );
  if (!checkRes.ok) return json({ ok: false, error: "Database error" }, 500);
  const rows = await checkRes.json();
  if (rows.length === 0) return json({ ok: false, error: "Order not found" }, 404);

  const issued = await issueTrackingToken(env, orderId, headers);
  if (!issued) return json({ ok: false, error: "Failed to generate token" }, 500);
  return json({ ok: true, trackingToken: issued.token, expiresAt: issued.expiresAt });
}

// ==================== LIST INSCRIPTION REQUESTS ====================
async function listInscriptionRequests(env) {
  const headers = sbHeaders(env);

  // PostgREST resource embedding pulls the parent order in one round-trip.
  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/inscription_requests?status=eq.pending` +
      `&select=id,order_id,requested_text,reason,created_at,` +
      `orders!inner(id,sku,inscription_text,organization_id,people(first_name,last_name,email))` +
      `&orders.organization_id=eq.${encodeURIComponent(env.SM_ORG_ID)}` +
      `&order=created_at.desc&limit=50`,
    { headers },
  );
  if (!res.ok) return json({ ok: false, error: "Database error" }, 500);
  const rows = await res.json();
  const requests = rows.map(({ orders, ...rest }) => ({ ...rest, order: orders || null }));

  return json({ ok: true, requests });
}

// ==================== RESOLVE INSCRIPTION REQUEST ====================
async function resolveInscription(env, { requestId, accept }) {
  if (!isPositiveInteger(requestId)) return json({ ok: false, error: "Valid request ID required" }, 400);
  if (typeof accept !== "boolean") return json({ ok: false, error: "A true/false decision is required" }, 400);

  const headers = sbHeaders(env);

  // Get the request
  const reqRes = await fetch(
    `${env.SUPABASE_URL}/rest/v1/inscription_requests?id=eq.${encodeURIComponent(requestId)}&select=id,order_id,requested_text,orders!inner(organization_id)&orders.organization_id=eq.${encodeURIComponent(env.SM_ORG_ID)}&limit=1`,
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
    await fetch(`${env.SUPABASE_URL}/rest/v1/orders?id=eq.${encodeURIComponent(inscReq.order_id)}&organization_id=eq.${encodeURIComponent(env.SM_ORG_ID)}`, {
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
    await fetch(`${env.SUPABASE_URL}/rest/v1/orders?id=eq.${encodeURIComponent(inscReq.order_id)}&organization_id=eq.${encodeURIComponent(env.SM_ORG_ID)}`, {
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
    console.error(JSON.stringify({ message: "order_event_log_failed" }));
  }
}

async function listOrderEvents(env, { orderId }) {
  if (!UUID_RE.test(String(orderId || ""))) return json({ ok: false, error: "Valid order ID required" }, 400);
  const headers = sbHeaders(env);
  if (!await orderBelongsToOrganization(env, orderId, headers)) {
    return json({ ok: false, error: "Order not found" }, 404);
  }
  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/order_events?order_id=eq.${encodeURIComponent(orderId)}&select=*&order=created_at.desc&limit=200`,
    { headers }
  );
  if (!res.ok) return json({ ok: false, error: "Database error" }, 500);
  return json({ ok: true, events: await res.json() });
}

// ==================== SEND CUSTOMER EMAIL ====================
async function sendCustomerEmail(env, { orderId, kind }) {
  if (!UUID_RE.test(String(orderId || ""))) return json({ ok: false, error: "Valid order ID required" }, 400);
  if (!CUSTOMER_EMAIL_KINDS.has(kind)) return json({ ok: false, error: "Unknown email kind" }, 400);
  if (!env.RESEND_API_KEY) return json({ ok: false, error: "Email not configured" }, 500);

  const headers = sbHeaders(env);
  const orderRes = await fetch(
    `${env.SUPABASE_URL}/rest/v1/orders?id=eq.${encodeURIComponent(orderId)}&organization_id=eq.${encodeURIComponent(env.SM_ORG_ID)}&select=id,people(first_name,last_name,email),sku,proof_url,proof_notes,inscription_text&limit=1`,
    { headers }
  );
  if (!orderRes.ok) return json({ ok: false, error: "Database error" }, 500);
  const orders = await orderRes.json();
  const order = orders[0];
  if (!order) return json({ ok: false, error: "Order not found" }, 404);
  const customerEmail = order.people?.email;
  const customerName = personFullName(order.people);
  if (!customerEmail) return json({ ok: false, error: "Order has no customer email" }, 400);

  // Every email rotates the link. A forwarded or older email stops working,
  // while the database stores only a 30-day SHA-256 digest.
  const issued = await issueTrackingToken(env, orderId, headers);
  if (!issued) return json({ ok: false, error: "Failed to create secure tracking link" }, 500);
  const trackingToken = issued.token;

  const trackUrl = `https://searsmelvin.co.uk/track#token=${encodeURIComponent(trackingToken || "")}`;
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
  } catch {
    return json({ ok: false, error: "Email delivery failed" }, 500);
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
  if (!res.ok) throw new Error(`Email provider returned ${res.status}`);
}

async function sendPartnerSetupEmail(apiKey, partner, token) {
  const firstName = String(partner.name || "").trim().split(/\s+/)[0] || "there";
  const setupUrl = `https://partner.searsmelvin.co.uk/#login=${encodeURIComponent(token)}`;
  await sendResend(apiKey, {
    from: "Sears Melvin Memorials <info@searsmelvin.co.uk>",
    to: partner.email,
    subject: "Your Sears Melvin Partner Portal access is approved",
    html: `<!DOCTYPE html><html><body style="margin:0;padding:24px;background:#F5F3F0;font-family:-apple-system,sans-serif;color:#2C2C2C;">
      <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:10px;padding:32px;">
        <h2 style="font-family:Georgia,serif;font-weight:400;">Partner access approved</h2>
        <p>Hi ${escapeHtml(firstName)},</p>
        <p>Your Sears Melvin Partner Portal request has been approved. Use the one-time button below to verify this mailbox and sign in—no password is required.</p>
        <p style="text-align:center;margin:28px 0;"><a href="${setupUrl}" style="display:inline-block;background:#2C2C2C;color:#fff;text-decoration:none;padding:12px 24px;border-radius:6px;">Sign in securely</a></p>
        <p style="font-size:13px;color:#666;">This link expires in 15 minutes and works once. If it expires, request a new link on the Partner Portal. If you did not request partner access, contact info@searsmelvin.co.uk.</p>
      </div>
    </body></html>`,
  });
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
function isPositiveInteger(value) {
  return Number.isSafeInteger(Number(value)) && Number(value) > 0 && String(value).trim() === String(Number(value));
}

function isNullableText(value, maxLength) {
  return value === undefined || value === null || (typeof value === "string" && value.length <= maxLength);
}

function normaliseNullableText(value) {
  if (value === null) return null;
  const clean = String(value).trim();
  return clean || null;
}

function isAllowedProofUrl(value, env) {
  if (value === null || value === "") return true;
  if (typeof value !== "string" || value.length > 2048) return false;
  try {
    const url = new URL(value);
    const storageHost = new URL(env.SUPABASE_URL).hostname;
    const allowedHosts = new Set([storageHost, "searsmelvin.co.uk", "www.searsmelvin.co.uk"]);
    return url.protocol === "https:"
      && !url.username
      && !url.password
      && !url.port
      && allowedHosts.has(url.hostname);
  } catch {
    return false;
  }
}

function isIsoDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

async function orderBelongsToOrganization(env, orderId, headers = sbHeaders(env)) {
  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/orders?id=eq.${encodeURIComponent(orderId)}&organization_id=eq.${encodeURIComponent(env.SM_ORG_ID)}&select=id&limit=1`,
    { headers },
  );
  if (!res.ok) return false;
  const rows = await res.json();
  return rows.length > 0;
}

function generateToken(length = 64) {
  const arr = new Uint8Array(length);
  crypto.getRandomValues(arr);
  return Array.from(arr, b => b.toString(16).padStart(2, "0")).join("");
}

async function hashSessionToken(token) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return "sha256:" + Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("");
}

async function issueTrackingToken(env, orderId, headers = sbHeaders(env)) {
  const token = generateToken(32);
  const tokenHash = await hashSessionToken(token);
  const expiresAt = new Date(Date.now() + TRACKING_TOKEN_SECONDS * 1000).toISOString();
  const response = await fetch(`${env.SUPABASE_URL}/rest/v1/order_tracking_tokens?on_conflict=order_id`, {
    method: "POST",
    headers: { ...headers, "Prefer": "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({
      order_id: orderId,
      organization_id: env.SM_ORG_ID,
      token_hash: tokenHash,
      expires_at: expiresAt,
      updated_at: new Date().toISOString(),
    }),
  });
  return response.ok ? { token, expiresAt } : null;
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

async function sessionExists(env, table, token, now, headers) {
  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/${table}?token=eq.${encodeURIComponent(token)}&expires_at=gt.${encodeURIComponent(now)}&select=id&limit=1`,
    { headers },
  );
  if (!res.ok) return false;
  const rows = await res.json();
  return rows.length > 0;
}

async function deleteSession(env, table, tokenHash, headers) {
  await fetch(`${env.SUPABASE_URL}/rest/v1/${table}?token=eq.${encodeURIComponent(tokenHash)}`, {
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
