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
  const age = Math.floor(Date.now() / 1000) - parseInt(timestamp, 10);
  if (age > 300) return false;

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
  const rawBody    = await request.text();
  const sigHeader  = request.headers.get("stripe-signature") || "";
  const webhookSecret = env.STRIPE_WEBHOOK_SECRET || "";

  if (webhookSecret) {
    const valid = await verifyStripeSignature(rawBody, sigHeader, webhookSecret);
    if (!valid) {
      console.error("Stripe webhook signature verification failed");
      return new Response(JSON.stringify({ error: "Invalid signature" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }
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
    const pi  = event.data.object;
    const err = pi.last_payment_error?.message || "Unknown error";
    console.error(`Payment failed for PI ${pi.id}: ${err}`);
  }

  return new Response(JSON.stringify({ received: true }), {
    headers: { "Content-Type": "application/json" },
  });
}

// Resolve the order's person_id and flip people.is_customer = TRUE. This is the
// only code path allowed to set is_customer (the flag means "has paid at least
// once"). Idempotent and isolated so a flip failure can't block invoice/payment
// writes upstream.
async function markPersonAsPayingCustomer(env, sbHeaders, orderId) {
  if (!orderId) return;
  try {
    const orderRes = await fetch(
      `${env.SUPABASE_URL}/rest/v1/orders?id=eq.${orderId}&select=person_id`,
      { headers: { apikey: sbHeaders.apikey, Authorization: sbHeaders.Authorization } },
    );
    if (!orderRes.ok) {
      console.error(`is_customer flip: orders lookup ${orderRes.status}: ${await orderRes.text()}`);
      return;
    }
    const personId = (await orderRes.json())[0]?.person_id;
    if (!personId) return;
    const patchRes = await fetch(
      `${env.SUPABASE_URL}/rest/v1/people?id=eq.${personId}`,
      {
        method: "PATCH",
        headers: { ...sbHeaders, Prefer: "return=minimal" },
        body: JSON.stringify({ is_customer: true }),
      },
    );
    if (!patchRes.ok) {
      console.error(`is_customer flip: people PATCH ${patchRes.status}: ${await patchRes.text()}`);
    }
  } catch (err) {
    console.error("is_customer flip failed:", err);
  }
}

// Read invoice_type from the underlying Stripe Invoice (metadata is set when the
// invoice is created in submit.js). Returns "full" or "deposit" — defaults to
// "deposit" when the PI isn't tied to an invoice or the call fails.
async function fetchInvoiceType(env, pi) {
  if (!pi.invoice || !env.STRIPE_SECRET_KEY) return "deposit";
  try {
    const res = await fetch(`https://api.stripe.com/v1/invoices/${pi.invoice}`, {
      headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}` },
    });
    if (!res.ok) return "deposit";
    const inv = await res.json();
    return inv.metadata?.invoice_type === "full" ? "full" : "deposit";
  } catch (err) {
    console.error("Failed to fetch Stripe invoice metadata:", err);
    return "deposit";
  }
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
  const { customer_name: name, customer_email: email, cemetery, product,
          invoice_id: invoiceId } = pi.metadata;
  const amountPaid = (pi.amount_received / 100).toFixed(2);
  const today      = new Date().toISOString().split("T")[0];

  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) {
    console.warn("Supabase not configured — skipping invoice/payment insert");
  } else {
    const sbHeaders = {
      "apikey":        env.SUPABASE_SERVICE_KEY,
      "Authorization": `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      "Content-Type":  "application/json",
    };

    const invoiceType = await fetchInvoiceType(env, pi);
    const isFull = invoiceType === "full";
    const orderStatus = isFull ? "completed" : "partial";
    const orderStage = "deposit_paid"; // either payment level unblocks production
    const paymentNote = isFull
      ? (product ? `Full payment — ${product}` : "Full payment")
      : (product ? `50% deposit — ${product}` : "50% deposit");
    const alreadyRecorded = await paymentAlreadyRecorded(env, sbHeaders, pi.id);

    try {
      if (invoiceId) {
        // Invoice was created at quote time — update it to "partial"/"completed"
        // and record the payment against it.
        const patchRes = await fetch(
          `${env.SUPABASE_URL}/rest/v1/invoices?id=eq.${invoiceId}&select=order_id`,
          {
            method:  "PATCH",
            headers: { ...sbHeaders, "Prefer": "return=representation" },
            body: JSON.stringify({ status: orderStatus, payment_method: "Stripe" }),
          },
        );
        if (!patchRes.ok) {
          console.error(`Supabase invoices PATCH error ${patchRes.status}: ${await patchRes.text()}`);
        } else {
          const invRows = await patchRes.json();
          const ordId = invRows[0]?.order_id;
          if (ordId) {
            await fetch(`${env.SUPABASE_URL}/rest/v1/orders?id=eq.${ordId}`, {
              method: "PATCH",
              headers: { ...sbHeaders, "Prefer": "return=minimal" },
              body: JSON.stringify({ status: orderStatus, stage: orderStage }),
            });
            await markPersonAsPayingCustomer(env, sbHeaders, ordId);
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
            console.error(`Supabase payments insert error ${payRes.status}: ${await payRes.text()}`);
          }
        }
      } else {
        // Fallback: no invoice_id in metadata (e.g. older PI) — look up order by
        // email and create both the invoice and payment records.
        let orderId = null;
        if (email) {
          const normalisedEmail = email.trim().toLowerCase();
          const orderRes = await fetch(
            `${env.SUPABASE_URL}/rest/v1/orders?select=id,people!inner(email)&people.email=eq.${encodeURIComponent(normalisedEmail)}&order=created_at.desc&limit=1`,
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
            order_id:       orderId,
            customer_name:  name || email || "Unknown",
            amount:         parseFloat(amountPaid),
            status:         orderStatus,
            issue_date:     today,
            due_date:       today,
            payment_method: "Stripe",
          }),
        });
        if (!invRes.ok) {
          console.error(`Supabase invoices insert error ${invRes.status}: ${await invRes.text()}`);
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
              console.error(`Supabase payments insert error ${payRes.status}: ${await payRes.text()}`);
            }
          }

          // Update orders.status to reflect payment
          if (orderId) {
            await fetch(`${env.SUPABASE_URL}/rest/v1/orders?id=eq.${orderId}`, {
              method: "PATCH",
              headers: { ...sbHeaders, "Prefer": "return=minimal" },
              body: JSON.stringify({ status: orderStatus, stage: orderStage }),
            });
            await markPersonAsPayingCustomer(env, sbHeaders, orderId);
          }
        }
      }
    } catch (err) {
      console.error("Supabase invoice/payment insert failed:", err);
    }
  }

  // 2. Send payment confirmation email to customer (non-critical)
  if (env.RESEND_API_KEY && email) {
    try {
      await sendEmail(env.RESEND_API_KEY, {
        from:    `${BUSINESS_NAME} <${FROM_EMAIL}>`,
        to:      email,
        subject: `Deposit confirmed — ${BUSINESS_NAME}`,
        html:    depositConfirmationEmail({ name, email, amountPaid, product, cemetery }),
      });
    } catch (err) {
      console.error("Deposit confirmation email failed:", err);
    }
  }

  // 3. Notify the business (non-critical)
  if (env.RESEND_API_KEY) {
    try {
      await sendEmail(env.RESEND_API_KEY, {
        from:    `${BUSINESS_NAME} <${FROM_EMAIL}>`,
        to:      BUSINESS_EMAIL,
        subject: `Deposit received — £${amountPaid} — ${name || email}`,
        html:    depositBusinessEmail({ name, email, amountPaid, product, cemetery, piId: pi.id }),
      });
    } catch (err) {
      console.error("Deposit business email failed:", err);
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

function depositConfirmationEmail({ name, amountPaid, product, cemetery }) {
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
            ${product  ? `<tr><td style="color:#999;padding:4px 0;width:120px;">Memorial</td><td style="color:#1A1A1A;padding:4px 0;">${esc(product)}</td></tr>` : ""}
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

function depositBusinessEmail({ name, email, amountPaid, product, cemetery, piId }) {
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
        ${product  ? `<tr><td style="color:#999;padding:5px 0;">Memorial</td><td style="color:#1A1A1A;">${esc(product)}</td></tr>` : ""}
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
