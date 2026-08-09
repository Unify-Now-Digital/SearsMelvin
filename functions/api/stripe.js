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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CAPABILITY_TOKEN_RE = /^[A-Za-z0-9_-]{24,256}$/;

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: { "Allow": "POST, OPTIONS" } });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!isSameOriginRequest(request)) return json({ ok: false, error: "Forbidden" }, 403);
  if (!env.STRIPE_SECRET_KEY || !env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY || !UUID_RE.test(String(env.SM_ORG_ID || ""))) {
    return json({ ok: false, error: "Payment service is temporarily unavailable" }, 503);
  }

  const ipLimit = await checkRateLimit(env, request, "stripe-intent-ip", getClientAddress(request), {
    maxAttempts: 10,
    windowSeconds: 3600,
    blockSeconds: 3600,
    failClosed: true,
  });
  if (!ipLimit.allowed) return rateLimitResponse(json, ipLimit.retryAfter);

  let data;
  try {
    data = await readBoundedJson(request);
  } catch (error) {
    const status = error instanceof RequestValidationError ? error.status : 400;
    return json({ ok: false, error: error instanceof RequestValidationError ? error.message : "Invalid JSON" }, status);
  }

  const portal = typeof data.portal === "string" ? data.portal.trim() : "";
  const invoiceId = typeof data.invoiceId === "string" ? data.invoiceId.trim() : "";
  if (!CAPABILITY_TOKEN_RE.test(portal) || !UUID_RE.test(invoiceId)) {
    return json({ ok: false, error: "A valid portal link and invoice are required" }, 400);
  }

  const invoiceLimit = await checkRateLimit(env, request, "stripe-intent-invoice", invoiceId, {
    maxAttempts: 5,
    windowSeconds: 900,
    blockSeconds: 1800,
    failClosed: true,
  });
  if (!invoiceLimit.allowed) return rateLimitResponse(json, invoiceLimit.retryAfter);

  const headers = supabaseHeaders(env);
  const tokenHash = `sha256:${await sha256Hex(portal)}`;
  const tokenRes = await fetch(
    `${env.SUPABASE_URL}/rest/v1/customer_portal_tokens?token_hash=eq.${encodeURIComponent(tokenHash)}` +
      `&organization_id=eq.${encodeURIComponent(env.SM_ORG_ID)}` +
      `&expires_at=gt.${encodeURIComponent(new Date().toISOString())}` +
      `&select=person_id&limit=1`,
    { headers },
  );
  if (!tokenRes.ok) return json({ ok: false, error: "Payment service is temporarily unavailable" }, 502);
  const tokenRows = await tokenRes.json();
  if (tokenRows.length === 0) return json({ ok: false, error: "Invalid portal link" }, 403);

  const personRes = await fetch(
    `${env.SUPABASE_URL}/rest/v1/people?id=eq.${encodeURIComponent(tokenRows[0].person_id)}` +
      `&select=id,first_name,last_name,email&limit=1`,
    { headers },
  );
  if (!personRes.ok) return json({ ok: false, error: "Payment service is temporarily unavailable" }, 502);
  const people = await personRes.json();
  if (people.length === 0) return json({ ok: false, error: "Invalid portal link" }, 403);
  const person = people[0];

  const invoiceRes = await fetch(
    `${env.SUPABASE_URL}/rest/v1/invoices?id=eq.${encodeURIComponent(invoiceId)}` +
      `&organization_id=eq.${encodeURIComponent(env.SM_ORG_ID)}` +
      `&select=id,order_id,status&limit=1`,
    { headers },
  );
  if (!invoiceRes.ok) return json({ ok: false, error: "Payment service is temporarily unavailable" }, 502);
  const invoices = await invoiceRes.json();
  if (invoices.length === 0 || !invoices[0].order_id || invoices[0].status === "paid") {
    return json({ ok: false, error: "Invoice is not payable" }, 400);
  }
  const invoice = invoices[0];

  const orderRes = await fetch(
    `${env.SUPABASE_URL}/rest/v1/orders?id=eq.${encodeURIComponent(invoice.order_id)}` +
      `&organization_id=eq.${encodeURIComponent(env.SM_ORG_ID)}` +
      `&person_id=eq.${encodeURIComponent(person.id)}` +
      `&select=id,sku,location,value,permit_fee,status&limit=1`,
    { headers },
  );
  if (!orderRes.ok) return json({ ok: false, error: "Payment service is temporarily unavailable" }, 502);
  const orders = await orderRes.json();
  if (orders.length === 0) return json({ ok: false, error: "Invoice is not linked to this portal" }, 403);
  const order = orders[0];

  const memorialValue = Number(order.value);
  const permitFee = Number(order.permit_fee || 0);
  if (!Number.isFinite(memorialValue) || memorialValue <= 0 || !Number.isFinite(permitFee) || permitFee < 0) {
    return json({ ok: false, error: "Invoice amount is invalid" }, 409);
  }
  const paymentType = order.status === "partial" ? "full" : "deposit";
  const amountPence = Math.round(
    (paymentType === "full" ? memorialValue * 0.5 : memorialValue * 0.5 + permitFee) * 100,
  );
  if (amountPence < 50 || amountPence > 100_000_000) {
    return json({ ok: false, error: "Invoice amount is outside the permitted range" }, 409);
  }

  const customerName = [person.first_name, person.last_name].filter(Boolean).join(" ");
  const params = new URLSearchParams({
    amount: String(amountPence),
    currency: "gbp",
    "automatic_payment_methods[enabled]": "true",
    "metadata[customer_name]": customerName,
    "metadata[customer_email]": person.email || "",
    "metadata[cemetery]": order.location || "",
    "metadata[product]": order.sku || "Memorial",
    "metadata[invoice_id]": invoice.id,
    "metadata[order_id]": order.id,
    "metadata[organization_id]": env.SM_ORG_ID,
    "metadata[payment_type]": paymentType,
    "metadata[expected_amount_pence]": String(amountPence),
    description: `${paymentType === "full" ? "Balance" : "Deposit + permit"} — ${order.sku || "Memorial"}`,
  });

  const stripeRes = await fetch("https://api.stripe.com/v1/payment_intents", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${env.STRIPE_SECRET_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "Idempotency-Key": `sm-invoice-${invoice.id}-${paymentType}-${amountPence}`,
    },
    body: params,
  });
  const paymentIntent = await stripeRes.json();
  if (!stripeRes.ok || paymentIntent.error || !paymentIntent.client_secret) {
    console.error(JSON.stringify({ message: "stripe_intent_create_failed", status: stripeRes.status }));
    return json({ ok: false, error: "Unable to start payment" }, 502);
  }

  queueSecurityEvent(context, env, request, {
    eventType: "payment_intent_created",
    actorType: "anonymous",
    success: true,
    identifierHash: await sha256Hex(invoice.id),
    metadata: { payment_type: paymentType, amount_pence: amountPence },
  });
  return json({ ok: true, clientSecret: paymentIntent.client_secret });
}

function json(data, status = 200, extraHeaders = {}) {
  return hardenedJson(data, status, extraHeaders);
}
