/**
 * Quotes API — /api/quotes
 *
 * POST { action: "get-quote", token } → retrieve a single quote by edit token
 * POST { token, product }             → update a quote's product configuration
 */

import {
  RequestValidationError,
  checkRateLimit,
  getClientAddress,
  hardenedJson,
  isSameOriginRequest,
  rateLimitResponse,
  readBoundedJson,
  supabaseHeaders,
} from "./_security.js";
import { canonicaliseQuoteProduct, QuotePricingError } from "./_quote-pricing.js";

const CAPABILITY_TOKEN_RE = /^[A-Za-z0-9_-]{32,256}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const QUOTE_SELECT = "id,location,product_config,value,notes,status,created_at,sku,color,inscription_text,people(first_name,last_name,email,phone)";

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: { "Allow": "GET, POST, OPTIONS" } });
}

export async function onRequest(context) {
  const { request, env } = context;
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY || !UUID_RE.test(String(env.SM_ORG_ID || ""))) {
    return json({ ok: false, error: "Server configuration error" }, 500);
  }
  if (!isSameOriginRequest(request)) return json({ ok: false, error: "Forbidden" }, 403);

  const broadLimit = await checkRateLimit(env, request, "quotes-api-ip", getClientAddress(request), {
    maxAttempts: 120,
    windowSeconds: 3600,
    blockSeconds: 3600,
    failClosed: true,
  });
  if (!broadLimit.allowed) return rateLimitResponse(json, broadLimit.retryAfter);

  if (request.method === "GET") {
    // Capability tokens in URLs leak into browser history, access logs and
    // referrer metadata. The browser flow sends them only in a POST body.
    return json({ ok: false, error: "Method not allowed" }, 405);
  }

  if (request.method === "POST") {
    let data;
    try { data = await readBoundedJson(request); }
    catch (error) {
      const status = error instanceof RequestValidationError ? error.status : 400;
      return json({ ok: false, error: error instanceof RequestValidationError ? error.message : "Invalid JSON" }, status);
    }
    if (data.action === "get-quote") {
      if (!CAPABILITY_TOKEN_RE.test(String(data.token || ""))) {
        return json({ ok: false, error: "A valid quote link is required" }, 400);
      }
      return getQuoteByToken(env, data.token);
    }
    return updateQuote(env, data);
  }

  return json({ ok: false, error: "Method not allowed" }, 405);
}

async function getQuoteByToken(env, token) {
  const headers = sbHeaders(env);
  const orderId = await getQuoteOrderId(env, token, headers);
  if (!orderId) return json({ ok: false, error: "Quote not found" }, 404);
  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/orders?id=eq.${encodeURIComponent(orderId)}&organization_id=eq.${encodeURIComponent(env.SM_ORG_ID)}&order_type=eq.quote&select=${QUOTE_SELECT}&limit=1`,
    { headers },
  );
  if (!res.ok) return json({ ok: false, error: "Database error" }, 500);
  const rows = await res.json();
  if (rows.length === 0) return json({ ok: false, error: "Quote not found" }, 404);
  const order = rows[0];
  return json({
    ok: true,
    quote: {
      id: order.id,
      name: [order.people?.first_name, order.people?.last_name].filter(Boolean).join(" ") || null,
      email: order.people?.email || null,
      phone: order.people?.phone || null,
      location: order.location,
      product: order.product_config ? safeParse(order.product_config) : null,
      value: order.value,
      notes: order.notes || null,
      status: order.status || "pending",
      created_at: order.created_at,
    },
  });
}

async function updateQuote(env, data) {
  const { token, product, message } = data;
  if (!CAPABILITY_TOKEN_RE.test(String(token || ""))) {
    return json({ ok: false, error: "A valid quote link is required" }, 400);
  }
  if (product !== undefined && (!product || typeof product !== "object" || Array.isArray(product))) {
    return json({ ok: false, error: "Invalid product configuration" }, 400);
  }
  if (message !== undefined && (typeof message !== "string" || message.length > 2000)) {
    return json({ ok: false, error: "Notes are too long" }, 400);
  }

  const headers = sbHeaders(env);
  const quoteOrderId = await getQuoteOrderId(env, token, headers);
  if (!quoteOrderId) return json({ ok: false, error: "Quote not found" }, 404);

  // Verify token exists and fetch full order for email notifications
  const checkRes = await fetch(
    `${env.SUPABASE_URL}/rest/v1/orders?id=eq.${encodeURIComponent(quoteOrderId)}&organization_id=eq.${encodeURIComponent(env.SM_ORG_ID)}&order_type=eq.quote&select=${QUOTE_SELECT}&limit=1`,
    { headers },
  );
  if (!checkRes.ok) return json({ ok: false, error: "Database error" }, 500);
  const checkRows = await checkRes.json();
  if (checkRows.length === 0) return json({ ok: false, error: "Quote not found" }, 404);

  const order = checkRows[0];
  const orderId = order.id;
  const updates = {};
  let safeProduct = null;
  if (product) {
    const oldConfig = (order.product_config ? safeParse(order.product_config) : null) || {};
    const submittedProduct = {
      ...(oldConfig && typeof oldConfig === "object" ? oldConfig : {}),
      ...product,
      slug: product.slug || oldConfig?.slug,
    };
    try {
      safeProduct = await canonicaliseQuoteProduct(env, submittedProduct);
    } catch (error) {
      console.error(JSON.stringify({
        message: "quote_update_price_verification_failed",
        reason: error instanceof QuotePricingError ? error.message : "catalogue request failed",
      }));
      return json({
        ok: false,
        error: error instanceof QuotePricingError
          ? error.message
          : "Unable to verify the current memorial price. Please try again.",
      }, error instanceof QuotePricingError ? error.status : 503);
    }
    updates.product_config = JSON.stringify(safeProduct);
    updates.value = safeProduct.price;
    if (safeProduct.colour) updates.color = safeProduct.colour;
    if (safeProduct.inscription !== undefined) updates.inscription_text = safeProduct.inscription;
  }
  if (message !== undefined) updates.notes = message.trim();
  updates.updated_at = new Date().toISOString();

  const patchRes = await fetch(
    `${env.SUPABASE_URL}/rest/v1/orders?id=eq.${encodeURIComponent(orderId)}&organization_id=eq.${encodeURIComponent(env.SM_ORG_ID)}`,
    {
      method: "PATCH",
      headers: { ...headers, "Prefer": "return=minimal" },
      body: JSON.stringify(updates),
    },
  );
  if (!patchRes.ok) return json({ ok: false, error: "Failed to update quote" }, 500);

  // Send notification emails about the update
  if (env.RESEND_API_KEY) {
    const customerName = [order.people?.first_name, order.people?.last_name].filter(Boolean).join(" ");
    const customerEmail = order.people?.email || "";
    const productName = (safeProduct && safeProduct.name) || order.sku || "Memorial";
    const oldConfig = (order.product_config ? safeParse(order.product_config) : null) || {};
    const productSlug = (safeProduct && safeProduct.slug) || oldConfig.slug || "";
    const changes = buildChangesSummary(order, safeProduct, message);

    // Notify the business
    try {
      await sendEmail(env.RESEND_API_KEY, {
        from: "Sears Melvin Memorials <info@searsmelvin.co.uk>",
        to: "info@searsmelvin.co.uk",
        subject: `Quote updated by customer — ${customerName || customerEmail}`,
        html: quoteUpdateBusinessEmail({ name: customerName, email: customerEmail, productName, productSlug, changes }),
      });
    } catch {
      console.error(JSON.stringify({ message: "quote_update_business_email_failed" }));
    }

    // Confirm to the customer
    if (customerEmail) {
      try {
        await sendEmail(env.RESEND_API_KEY, {
          from: "Sears Melvin Memorials <info@searsmelvin.co.uk>",
          to: customerEmail,
          subject: "Your quote has been updated — Sears Melvin Memorials",
          html: quoteUpdateCustomerEmail({ firstName: customerName.split(" ")[0] || "there", productName, productSlug, changes }),
        });
      } catch {
        console.error(JSON.stringify({ message: "quote_update_customer_email_failed" }));
      }
    }
  }

  return json({ ok: true, product: safeProduct, value: safeProduct?.price ?? order.value });
}

function buildChangesSummary(order, product, message) {
  const lines = [];
  const oldConfig = (order.product_config ? safeParse(order.product_config) : null) || {};
  if (product) {
    if (product.colour && product.colour !== (oldConfig.colour || order.color)) lines.push(`Stone colour → ${product.colour}`);
    if (product.size && product.size !== oldConfig.size) lines.push(`Size → ${product.size}`);
    if (product.font && product.font !== oldConfig.font) lines.push(`Font → ${product.font === 'script' ? 'Script' : 'Traditional'}`);
    if (product.letterColour && product.letterColour !== oldConfig.letterColour) lines.push(`Lettering → ${product.letterColour}`);
    if (product.inscription !== undefined && product.inscription !== oldConfig.inscription) lines.push(`Inscription updated`);
  }
  if (message !== undefined && message !== (order.notes || "")) lines.push(`Notes updated`);
  return lines.length > 0 ? lines : ["Quote details updated"];
}

function sbHeaders(env) {
  return supabaseHeaders(env);
}

function safeParse(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  try { return JSON.parse(value); }
  catch { return null; }
}

async function getQuoteOrderId(env, token, headers = sbHeaders(env)) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  const tokenHash = "sha256:" + Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
  const response = await fetch(
    `${env.SUPABASE_URL}/rest/v1/quote_access_tokens?organization_id=eq.${encodeURIComponent(env.SM_ORG_ID)}&token_hash=eq.${encodeURIComponent(tokenHash)}&expires_at=gt.${encodeURIComponent(new Date().toISOString())}&select=order_id&limit=1`,
    { headers },
  );
  if (!response.ok) return null;
  const rows = await response.json();
  return rows[0]?.order_id || null;
}

function json(data, status = 200) {
  return hardenedJson(data, status);
}

function esc(str) {
  return String(str || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

async function sendEmail(apiKey, { from, to, subject, html }) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to, subject, html }),
  });
  if (!res.ok) {
    throw new Error(`Resend request failed with status ${res.status}`);
  }
}

function quoteUpdateBusinessEmail({ name, email, productName, productSlug, changes }) {
  const changeList = changes.map(c => `<li style="padding:3px 0;color:#1A1A1A;">${esc(c)}</li>`).join("");
  const productUrl = productSlug ? `https://searsmelvin.co.uk/memorials/${encodeURIComponent(productSlug)}` : "";
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#F5F3F0;font-family:-apple-system,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#F5F3F0;padding:24px 0;">
<tr><td align="center">
<table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border-radius:10px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.08);">
  <tr><td style="background:#2C2C2C;padding:18px 28px;">
    <table width="100%" cellpadding="0" cellspacing="0"><tr>
      <td><span style="font-family:Georgia,serif;font-size:18px;color:#fff;">Sears Melvin <span style="opacity:0.55;">Memorials</span></span></td>
      <td align="right"><span style="background:#8B7355;color:#fff;padding:4px 11px;border-radius:3px;font-size:11px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;">Quote Updated</span></td>
    </tr></table>
  </td></tr>
  <tr><td style="padding:24px 28px;">
    <h2 style="font-family:Georgia,serif;font-size:20px;color:#2C2C2C;font-weight:normal;margin:0 0 16px;">Customer Updated Their Quote</h2>
    <table width="100%" cellpadding="0" cellspacing="0" style="font-size:13px;margin-bottom:16px;">
      <tr><td style="color:#999;padding:5px 0;width:100px;">Customer</td><td style="color:#1A1A1A;font-weight:600;">${esc(name || "—")}</td></tr>
      <tr><td style="color:#999;padding:5px 0;">Email</td><td><a href="mailto:${esc(email)}" style="color:#8B7355;">${esc(email || "—")}</a></td></tr>
      <tr><td style="color:#999;padding:5px 0;">Memorial</td><td style="color:#1A1A1A;">${esc(productName)}${productUrl ? ` &middot; <a href="${productUrl}" style="color:#8B7355;text-decoration:none;font-weight:600;">View product &rarr;</a>` : ""}</td></tr>
    </table>
    <div style="background:#F5F3F0;border-radius:8px;padding:16px 20px;">
      <div style="font-size:10px;letter-spacing:0.1em;text-transform:uppercase;color:#8B7355;font-weight:700;margin-bottom:8px;">Changes Made</div>
      <ul style="margin:0;padding:0 0 0 16px;font-size:13px;">${changeList}</ul>
    </div>
  </td></tr>
  <tr><td style="background:#F5F3F0;border-top:1px solid #E0DCD5;padding:12px 28px;text-align:center;">
    <span style="font-size:11px;color:#BBB;">Sears Melvin Memorials &middot; info@searsmelvin.co.uk</span>
  </td></tr>
</table>
</td></tr></table></body></html>`;
}

function quoteUpdateCustomerEmail({ firstName, productName, productSlug, changes }) {
  const changeList = changes.map(c => `<li style="padding:3px 0;color:#1A1A1A;">${esc(c)}</li>`).join("");
  const productUrl = productSlug ? `https://searsmelvin.co.uk/memorials/${encodeURIComponent(productSlug)}` : "";
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#F5F3F0;font-family:-apple-system,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#F5F3F0;padding:24px 0;">
<tr><td align="center">
<table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border-radius:10px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.08);">
  <tr><td style="background:#2C2C2C;padding:20px 28px;">
    <span style="font-family:Georgia,serif;font-size:18px;color:#fff;">Sears Melvin <span style="opacity:0.55;">Memorials</span></span>
  </td></tr>
  <tr><td style="padding:32px 28px 0;">
    <h2 style="font-family:Georgia,serif;font-size:22px;color:#2C2C2C;font-weight:normal;margin:0 0 12px;">Quote updated, ${esc(firstName)}.</h2>
    <p style="color:#555;font-size:15px;line-height:1.7;margin:0 0 20px;">
      We've received your changes to your <strong style="color:#2C2C2C;">${esc(productName)}</strong> quote. Our team will review the updates and be in touch if anything needs adjusting.
    </p>
    ${productUrl ? `<p style="margin:0 0 20px;"><a href="${productUrl}" style="color:#8B7355;font-size:14px;font-weight:600;text-decoration:none;">View this memorial on our website &rarr;</a></p>` : ""}
  </td></tr>
  <tr><td style="padding:0 28px 28px;">
    <div style="background:#F5F3F0;border-radius:8px;padding:16px 20px;">
      <div style="font-size:10px;letter-spacing:0.1em;text-transform:uppercase;color:#8B7355;font-weight:700;margin-bottom:8px;">What changed</div>
      <ul style="margin:0;padding:0 0 0 16px;font-size:13px;">${changeList}</ul>
    </div>
  </td></tr>
  <tr><td style="background:#F5F3F0;border-top:1px solid #E0DCD5;padding:14px 28px;text-align:center;">
    <span style="font-size:11px;color:#BBB;">Sears Melvin Memorials &middot; <a href="mailto:info@searsmelvin.co.uk" style="color:#BBB;">info@searsmelvin.co.uk</a></span>
  </td></tr>
</table>
</td></tr></table></body></html>`;
}
