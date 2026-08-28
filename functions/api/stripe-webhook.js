/**
 * Stripe Webhook Handler — /api/stripe-webhook
 *
 * Listens for Stripe events and:
 *   - Verifies the webhook signature (HMAC-SHA256)
 *   - On payment_intent.succeeded: marks the order as deposit paid in Supabase
 *     and sends a payment confirmation email to the customer
 *
 * Setup in Stripe Dashboard → Developers → Webhooks:
 *   Endpoint URL : https://searsmelvin.co.uk/api/stripe-webhook
 *   Events       : payment_intent.succeeded, payment_intent.payment_failed
 *
 * Required env var (Cloudflare Pages → Settings → Environment Variables):
 *   STRIPE_WEBHOOK_SECRET  → "Signing secret" shown after creating the webhook endpoint
 */

const BUSINESS_NAME  = "Sears Melvin Memorials";
const BUSINESS_EMAIL = "info@searsmelvin.co.uk";
const FROM_EMAIL     = "info@searsmelvin.co.uk";
const SITE_URL       = "https://searsmelvin.co.uk";
const MAX_WEBHOOK_BYTES = 1024 * 1024;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// ── Stripe webhook signature verification (Web Crypto API) ─────────────────────
async function verifyStripeSignature(rawBody, sigHeader, secret) {
  if (!sigHeader || !secret) return false;

  const parts     = sigHeader.split(",");
  const tPart     = parts.find(p => p.startsWith("t="));
  const v1Part    = parts.find(p => p.startsWith("v1="));
  if (!tPart || !v1Part) return false;

  const timestamp    = tPart.slice(2);
  const givenSig     = v1Part.slice(3);
  const signedPayload = `${timestamp}.${rawBody}`;

  // Reject events older than 5 minutes
  const parsedTimestamp = Number(timestamp);
  if (!Number.isSafeInteger(parsedTimestamp)) return false;
  const age = Math.floor(Date.now() / 1000) - parsedTimestamp;
  if (Math.abs(age) > 300) return false;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sigBytes    = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(signedPayload));
  const computedSig = Array.from(new Uint8Array(sigBytes))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");

  return timingSafeEqual(computedSig, givenSig);
}

// Constant-time string compare — protects HMAC verification from timing attacks.
function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// ── Main handler ────────────────────────────────────────────────────────────────
export async function onRequestPost({ request, env }) {
  if (!env.STRIPE_WEBHOOK_SECRET) {
    console.error("Stripe webhook secret is not configured");
    return new Response(JSON.stringify({ error: "Webhook unavailable" }), {
      status: 503,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  }
  const contentLength = Number(request.headers.get("Content-Length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_WEBHOOK_BYTES) {
    return new Response(JSON.stringify({ error: "Payload too large" }), {
      status: 413,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  }
  const rawBody    = await request.text();
  if (new TextEncoder().encode(rawBody).byteLength > MAX_WEBHOOK_BYTES) {
    return new Response(JSON.stringify({ error: "Payload too large" }), {
      status: 413,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  }
  const sigHeader  = request.headers.get("stripe-signature") || "";
  const valid = await verifyStripeSignature(rawBody, sigHeader, env.STRIPE_WEBHOOK_SECRET);
  if (!valid) {
    console.error("Stripe webhook signature verification failed");
    return new Response(JSON.stringify({ error: "Invalid signature" }), {
      status: 400,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  }

  let event;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (event.type === "payment_intent.succeeded") {
    await handlePaymentSucceeded(env, event.data.object);
  }

  if (event.type === "payment_intent.payment_failed") {
    console.error(JSON.stringify({ message: "stripe_payment_failed" }));
  }

  return new Response(JSON.stringify({ received: true }), {
    headers: { "Content-Type": "application/json" },
  });
}

async function fetchOrderJobId(env, sbHeaders, orderId) {
  try {
    const res = await fetch(
      `${env.SUPABASE_URL}/rest/v1/orders?id=eq.${encodeURIComponent(orderId)}&organization_id=eq.${encodeURIComponent(env.SM_ORG_ID)}&select=job_id&limit=1`,
      { headers: { apikey: sbHeaders.apikey, Authorization: sbHeaders.Authorization } },
    );
    if (!res.ok) return null;
    return (await res.json())[0]?.job_id || null;
  } catch {
    return null;
  }
}

// Resolve the order's person_id and flip people.is_customer = TRUE. This is the
// only code path allowed to set is_customer (the flag means "has paid at least
// once"). Idempotent and isolated so a flip failure can't block invoice/payment
// writes upstream.
async function markPersonAsPayingCustomer(env, sbHeaders, orderId) {
  if (!orderId) return;
  try {
    const orderRes = await fetch(
      `${env.SUPABASE_URL}/rest/v1/orders?id=eq.${encodeURIComponent(orderId)}&organization_id=eq.${encodeURIComponent(env.SM_ORG_ID)}&select=person_id`,
      { headers: { apikey: sbHeaders.apikey, Authorization: sbHeaders.Authorization } },
    );
    if (!orderRes.ok) {
      console.error(JSON.stringify({ message: "customer_flag_order_lookup_failed", status: orderRes.status }));
      return;
    }
    const personId = (await orderRes.json())[0]?.person_id;
    if (!personId) return;
    const patchRes = await fetch(
      `${env.SUPABASE_URL}/rest/v1/people?id=eq.${encodeURIComponent(personId)}`,
      {
        method: "PATCH",
        headers: { ...sbHeaders, Prefer: "return=minimal" },
        body: JSON.stringify({ is_customer: true }),
      },
    );
    if (!patchRes.ok) {
      console.error(JSON.stringify({ message: "customer_flag_update_failed", status: patchRes.status }));
    }
  } catch {
    console.error(JSON.stringify({ message: "customer_flag_update_unavailable" }));
  }
}

// Read invoice_type from the underlying Stripe Invoice (metadata is set when the
// invoice is created in submit.js). Returns "full" or "deposit" — defaults to
// "deposit" when the PI isn't tied to an invoice or the call fails.
async function fetchInvoiceType(env, pi) {
  if (pi.metadata?.payment_type === "full") return "full";
  if (pi.metadata?.payment_type === "deposit") return "deposit";
  if (!pi.invoice || !env.STRIPE_SECRET_KEY) return "deposit";
  try {
    const res = await fetch(`https://api.stripe.com/v1/invoices/${pi.invoice}`, {
      headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}` },
    });
    if (!res.ok) return "deposit";
    const inv = await res.json();
    return inv.metadata?.invoice_type === "full" ? "full" : "deposit";
  } catch {
    console.error(JSON.stringify({ message: "stripe_invoice_metadata_unavailable" }));
    return "deposit";
  }
}

async function validatePaymentTarget(env, pi, invoiceId) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY || !env.SM_ORG_ID) return null;
  if (!UUID_RE.test(String(invoiceId || ""))) return null;
  if (pi.currency !== "gbp" || !Number.isSafeInteger(pi.amount_received) || pi.amount_received <= 0) return null;

  const paymentType = pi.metadata?.payment_type;
  if (paymentType !== "deposit" && paymentType !== "full") return null;
  if (pi.metadata?.organization_id !== env.SM_ORG_ID) return null;

  const headers = {
    apikey: env.SUPABASE_SERVICE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
  };
  const invoiceRes = await fetch(
    `${env.SUPABASE_URL}/rest/v1/invoices?id=eq.${encodeURIComponent(invoiceId)}` +
      `&organization_id=eq.${encodeURIComponent(env.SM_ORG_ID)}` +
      `&select=id,order_id,status&limit=1`,
    { headers },
  );
  if (!invoiceRes.ok) return null;
  const invoices = await invoiceRes.json();
  const invoice = invoices[0];
  if (!invoice?.order_id || String(pi.metadata?.order_id || "") !== String(invoice.order_id)) return null;

  const orderRes = await fetch(
    `${env.SUPABASE_URL}/rest/v1/orders?id=eq.${encodeURIComponent(invoice.order_id)}` +
      `&organization_id=eq.${encodeURIComponent(env.SM_ORG_ID)}` +
      `&select=id,value,permit_fee,status,sku,location,product_config,job_id,deposit_date,people(first_name,last_name,email)&limit=1`,
    { headers },
  );
  if (!orderRes.ok) return null;
  const orders = await orderRes.json();
  const order = orders[0];
  if (!order) return null;
  if (paymentType === "deposit" && ["partial", "completed"].includes(order.status)) return null;
  if (paymentType === "full" && order.status !== "partial") return null;

  const memorialValue = Number(order.value);
  const permitFee = Number(order.permit_fee || 0);
  if (!Number.isFinite(memorialValue) || memorialValue <= 0 || !Number.isFinite(permitFee) || permitFee < 0) {
    return null;
  }
  const expectedAmountPence = Math.round(
    (paymentType === "full" ? memorialValue * 0.5 : memorialValue * 0.5 + permitFee) * 100,
  );
  if (pi.amount_received !== expectedAmountPence) return null;
  if (String(pi.metadata?.expected_amount_pence || "") !== String(expectedAmountPence)) return null;

  const person = order.people || {};
  return {
    paymentType,
    orderId: order.id,
    jobId: order.job_id || null,
    depositDate: order.deposit_date || null,
    name: [person.first_name, person.last_name].filter(Boolean).join(" "),
    email: person.email || "",
    cemetery: order.location || "",
    product: order.sku || "Memorial",
    productUrl: productPageUrl(order.product_config),
  };
}

// `orders.sku` holds the product *name*; the slug lives in the product_config
// JSON the quote was created with. Rebuild the /memorials/<slug> link from it so
// the deposit emails can link back to the memorial that was actually ordered.
// Re-validated against the slug pattern (as in quotes.js) before it is used as
// an href — the value originally came from a browser payload.
function productPageUrl(productConfig) {
  let config = productConfig;
  if (typeof config === "string") {
    try { config = JSON.parse(config); } catch { return ""; }
  }
  const slug = typeof config?.slug === "string" ? config.slug.toLowerCase().trim() : "";
  if (!/^[a-z0-9-]{1,120}$/.test(slug)) return "";
  return `${SITE_URL}/memorials/${encodeURIComponent(slug)}`;
}

// Stripe retries delivery aggressively, so dedupe by PaymentIntent id (stored
// as `reference`) before inserting another payments row.
async function paymentAlreadyRecorded(env, sbHeaders, piId) {
  try {
    const res = await fetch(
      `${env.SUPABASE_URL}/rest/v1/payments?reference=eq.${encodeURIComponent(piId)}&select=id&limit=1`,
      { headers: { apikey: sbHeaders.apikey, Authorization: sbHeaders.Authorization } },
    );
    if (!res.ok) return false;
    const rows = await res.json();
    return rows.length > 0;
  } catch {
    return false;
  }
}

// ── Payment succeeded ───────────────────────────────────────────────────────────
async function handlePaymentSucceeded(env, pi) {
  const invoiceId = pi.metadata?.invoice_id || "";
  const verifiedTarget = await validatePaymentTarget(env, pi, invoiceId);
  if (!verifiedTarget) {
    console.error(JSON.stringify({
      message: "stripe_payment_target_validation_failed",
      payment_intent: String(pi.id || "").slice(0, 80),
    }));
    return;
  }
  const { name, email, cemetery, product, productUrl, orderId: verifiedOrderId, jobId, depositDate, paymentType: verifiedPaymentType } = verifiedTarget;
  const amountPaid = (pi.amount_received / 100).toFixed(2);
  const today      = new Date().toISOString().split("T")[0];
  let paymentRecordedNow = false;

  // Idempotency gate. Stripe retries webhook delivery on any non-2xx or
  // timeout, so we may see the same payment_intent.succeeded multiple times.
  // If we've already inserted a payments row for this PI, exit before doing
  // anything else (otherwise we double-email customer + business). The
  // payments-row check is the source of truth because every successful path
  // writes one.
  if (env.SUPABASE_URL && env.SUPABASE_SERVICE_KEY) {
    const sbHeadersForCheck = {
      apikey:        env.SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
    };
    if (await paymentAlreadyRecorded(env, sbHeadersForCheck, pi.id)) {
      console.log(JSON.stringify({ message: "stripe_webhook_duplicate_skipped" }));
      return;
    }
  }

  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) {
    console.warn("Supabase not configured — skipping invoice/payment insert");
  } else {
    const sbHeaders = {
      "apikey":        env.SUPABASE_SERVICE_KEY,
      "Authorization": `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      "Content-Type":  "application/json",
    };

    const invoiceType = verifiedPaymentType || verifiedTarget.paymentType || await fetchInvoiceType(env, pi);
    const isFull = invoiceType === "full";
    const orderStatus = isFull ? "completed" : "partial";
    const orderStage = "deposit_paid"; // either payment level unblocks production
    const paymentNote = isFull
      ? (product ? `Full payment — ${product}` : "Full payment")
      : (product ? `Deposit + permit — ${product}` : "Deposit + permit");
    const alreadyRecorded = await paymentAlreadyRecorded(env, sbHeaders, pi.id);

    try {
      if (invoiceId) {
        // Invoice was created at quote time — update it to "partial"/"completed"
        // and record the payment against it.
        const patchRes = await fetch(
          `${env.SUPABASE_URL}/rest/v1/invoices?id=eq.${encodeURIComponent(invoiceId)}&organization_id=eq.${encodeURIComponent(env.SM_ORG_ID)}&select=order_id`,
          {
            method:  "PATCH",
            headers: { ...sbHeaders, "Prefer": "return=representation" },
            body: JSON.stringify({
              status: orderStatus,
              payment_method: "Stripe",
              paid_at: new Date().toISOString(),
              payment_date: today,
            }),
          },
        );
        if (!patchRes.ok) {
          console.error(JSON.stringify({ message: "invoice_update_failed", status: patchRes.status }));
        } else {
          const invRows = await patchRes.json();
          const ordId = invRows[0]?.order_id || verifiedOrderId;
          if (ordId) {
            const orderPatch = { status: orderStatus, stage: orderStage };
            if (!isFull && !depositDate) orderPatch.deposit_date = today;
            await fetch(`${env.SUPABASE_URL}/rest/v1/orders?id=eq.${encodeURIComponent(ordId)}&organization_id=eq.${encodeURIComponent(env.SM_ORG_ID)}`, {
              method: "PATCH",
              headers: { ...sbHeaders, "Prefer": "return=minimal" },
              body: JSON.stringify(orderPatch),
            });
            await markPersonAsPayingCustomer(env, sbHeaders, ordId);
            const paidJobId = jobId || await fetchOrderJobId(env, sbHeaders, ordId);
            if (paidJobId) {
              await fetch(`${env.SUPABASE_URL}/rest/v1/jobs?id=eq.${encodeURIComponent(paidJobId)}&organization_id=eq.${encodeURIComponent(env.SM_ORG_ID)}`, {
                method: "PATCH",
                headers: { ...sbHeaders, "Prefer": "return=minimal" },
                body: JSON.stringify({ paid_at: new Date().toISOString() }),
              });
            }
          }
        }

        if (!alreadyRecorded) {
          const payRes = await fetch(`${env.SUPABASE_URL}/rest/v1/payments`, {
            method:  "POST",
            headers: { ...sbHeaders, "Prefer": "return=minimal" },
            body: JSON.stringify({
              invoice_id: invoiceId,
              amount:     parseFloat(amountPaid),
              date:       today,
              method:     "card",
              reference:  pi.id,
              notes:      paymentNote,
            }),
          });
          if (!payRes.ok) {
            console.error(JSON.stringify({ message: "payment_insert_failed", status: payRes.status }));
          } else {
            paymentRecordedNow = true;
          }
        }
      } else {
        // Fallback: no invoice_id in metadata (e.g. older PI) — look up order by
        // email and create both the invoice and payment records.
        let orderId = null;
        if (email) {
          const normalisedEmail = email.trim().toLowerCase();
          const orderRes = await fetch(
            `${env.SUPABASE_URL}/rest/v1/orders?organization_id=eq.${encodeURIComponent(env.SM_ORG_ID)}&select=id,people!inner(email)&people.email=eq.${encodeURIComponent(normalisedEmail)}&order=created_at.desc&limit=1`,
            { headers: sbHeaders },
          );
          if (orderRes.ok) {
            const rows = await orderRes.json();
            orderId = rows[0]?.id || null;
          }
        }

        const invRes = await fetch(`${env.SUPABASE_URL}/rest/v1/invoices`, {
          method:  "POST",
          headers: { ...sbHeaders, "Prefer": "return=representation" },
          body: JSON.stringify({
            organization_id: env.SM_ORG_ID,
            order_id:       orderId,
            customer_name:  name || email || "Unknown",
            amount:         parseFloat(amountPaid),
            status:         orderStatus,
            issue_date:     today,
            due_date:       today,
            payment_date:   today,
            paid_at:        new Date().toISOString(),
            payment_method: "Stripe",
          }),
        });
        if (!invRes.ok) {
          console.error(JSON.stringify({ message: "invoice_insert_failed", status: invRes.status }));
        } else {
          const invoices     = await invRes.json();
          const newInvoiceId = invoices[0]?.id || null;

          if (!alreadyRecorded) {
            const payRes = await fetch(`${env.SUPABASE_URL}/rest/v1/payments`, {
              method:  "POST",
              headers: { ...sbHeaders, "Prefer": "return=minimal" },
              body: JSON.stringify({
                invoice_id: newInvoiceId,
                amount:     parseFloat(amountPaid),
                date:       today,
                method:     "card",
                reference:  pi.id,
                notes:      paymentNote,
              }),
            });
            if (!payRes.ok) {
              console.error(JSON.stringify({ message: "payment_insert_failed", status: payRes.status }));
            } else {
              paymentRecordedNow = true;
            }
          }

          // Update orders.status to reflect payment
          if (orderId) {
            const orderPatch = { status: orderStatus, stage: orderStage };
            if (!isFull && !depositDate) orderPatch.deposit_date = today;
            await fetch(`${env.SUPABASE_URL}/rest/v1/orders?id=eq.${encodeURIComponent(orderId)}&organization_id=eq.${encodeURIComponent(env.SM_ORG_ID)}`, {
              method: "PATCH",
              headers: { ...sbHeaders, "Prefer": "return=minimal" },
              body: JSON.stringify(orderPatch),
            });
            await markPersonAsPayingCustomer(env, sbHeaders, orderId);
            const paidJobId = jobId || await fetchOrderJobId(env, sbHeaders, orderId);
            if (paidJobId) {
              await fetch(`${env.SUPABASE_URL}/rest/v1/jobs?id=eq.${encodeURIComponent(paidJobId)}&organization_id=eq.${encodeURIComponent(env.SM_ORG_ID)}`, {
                method: "PATCH",
                headers: { ...sbHeaders, "Prefer": "return=minimal" },
                body: JSON.stringify({ paid_at: new Date().toISOString() }),
              });
            }
          }
        }
      }
    } catch {
      console.error(JSON.stringify({ message: "invoice_payment_write_unavailable" }));
    }
  }

  // Only the invocation that won the unique PaymentIntent reference insert
  // may send confirmations. Concurrent Stripe deliveries exit here.
  if (!paymentRecordedNow) return;

  // 2. Send payment confirmation email to customer (non-critical)
  if (env.RESEND_API_KEY && email) {
    try {
      await sendEmail(env.RESEND_API_KEY, {
        from:    `${BUSINESS_NAME} <${FROM_EMAIL}>`,
        to:      email,
        subject: `Deposit confirmed — ${BUSINESS_NAME}`,
        html:    depositConfirmationEmail({ name, email, amountPaid, product, productUrl, cemetery }),
      });
    } catch {
      console.error(JSON.stringify({ message: "deposit_confirmation_email_failed" }));
    }
  }

  // 3. Notify the business (non-critical)
  if (env.RESEND_API_KEY) {
    try {
      await sendEmail(env.RESEND_API_KEY, {
        from:    `${BUSINESS_NAME} <${FROM_EMAIL}>`,
        to:      BUSINESS_EMAIL,
        subject: `Deposit received — £${amountPaid} — ${name || email}`,
        html:    depositBusinessEmail({ name, email, amountPaid, product, productUrl, cemetery, piId: pi.id }),
      });
    } catch {
      console.error(JSON.stringify({ message: "deposit_business_email_failed" }));
    }
  }
}

// ── Email templates ─────────────────────────────────────────────────────────────
function esc(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function depositConfirmationEmail({ name, amountPaid, product, productUrl, cemetery }) {
  const firstName = (name || "").split(" ")[0] || "there";
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#F5F3F0;font-family:-apple-system,'DM Sans',sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#F5F3F0;padding:24px 0;">
  <tr><td align="center">
  <table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border-radius:10px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.08);">

    <tr><td style="background:#2C2C2C;padding:20px 28px;">
      <span style="font-family:Georgia,serif;font-size:18px;color:#fff;font-weight:normal;">Sears Melvin <span style="opacity:0.55;font-weight:300;">Memorials</span></span>
    </td></tr>

    <tr><td style="padding:32px 28px 0;">
      <div style="width:52px;height:52px;background:#4CAF50;border-radius:50%;display:flex;align-items:center;justify-content:center;margin-bottom:20px;">
        <span style="color:white;font-size:28px;line-height:52px;display:block;text-align:center;">✓</span>
      </div>
      <h2 style="font-family:Georgia,serif;font-size:22px;color:#2C2C2C;font-weight:normal;margin:0 0 12px;">Deposit received, ${esc(firstName)}.</h2>
      <p style="color:#555;font-size:15px;line-height:1.7;margin:0 0 24px;">
        Your <strong style="color:#2C2C2C;">£${esc(amountPaid)}</strong> deposit has been received and your order is confirmed.
        We'll be in touch within 24 hours to discuss the next steps.
      </p>
    </td></tr>

    <tr><td style="padding:0 28px 28px;">
      <table width="100%" cellpadding="0" cellspacing="0" style="background:#F5F3F0;border-radius:8px;overflow:hidden;">
        <tr><td style="padding:16px 20px;">
          <div style="font-size:10px;letter-spacing:0.1em;text-transform:uppercase;color:#8B7355;font-weight:700;margin-bottom:10px;">Order summary</div>
          <table width="100%" cellpadding="0" cellspacing="0" style="font-size:13px;">
            ${product  ? `<tr><td style="color:#999;padding:4px 0;width:120px;">Memorial</td><td style="color:#1A1A1A;padding:4px 0;">${esc(product)}${productUrl ? `<br><a href="${productUrl}" style="color:#8B7355;font-size:12px;text-decoration:none;">View this memorial &rarr;</a>` : ""}</td></tr>` : ""}
            ${cemetery ? `<tr><td style="color:#999;padding:4px 0;">Cemetery</td><td style="color:#1A1A1A;padding:4px 0;">${esc(cemetery)}</td></tr>` : ""}
            <tr><td style="color:#999;padding:8px 0 4px;border-top:1px solid #ddd;">Deposit paid</td><td style="color:#2C2C2C;font-weight:700;padding:8px 0 4px;border-top:1px solid #ddd;">£${esc(amountPaid)}</td></tr>
          </table>
        </td></tr>
      </table>
    </td></tr>

    <tr><td style="background:#F5F3F0;border-top:1px solid #E0DCD5;padding:14px 28px;text-align:center;">
      <span style="font-size:11px;color:#BBB;">Sears Melvin Memorials &middot; North London (NW11) &middot; <a href="mailto:${BUSINESS_EMAIL}" style="color:#BBB;">${BUSINESS_EMAIL}</a></span>
    </td></tr>

  </table>
  </td></tr>
</table>
</body></html>`;
}

function depositBusinessEmail({ name, email, amountPaid, product, productUrl, cemetery, piId }) {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#F5F3F0;font-family:-apple-system,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#F5F3F0;padding:24px 0;">
  <tr><td align="center">
  <table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border-radius:10px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.08);">
    <tr><td style="background:#2C2C2C;padding:18px 28px;">
      <table width="100%" cellpadding="0" cellspacing="0"><tr>
        <td><span style="font-family:Georgia,serif;font-size:18px;color:#fff;">Sears Melvin <span style="opacity:0.55;">Memorials</span></span></td>
        <td align="right"><span style="background:#4CAF50;color:#fff;padding:4px 11px;border-radius:3px;font-size:11px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;">Deposit Paid</span></td>
      </tr></table>
    </td></tr>
    <tr><td style="padding:24px 28px;">
      <h2 style="font-family:Georgia,serif;font-size:20px;color:#2C2C2C;font-weight:normal;margin:0 0 16px;">Deposit Received — £${esc(amountPaid)}</h2>
      <table width="100%" cellpadding="0" cellspacing="0" style="font-size:13px;">
        <tr><td style="color:#999;padding:5px 0;width:130px;">Customer</td><td style="color:#1A1A1A;font-weight:600;">${esc(name || "—")}</td></tr>
        <tr><td style="color:#999;padding:5px 0;">Email</td><td><a href="mailto:${esc(email)}" style="color:#8B7355;">${esc(email || "—")}</a></td></tr>
        ${product  ? `<tr><td style="color:#999;padding:5px 0;">Memorial</td><td style="color:#1A1A1A;">${esc(product)}${productUrl ? ` &middot; <a href="${productUrl}" style="color:#8B7355;text-decoration:none;font-weight:600;">View product &rarr;</a>` : ""}</td></tr>` : ""}
        ${cemetery ? `<tr><td style="color:#999;padding:5px 0;">Cemetery</td><td style="color:#1A1A1A;">${esc(cemetery)}</td></tr>` : ""}
        <tr><td style="color:#999;padding:5px 0;">Amount</td><td style="color:#1A1A1A;font-weight:700;">£${esc(amountPaid)}</td></tr>
        <tr><td style="color:#999;padding:5px 0;font-size:11px;">Stripe PI</td><td style="color:#AAA;font-size:11px;">${esc(piId || "—")}</td></tr>
      </table>
    </td></tr>
    <tr><td style="background:#F5F3F0;border-top:1px solid #E0DCD5;padding:12px 28px;text-align:center;">
      <span style="font-size:11px;color:#BBB;">Sears Melvin Memorials &middot; North London (NW11) &middot; ${BUSINESS_EMAIL}</span>
    </td></tr>
  </table>
  </td></tr>
</table>
</body></html>`;
}

async function sendEmail(apiKey, { from, to, subject, html }) {
  const res = await fetch("https://api.resend.com/emails", {
    method:  "POST",
    headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body:    JSON.stringify({ from, to, subject, html }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Resend ${res.status}: ${body}`);
  }
}
