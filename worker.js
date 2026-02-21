/**
 * Sears Melvin Memorials — Cloudflare Workers handler
 * Handles two submission types:
 *   • Regular enquiry  (type !== 'quote')
 *   • Quote request    (type === 'quote')
 *
 * For each submission it:
 *   1. Sends a branded notification email to info@searsmelvin.co.uk
 *   2. Sends a confirmation email to the customer
 *   3. Creates a structured task in ClickUp
 *   4. Inserts a record into Supabase (leads table)
 *   5. Creates a contact in GoHighLevel
 *
 * Environment variables — set in Cloudflare Workers dashboard → Settings → Variables:
 *   RESEND_API_KEY        → from resend.com
 *   CLICKUP_API_KEY       → ClickUp → Settings → Apps → API Token
 *   SUPABASE_URL          → Supabase → Project Settings → API → Project URL
 *   SUPABASE_SERVICE_KEY  → Supabase → Project Settings → API → service_role key
 *   GHL_API_KEY           → GoHighLevel → Settings → Integrations → Private Integrations
 *   GHL_LOCATION_ID       → GoHighLevel → Settings → Business Profile
 */

const CLICKUP_LIST_ID = "901207633256";
const BUSINESS_EMAIL  = "info@searsmelvin.co.uk";
const FROM_EMAIL      = "info@searsmelvin.co.uk"; // Must be verified in Resend
const BUSINESS_NAME   = "Sears Melvin Memorials";

// Stone colour name → hex (for coloured swatch sidebars in emails)
const STONE_COLOURS = {
  "Black Galaxy":    "#1a1a1a",
  "Rustenberg Grey": "#6b6b6b",
  "Vizag Blue":      "#2c3e50",
  "Indian Aurora":   "#8B5A2B",
  "Emerald Pearl":   "#2d4a3e",
  "Ruby Red":        "#722F37",
};

export default {
  async fetch(request, env) {
    const allowedOrigins = ["https://searsmelvin.co.uk", "https://www.searsmelvin.co.uk"];
    const requestOrigin  = request.headers.get("Origin") || "";
    const corsHeaders = {
      "Access-Control-Allow-Origin":  allowedOrigins.includes(requestOrigin) ? requestOrigin : allowedOrigins[0],
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    const url = new URL(request.url);

    // ── GET /config — return publishable keys ──
    if (request.method === "GET" && url.pathname === "/config") {
      return new Response(JSON.stringify({
        stripePublishableKey: env.STRIPE_PUBLISHABLE_KEY || '',
        googleMapsKey:        env.GOOGLE_MAPS_KEY        || '',
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ── POST /stripe — create Stripe PaymentIntent ──
    if (request.method === "POST" && url.pathname === "/stripe") {
      if (!env.STRIPE_SECRET_KEY) {
        return new Response(JSON.stringify({ error: "Stripe not configured" }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const { amount, name, email, cemetery, product: productName } = await request.json();
      const body = new URLSearchParams({
        amount:                               String(Math.round(Number(amount) * 100)),
        currency:                             "gbp",
        "automatic_payment_methods[enabled]": "true",
        "metadata[customer_name]":            name         || "",
        "metadata[customer_email]":           email        || "",
        "metadata[cemetery]":                 cemetery     || "",
        "metadata[product]":                  productName  || "",
        description: `50% deposit — ${productName || "Memorial"} — ${name || ""}`,
      });
      const stripeRes = await fetch("https://api.stripe.com/v1/payment_intents", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${env.STRIPE_SECRET_KEY}`,
          "Content-Type":  "application/x-www-form-urlencoded",
        },
        body,
      });
      const pi = await stripeRes.json();
      if (pi.error) {
        return new Response(JSON.stringify({ error: pi.error.message }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ clientSecret: pi.client_secret }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── POST /stripe-webhook — verify signature, handle payment events ──
    if (request.method === "POST" && url.pathname === "/stripe-webhook") {
      const rawBody     = await request.text();
      const sigHeader   = request.headers.get("stripe-signature") || "";
      const whSecret    = env.STRIPE_WEBHOOK_SECRET || "";

      if (whSecret) {
        const valid = await verifyStripeWebhookSig(rawBody, sigHeader, whSecret);
        if (!valid) {
          return new Response(JSON.stringify({ error: "Invalid signature" }), {
            status: 400, headers: { "Content-Type": "application/json" },
          });
        }
      }

      let event;
      try { event = JSON.parse(rawBody); } catch {
        return new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400 });
      }

      if (event.type === "payment_intent.succeeded") {
        const pi = event.data.object;
        const { customer_name: custName, customer_email: custEmail, cemetery, product: prodName } = pi.metadata;
        const amountPaid = (pi.amount_received / 100).toFixed(2);

        if (env.SUPABASE_URL && env.SUPABASE_SERVICE_KEY && custEmail) {
          try {
            await fetch(
              `${env.SUPABASE_URL}/rest/v1/orders?customer_email=eq.${encodeURIComponent(custEmail)}&order=created_at.desc&limit=1`,
              {
                method: "PATCH",
                headers: {
                  "apikey": env.SUPABASE_SERVICE_KEY,
                  "Authorization": `Bearer ${env.SUPABASE_SERVICE_KEY}`,
                  "Content-Type": "application/json",
                  "Prefer": "return=minimal",
                },
                body: JSON.stringify({ stripe_pi_id: pi.id, deposit_paid: true, deposit_amount: parseFloat(amountPaid) }),
              },
            );
          } catch (e) { console.error("Supabase deposit update failed:", e); }
        }

        if (env.RESEND_API_KEY && custEmail) {
          try {
            await sendEmail(env.RESEND_API_KEY, {
              from:    `${BUSINESS_NAME} <${FROM_EMAIL}>`,
              to:      custEmail,
              subject: `Deposit confirmed — ${BUSINESS_NAME}`,
              html:    workerDepositCustomerEmail({ name: custName, amountPaid, product: prodName, cemetery }),
            });
            await sendEmail(env.RESEND_API_KEY, {
              from:    `${BUSINESS_NAME} <${FROM_EMAIL}>`,
              to:      BUSINESS_EMAIL,
              subject: `Deposit received — £${amountPaid} — ${custName || custEmail}`,
              html:    workerDepositBusinessEmail({ name: custName, email: custEmail, amountPaid, product: prodName, cemetery, piId: pi.id }),
            });
          } catch (e) { console.error("Deposit email failed:", e); }
        }
      }

      return new Response(JSON.stringify({ received: true }), { headers: { "Content-Type": "application/json" } });
    }

    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }

    let data;
    try {
      data = await request.json();
    } catch {
      return json({ ok: false, error: "Invalid request" }, 400, corsHeaders);
    }

    if (!data.name || !data.email) {
      return json({ ok: false, error: "Missing required fields" }, 400, corsHeaders);
    }

    const submittedAt = new Date().toLocaleString("en-GB", {
      timeZone: "Europe/London",
      dateStyle: "medium",
      timeStyle: "short",
    });

    if (data.type === "quote") {
      return handleQuoteRequest(env, data, submittedAt, corsHeaders);
    }
    return handleEnquiry(env, data, submittedAt, corsHeaders);
  },
};


// ═══════════════════════════════════════════════════════════════════
//  QUOTE REQUEST HANDLER
// ═══════════════════════════════════════════════════════════════════
async function handleQuoteRequest(env, data, submittedAt, corsHeaders) {
  const { name, email, phone, message, product = {}, location } = data;
  const firstName = name.split(" ")[0];
  const stoneHex  = STONE_COLOURS[product.colour] || "#8B7355";

  // 1. Business notification email (critical)
  try {
    await sendEmail(env.RESEND_API_KEY, {
      from:    `${BUSINESS_NAME} <${FROM_EMAIL}>`,
      to:      BUSINESS_EMAIL,
      subject: `New Quote Request — ${product.name || "Memorial"} — ${name}`,
      html:    quoteBusinessEmail({ name, email, phone, message, location, product, stoneHex, submittedAt }),
    });
  } catch (err) {
    console.error("Failed to send quote business email:", err);
    return json({ ok: false, error: "Failed to send notification email" }, 500, corsHeaders);
  }

  // 2. Customer confirmation email (non-critical)
  try {
    await sendEmail(env.RESEND_API_KEY, {
      from:    `${BUSINESS_NAME} <${FROM_EMAIL}>`,
      to:      email,
      subject: `Your quote request — ${product.name || "Memorial"} — ${BUSINESS_NAME}`,
      html:    quoteCustomerEmail({ firstName, product, stoneHex }),
    });
  } catch (err) {
    console.error("Failed to send quote customer email:", err);
  }

  // 3. ClickUp task (non-critical)
  try {
    await createClickUpTask(env.CLICKUP_API_KEY, {
      name:        `Quote Request — ${product.name || "Memorial"} — ${name}`,
      description: buildQuoteClickUpDescription({ name, email, phone, message, product, submittedAt }),
      listId:      CLICKUP_LIST_ID,
    });
  } catch (err) {
    console.error("Failed to create ClickUp quote task:", err);
  }

  // 4. Supabase record (non-critical)
  try {
    await insertSupabaseRecord(env, { type: "quote", name, email, phone, product, location });
  } catch (err) {
    console.error("Supabase insert failed:", err);
  }

  // 5. GoHighLevel contact (non-critical)
  try {
    await createGHLContact(env, { name, email, phone, type: "quote", product });
  } catch (err) {
    console.error("GHL contact create failed:", err);
  }

  return json({ ok: true }, 200, corsHeaders);
}


// ═══════════════════════════════════════════════════════════════════
//  REGULAR ENQUIRY HANDLER
// ═══════════════════════════════════════════════════════════════════
async function handleEnquiry(env, data, submittedAt, corsHeaders) {
  const { name, email, phone, message, enquiry_type, location } = data;

  if (!message) {
    return json({ ok: false, error: "Missing required fields" }, 400, corsHeaders);
  }

  // 1. Business notification email (critical)
  try {
    await sendEmail(env.RESEND_API_KEY, {
      from:    `${BUSINESS_NAME} <${FROM_EMAIL}>`,
      to:      BUSINESS_EMAIL,
      subject: `New Enquiry — ${name}`,
      html: `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#F5F3F0;font-family:-apple-system,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#F5F3F0;padding:24px 0;">
  <tr><td align="center">
  <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#fff;border-radius:10px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.08);">
    <tr><td style="background:#2C2C2C;padding:18px 28px;">
      <table width="100%" cellpadding="0" cellspacing="0"><tr>
        <td><span style="font-family:Georgia,serif;font-size:18px;color:#fff;">Sears Melvin <span style="opacity:0.55;font-weight:300;">Memorials</span></span></td>
        <td align="right"><span style="background:#8B7355;color:#fff;padding:4px 11px;border-radius:3px;font-size:11px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;">New Enquiry</span></td>
      </tr></table>
    </td></tr>
    <tr><td style="padding:26px 28px 4px;">
      <h2 style="font-family:Georgia,serif;font-size:22px;color:#2C2C2C;font-weight:normal;margin:0 0 4px;">New Website Enquiry</h2>
      <p style="color:#AAA;font-size:12px;margin:0;">Received ${submittedAt}</p>
    </td></tr>
    <tr><td style="padding:20px 28px 0;"><hr style="border:none;border-top:1px solid #E0DCD5;margin:0;"></td></tr>
    <tr><td style="padding:20px 28px 0;">
      <div style="font-size:10px;letter-spacing:0.08em;text-transform:uppercase;color:#8B7355;font-weight:700;margin-bottom:12px;">Customer</div>
      <table width="100%" cellpadding="0" cellspacing="0" style="font-size:13px;">
        <tr><td style="padding:5px 0;color:#999;width:110px;">Name</td><td style="padding:5px 0;color:#1A1A1A;font-weight:600;">${esc(name)}</td></tr>
        <tr><td style="padding:5px 0;color:#999;">Email</td><td style="padding:5px 0;"><a href="mailto:${esc(email)}" style="color:#8B7355;">${esc(email)}</a></td></tr>
        <tr><td style="padding:5px 0;color:#999;">Phone</td><td style="padding:5px 0;color:#1A1A1A;">${esc(phone || "Not provided")}</td></tr>
        ${enquiry_type ? `<tr><td style="padding:5px 0;color:#999;">Enquiry type</td><td style="padding:5px 0;color:#1A1A1A;">${esc(enquiry_type.replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase()))}</td></tr>` : ""}
      </table>
    </td></tr>
    <tr><td style="padding:16px 28px 28px;">
      <div style="font-size:10px;letter-spacing:0.08em;text-transform:uppercase;color:#8B7355;font-weight:700;margin-bottom:10px;">Message</div>
      <div style="background:#F5F3F0;border-radius:6px;padding:14px 16px;font-size:13px;color:#1A1A1A;line-height:1.7;">${esc(message).replace(/\n/g, "<br>")}</div>
    </td></tr>
    <tr><td style="background:#F5F3F0;border-top:1px solid #E0DCD5;padding:14px 28px;text-align:center;">
      <span style="font-size:11px;color:#BBB;">Sears Melvin Memorials &middot; <a href="mailto:${BUSINESS_EMAIL}" style="color:#BBB;">${BUSINESS_EMAIL}</a></span>
    </td></tr>
  </table>
  </td></tr>
</table>
</body></html>`,
    });
  } catch (err) {
    console.error("Failed to send business notification email:", err);
    return json({ ok: false, error: "Failed to send notification email" }, 500, corsHeaders);
  }

  // 2. Customer confirmation (non-critical)
  try {
    await sendEmail(env.RESEND_API_KEY, {
      from:    `${BUSINESS_NAME} <${FROM_EMAIL}>`,
      to:      email,
      subject: `We've received your enquiry — ${BUSINESS_NAME}`,
      html: `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#F5F3F0;font-family:-apple-system,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#F5F3F0;padding:24px 0;">
  <tr><td align="center">
  <table width="580" cellpadding="0" cellspacing="0" style="max-width:580px;background:#fff;border-radius:10px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.08);">
    <tr><td style="background:#2C2C2C;padding:20px 28px;">
      <span style="font-family:Georgia,serif;font-size:18px;color:#fff;">Sears Melvin <span style="opacity:0.55;font-weight:300;">Memorials</span></span>
    </td></tr>
    <tr><td style="padding:30px 28px 24px;">
      <h2 style="font-family:Georgia,serif;font-size:23px;color:#2C2C2C;font-weight:normal;margin:0 0 14px;">Thank you, ${esc(name.split(" ")[0])}.</h2>
      <p style="color:#555;font-size:15px;line-height:1.7;margin:0 0 16px;">We've received your enquiry and one of our team will be in contact within 24 hours.</p>
      <p style="color:#555;font-size:14px;line-height:1.7;margin:0 0 24px;">If you have any urgent questions in the meantime, please call us on <strong style="color:#2C2C2C;">01268 208 559</strong>.</p>
      <p style="color:#888;font-size:13px;margin:0;line-height:1.7;">With care,<br><strong style="color:#2C2C2C;">The Sears Melvin Team</strong></p>
    </td></tr>
    <tr><td style="background:#1A1A1A;padding:14px 28px;text-align:center;">
      <span style="font-size:11px;color:rgba(255,255,255,0.35);">Sears Melvin Memorials &middot; South London &amp; Beyond &middot; ${BUSINESS_EMAIL}</span>
    </td></tr>
  </table>
  </td></tr>
</table>
</body></html>`,
    });
  } catch (err) {
    console.error("Failed to send customer confirmation email:", err);
  }

  // 3. ClickUp task (non-critical)
  try {
    await createClickUpTask(env.CLICKUP_API_KEY, {
      name:        `New Enquiry — ${name}`,
      description: `=== WEBSITE ENQUIRY ===\n\nCUSTOMER\n• Name:         ${name}\n• Email:        ${email}\n• Phone:        ${phone || "Not provided"}\n• Enquiry type: ${enquiry_type || "Not specified"}\n\nMESSAGE\n${message}\n\n---\nSubmitted: ${submittedAt}`,
      listId:      CLICKUP_LIST_ID,
    });
  } catch (err) {
    console.error("Failed to create ClickUp task:", err);
  }

  // 4. Supabase record (non-critical)
  try {
    await insertSupabaseRecord(env, { type: "enquiry", name, email, phone, enquiry_type, location });
  } catch (err) {
    console.error("Supabase insert failed:", err);
  }

  // 5. GoHighLevel contact (non-critical)
  try {
    await createGHLContact(env, { name, email, phone, type: "enquiry" });
  } catch (err) {
    console.error("GHL contact create failed:", err);
  }

  return json({ ok: true }, 200, corsHeaders);
}


// ═══════════════════════════════════════════════════════════════════
//  EMAIL TEMPLATES
// ═══════════════════════════════════════════════════════════════════

/**
 * Business notification — three clearly labelled sections:
 *   A. Memorial Configuration  B. Customer  C. Customer Notes
 */
function quoteBusinessEmail({ name, email, phone, message, location, product, stoneHex, submittedAt }) {
  const addons      = Array.isArray(product.addons) && product.addons.length > 0
    ? product.addons.join(", ") : "";
  const inscription = product.inscription ? product.inscription.trim() : "";
  const priceFormatted = formatPrice(product.price);

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#F5F3F0;font-family:-apple-system,'DM Sans',sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#F5F3F0;padding:24px 0;">
  <tr><td align="center">
  <table width="620" cellpadding="0" cellspacing="0" style="max-width:620px;background:#fff;border-radius:10px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.08);">

    <!-- ── Header ── -->
    <tr><td style="background:#2C2C2C;padding:18px 28px;">
      <table width="100%" cellpadding="0" cellspacing="0"><tr>
        <td><span style="font-family:Georgia,serif;font-size:18px;color:#fff;font-weight:normal;">Sears Melvin <span style="opacity:0.55;font-weight:300;">Memorials</span></span></td>
        <td align="right"><span style="background:#8B7355;color:#fff;padding:4px 11px;border-radius:3px;font-size:11px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;">New Quote</span></td>
      </tr></table>
    </td></tr>

    <!-- ── Title ── -->
    <tr><td style="padding:26px 28px 4px;">
      <h2 style="font-family:Georgia,serif;font-size:22px;color:#2C2C2C;font-weight:normal;margin:0 0 4px;">New Quote Request</h2>
      <p style="color:#AAA;font-size:12px;margin:0;">Received ${esc(submittedAt)}</p>
    </td></tr>

    <!-- ══ SECTION A: Memorial Configuration ══ -->
    <tr><td style="padding:20px 28px 0;">
      <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #E0DCD5;border-radius:8px;overflow:hidden;">
        <tr>
          <td width="8" style="background:${stoneHex};">&nbsp;</td>
          <td style="padding:18px 20px;">
            <div style="font-size:10px;letter-spacing:0.1em;text-transform:uppercase;color:#8B7355;font-weight:700;margin-bottom:6px;">Memorial Configuration</div>
            <div style="font-family:Georgia,serif;font-size:20px;color:#2C2C2C;margin-bottom:14px;">${esc(product.name || "—")}</div>
            <table cellpadding="0" cellspacing="0" style="font-size:13px;width:100%;">
              <tr>
                <td style="color:#999;padding:4px 0;width:110px;">Type</td>
                <td style="color:#1A1A1A;padding:4px 0;">${esc(product.type || "—")}</td>
              </tr>
              <tr>
                <td style="color:#999;padding:4px 0;">Stone colour</td>
                <td style="color:#1A1A1A;padding:4px 0;">
                  <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${stoneHex};vertical-align:middle;margin-right:5px;border:1px solid rgba(0,0,0,0.15);"></span>${esc(product.colour || "—")}
                </td>
              </tr>
              ${product.size ? `<tr>
                <td style="color:#999;padding:4px 0;">Size</td>
                <td style="color:#1A1A1A;padding:4px 0;">${esc(product.size)}</td>
              </tr>` : ""}
              ${addons ? `<tr>
                <td style="color:#999;padding:4px 0;vertical-align:top;">Optional extras</td>
                <td style="color:#1A1A1A;padding:4px 0;">${esc(addons)}</td>
              </tr>` : ""}
              ${inscription ? `<tr>
                <td style="color:#999;padding:4px 0;vertical-align:top;">Inscription</td>
                <td style="padding:4px 0;">
                  <div style="background:#F5F3F0;border-left:3px solid #D4AF37;padding:8px 12px;font-family:Georgia,serif;font-style:italic;color:#2C2C2C;font-size:13px;line-height:1.6;">${esc(inscription).replace(/\n/g, "<br>")}</div>
                </td>
              </tr>` : ""}
              <tr>
                <td style="color:#999;padding:8px 0 4px;border-top:1px solid #E0DCD5;">Guide total</td>
                <td style="padding:8px 0 4px;border-top:1px solid #E0DCD5;"><strong style="font-size:15px;color:#2C2C2C;">£${esc(priceFormatted)}</strong> <span style="color:#999;font-size:12px;">fully installed</span></td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </td></tr>

    <!-- ══ SECTION B: Customer ══ -->
    <tr><td style="padding:20px 28px 0;"><hr style="border:none;border-top:1px solid #E0DCD5;margin:0;"></td></tr>
    <tr><td style="padding:20px 28px ${message ? "0" : "28px"};">
      <div style="font-size:10px;letter-spacing:0.08em;text-transform:uppercase;color:#8B7355;font-weight:700;margin-bottom:12px;">Customer</div>
      <table width="100%" cellpadding="0" cellspacing="0" style="font-size:13px;">
        <tr><td style="padding:5px 0;color:#999;width:110px;">Name</td><td style="padding:5px 0;color:#1A1A1A;font-weight:600;">${esc(name)}</td></tr>
        <tr><td style="padding:5px 0;color:#999;">Email</td><td style="padding:5px 0;"><a href="mailto:${esc(email)}" style="color:#8B7355;">${esc(email)}</a></td></tr>
        <tr><td style="padding:5px 0;color:#999;">Phone</td><td style="padding:5px 0;color:#1A1A1A;">${esc(phone || "Not provided")}</td></tr>
        ${location ? `<tr><td style="padding:5px 0;color:#999;">Cemetery</td><td style="padding:5px 0;color:#1A1A1A;">${esc(location)}</td></tr>` : ""}
      </table>
    </td></tr>

    <!-- ══ SECTION C: Customer Notes (only if provided) ══ -->
    ${message ? `
    <tr><td style="padding:16px 28px 28px;">
      <div style="font-size:10px;letter-spacing:0.08em;text-transform:uppercase;color:#8B7355;font-weight:700;margin-bottom:10px;">Customer Notes</div>
      <div style="background:#F5F3F0;border-radius:6px;padding:14px 16px;font-size:13px;color:#1A1A1A;line-height:1.7;">${esc(message).replace(/\n/g, "<br>")}</div>
    </td></tr>` : ""}

    <!-- ── Footer ── -->
    <tr><td style="background:#F5F3F0;border-top:1px solid #E0DCD5;padding:14px 28px;text-align:center;">
      <span style="font-size:11px;color:#BBB;">Sears Melvin Memorials &middot; South London &amp; Beyond &middot; <a href="mailto:${BUSINESS_EMAIL}" style="color:#BBB;">${BUSINESS_EMAIL}</a></span>
    </td></tr>

  </table>
  </td></tr>
</table>
</body></html>`;
}

/** Customer confirmation — warm and branded, with quote summary card */
function quoteCustomerEmail({ firstName, product, stoneHex }) {
  const priceFormatted = formatPrice(product.price);
  const addons = Array.isArray(product.addons) && product.addons.length > 0
    ? product.addons.join(", ") : "";

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#F5F3F0;font-family:-apple-system,'DM Sans',sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#F5F3F0;padding:24px 0;">
  <tr><td align="center">
  <table width="580" cellpadding="0" cellspacing="0" style="max-width:580px;background:#fff;border-radius:10px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.08);">

    <tr><td style="background:#2C2C2C;padding:20px 28px;">
      <span style="font-family:Georgia,serif;font-size:18px;color:#fff;font-weight:normal;">Sears Melvin <span style="opacity:0.55;font-weight:300;">Memorials</span></span>
    </td></tr>

    <tr><td style="padding:30px 28px 0;">
      <h2 style="font-family:Georgia,serif;font-size:23px;color:#2C2C2C;font-weight:normal;margin:0 0 14px;">Thank you, ${esc(firstName)}.</h2>
      <p style="color:#555;font-size:15px;line-height:1.7;margin:0 0 22px;">
        We've received your quote request for the
        <strong style="color:#2C2C2C;">${esc(product.name || "memorial")}</strong>
        and our team will be in touch within 24 hours to discuss your requirements.
      </p>
    </td></tr>

    <!-- Quote summary card -->
    <tr><td style="padding:0 28px 24px;">
      <table width="100%" cellpadding="0" cellspacing="0" style="background:#FAF8F5;border:1px solid #E0DCD5;border-radius:8px;overflow:hidden;">
        <tr>
          <td width="6" style="background:${stoneHex};">&nbsp;</td>
          <td style="padding:16px 18px;">
            <div style="font-size:10px;letter-spacing:0.1em;text-transform:uppercase;color:#8B7355;font-weight:700;margin-bottom:4px;">Your Quote Summary</div>
            <div style="font-family:Georgia,serif;font-size:18px;color:#2C2C2C;margin-bottom:12px;">${esc(product.name || "—")}</div>
            <table cellpadding="0" cellspacing="4" style="font-size:13px;">
              <tr><td style="color:#999;width:100px;padding:3px 0;">Type</td><td style="color:#2C2C2C;">${esc(product.type || "—")}</td></tr>
              <tr>
                <td style="color:#999;padding:3px 0;">Stone colour</td>
                <td style="color:#2C2C2C;">
                  <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${stoneHex};vertical-align:middle;margin-right:5px;border:1px solid rgba(0,0,0,0.15);"></span>${esc(product.colour || "—")}
                </td>
              </tr>
              ${product.size ? `<tr><td style="color:#999;padding:3px 0;">Size</td><td style="color:#2C2C2C;">${esc(product.size)}</td></tr>` : ""}
              ${addons ? `<tr><td style="color:#999;padding:3px 0;vertical-align:top;">Extras</td><td style="color:#2C2C2C;">${esc(addons)}</td></tr>` : ""}
              <tr><td style="color:#999;padding:6px 0 3px;border-top:1px solid #E0DCD5;">Guide total</td><td style="color:#2C2C2C;font-weight:700;padding:6px 0 3px;border-top:1px solid #E0DCD5;">£${esc(priceFormatted)} <span style="font-weight:400;color:#999;">fully installed</span></td></tr>
            </table>
          </td>
        </tr>
      </table>
    </td></tr>

    <tr><td style="padding:0 28px 32px;">
      <p style="color:#555;font-size:14px;line-height:1.7;margin:0 0 10px;">
        If you have any urgent questions, please call us on <strong style="color:#2C2C2C;">01268 208 559</strong>.
      </p>
      <p style="color:#888;font-size:13px;margin:0;line-height:1.7;">
        With care,<br><strong style="color:#2C2C2C;">The Sears Melvin Team</strong>
      </p>
    </td></tr>

    <tr><td style="background:#1A1A1A;padding:16px 28px;text-align:center;border-radius:0 0 10px 10px;">
      <span style="font-size:11px;color:rgba(255,255,255,0.35);">Sears Melvin Memorials &middot; South London &amp; Beyond &middot; ${BUSINESS_EMAIL}</span>
    </td></tr>

  </table>
  </td></tr>
</table>
</body></html>`;
}


// ─── ClickUp task description ─────────────────────────────────────────────────
function buildQuoteClickUpDescription({ name, email, phone, message, product, submittedAt }) {
  const addons = Array.isArray(product.addons) && product.addons.length > 0
    ? product.addons.join(", ") : "None";
  const lines = [
    "=== QUOTE REQUEST ===",
    "",
    "PRODUCT SELECTED",
    `• Memorial:     ${product.name    || "—"}`,
    `• Type:         ${product.type    || "—"}`,
    `• Stone:        ${product.colour  || "—"}`,
    `• Size:         ${product.size    || "—"}`,
    `• Extras:       ${addons}`,
    product.inscription ? `• Inscription:  "${product.inscription}"` : "",
    `• Guide total:  £${formatPrice(product.price)}`,
    "",
    "CUSTOMER",
    `• Name:         ${name}`,
    `• Email:        ${email}`,
    `• Phone:        ${phone || "Not provided"}`,
    "",
    message ? `CUSTOMER NOTES\n"${message}"` : "",
    "",
    "---",
    `Submitted: ${submittedAt}`,
  ].filter(l => l !== undefined);
  return lines.join("\n");
}


// ═══════════════════════════════════════════════════════════════════
//  SUPABASE INTEGRATION
// ═══════════════════════════════════════════════════════════════════
/**
 * Writes to three Supabase tables:
 *   customers    — contact info (first_name, last_name, email, phone)
 *   orders       — order details (sku, color, value, order_type, customer contact)
 *   inscriptions — inscription text (only if quote has inscription)
 */
async function insertSupabaseRecord(env, { type, name, email, phone, enquiry_type, location, product }) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) return;

  const headers = {
    "apikey":        env.SUPABASE_SERVICE_KEY,
    "Authorization": `Bearer ${env.SUPABASE_SERVICE_KEY}`,
    "Content-Type":  "application/json",
    "Prefer":        "return=minimal",
  };

  const parts = name.trim().split(" ");

  // 1. customers table
  const custRes = await fetch(`${env.SUPABASE_URL}/rest/v1/customers`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      first_name: parts[0],
      last_name:  parts.slice(1).join(" ") || null,
      email,
      phone: phone || null,
    }),
  });
  if (!custRes.ok) throw new Error(`Supabase customers error ${custRes.status}: ${await custRes.text()}`);

  // 2. orders table
  const orderRes = await fetch(`${env.SUPABASE_URL}/rest/v1/orders`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      customer_name:  name,
      customer_email: email,
      customer_phone: phone || null,
      order_type:     type === "quote" ? "quote" : (enquiry_type || null),
      sku:            product?.name   || null,
      color:          product?.colour || null,
      value:          product?.price  ? parseFloat(product.price) : null,
      location:       location || null,
    }),
  });
  if (!orderRes.ok) throw new Error(`Supabase orders error ${orderRes.status}: ${await orderRes.text()}`);

  // 3. inscriptions table (only for quotes with inscription text)
  if (product?.inscription) {
    const inscRes = await fetch(`${env.SUPABASE_URL}/rest/v1/inscriptions`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        inscription_text: product.inscription,
      }),
    });
    if (!inscRes.ok) throw new Error(`Supabase inscriptions error ${inscRes.status}: ${await inscRes.text()}`);
  }
}


// ═══════════════════════════════════════════════════════════════════
//  GOHIGHLEVEL INTEGRATION
// ═══════════════════════════════════════════════════════════════════
async function createGHLContact(env, { name, email, phone, type, product }) {
  if (!env.GHL_API_KEY || !env.GHL_LOCATION_ID) return;

  const parts     = name.trim().split(" ");
  const firstName = parts[0];
  const lastName  = parts.slice(1).join(" ") || "";

  const tags = ["website-lead", type === "quote" ? "quote-request" : "enquiry"];
  if (product?.type) tags.push(product.type.toLowerCase().replace(/\s+/g, "-"));

  const customFields = [
    product?.name   ? { key: "memorial_product", field_value: product.name }  : null,
    product?.colour ? { key: "stone_colour",     field_value: product.colour } : null,
    product?.size   ? { key: "memorial_size",    field_value: product.size }   : null,
    product?.price  ? { key: "guide_price",      field_value: `£${formatPrice(product.price)}` } : null,
  ].filter(Boolean);

  const res = await fetch("https://services.leadconnectorhq.com/contacts/", {
    method:  "POST",
    headers: {
      "Authorization": `Bearer ${env.GHL_API_KEY}`,
      "Version":       "2021-07-28",
      "Content-Type":  "application/json",
    },
    body: JSON.stringify({
      locationId: env.GHL_LOCATION_ID,
      firstName,
      lastName,
      email,
      phone:        phone || undefined,
      source:       "Website",
      tags,
      customFields,
    }),
  });

  if (!res.ok) throw new Error(`GHL error ${res.status}: ${await res.text()}`);
}


// ─── Helper: format a price string as "2,481" (no decimals, no £ prefix) ──────
function formatPrice(str) {
  const n = parseFloat(str);
  if (isNaN(n)) return str || "—";
  return n.toLocaleString("en-GB", { maximumFractionDigits: 0 });
}

// ─── Helper: escape HTML in user-supplied strings ─────────────────────────────
function esc(str) {
  return String(str ?? "")
    .replace(/&/g,  "&amp;")
    .replace(/</g,  "&lt;")
    .replace(/>/g,  "&gt;")
    .replace(/"/g,  "&quot;")
    .replace(/'/g,  "&#39;");
}

// ─── Helper: send email via Resend ───────────────────────────────────────────
async function sendEmail(apiKey, { from, to, subject, html }) {
  const res = await fetch("https://api.resend.com/emails", {
    method:  "POST",
    headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body:    JSON.stringify({ from, to, subject, html }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Resend error: ${err}`);
  }
}

// ─── Helper: create task in ClickUp ──────────────────────────────────────────
async function createClickUpTask(apiKey, { name, description, listId }) {
  const res = await fetch(`https://api.clickup.com/api/v2/list/${listId}/task`, {
    method:  "POST",
    headers: { "Authorization": apiKey, "Content-Type": "application/json" },
    body:    JSON.stringify({ name, description }),
  });
  if (!res.ok) throw new Error(`ClickUp error: ${await res.text()}`);
}

// ─── Stripe webhook signature verification ────────────────────────────────────
async function verifyStripeWebhookSig(rawBody, sigHeader, secret) {
  if (!sigHeader || !secret) return false;
  const parts  = sigHeader.split(",");
  const tPart  = parts.find(p => p.startsWith("t="));
  const v1Part = parts.find(p => p.startsWith("v1="));
  if (!tPart || !v1Part) return false;
  const timestamp = tPart.slice(2);
  const givenSig  = v1Part.slice(3);
  if (Math.abs(Math.floor(Date.now() / 1000) - parseInt(timestamp, 10)) > 300) return false;
  const signedPayload = `${timestamp}.${rawBody}`;
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sigBytes    = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(signedPayload));
  const computedSig = Array.from(new Uint8Array(sigBytes)).map(b => b.toString(16).padStart(2, "0")).join("");
  return computedSig === givenSig;
}

// ─── Deposit email templates (worker) ────────────────────────────────────────
function workerDepositCustomerEmail({ name, amountPaid, product, cemetery }) {
  const firstName = (name || "").split(" ")[0] || "there";
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#F5F3F0;font-family:-apple-system,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#F5F3F0;padding:24px 0;">
<tr><td align="center"><table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border-radius:10px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,.08);">
<tr><td style="background:#2C2C2C;padding:20px 28px;"><span style="font-family:Georgia,serif;font-size:18px;color:#fff;">Sears Melvin <span style="opacity:.55;font-weight:300;">Memorials</span></span></td></tr>
<tr><td style="padding:32px 28px 0;">
<h2 style="font-family:Georgia,serif;font-size:22px;color:#2C2C2C;font-weight:normal;margin:0 0 12px;">Deposit received, ${esc(firstName)}.</h2>
<p style="color:#555;font-size:15px;line-height:1.7;margin:0 0 24px;">Your <strong style="color:#2C2C2C;">£${esc(amountPaid)}</strong> deposit has been received and your order is confirmed. We'll be in touch within 24 hours.</p>
</td></tr>
<tr><td style="padding:0 28px 28px;"><table width="100%" cellpadding="0" cellspacing="0" style="background:#F5F3F0;border-radius:8px;">
<tr><td style="padding:16px 20px;"><div style="font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:#8B7355;font-weight:700;margin-bottom:10px;">Order summary</div>
<table width="100%" cellpadding="0" cellspacing="0" style="font-size:13px;">
${product  ? `<tr><td style="color:#999;padding:4px 0;width:120px;">Memorial</td><td style="color:#1A1A1A;">${esc(product)}</td></tr>` : ""}
${cemetery ? `<tr><td style="color:#999;padding:4px 0;">Cemetery</td><td style="color:#1A1A1A;">${esc(cemetery)}</td></tr>` : ""}
<tr><td style="color:#999;padding:8px 0 4px;border-top:1px solid #ddd;">Deposit paid</td><td style="color:#2C2C2C;font-weight:700;padding:8px 0 4px;border-top:1px solid #ddd;">£${esc(amountPaid)}</td></tr>
</table></td></tr></table></td></tr>
<tr><td style="background:#F5F3F0;border-top:1px solid #E0DCD5;padding:14px 28px;text-align:center;"><span style="font-size:11px;color:#BBB;">Sears Melvin Memorials &middot; ${BUSINESS_EMAIL} &middot; 01268 208 559</span></td></tr>
</table></td></tr></table></body></html>`;
}

function workerDepositBusinessEmail({ name, email, amountPaid, product, cemetery, piId }) {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#F5F3F0;font-family:-apple-system,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#F5F3F0;padding:24px 0;">
<tr><td align="center"><table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border-radius:10px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,.08);">
<tr><td style="background:#2C2C2C;padding:18px 28px;"><table width="100%" cellpadding="0" cellspacing="0"><tr>
<td><span style="font-family:Georgia,serif;font-size:18px;color:#fff;">Sears Melvin <span style="opacity:.55;">Memorials</span></span></td>
<td align="right"><span style="background:#4CAF50;color:#fff;padding:4px 11px;border-radius:3px;font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;">Deposit Paid</span></td>
</tr></table></td></tr>
<tr><td style="padding:24px 28px;">
<h2 style="font-family:Georgia,serif;font-size:20px;color:#2C2C2C;font-weight:normal;margin:0 0 16px;">Deposit Received — £${esc(amountPaid)}</h2>
<table width="100%" cellpadding="0" cellspacing="0" style="font-size:13px;">
<tr><td style="color:#999;padding:5px 0;width:130px;">Customer</td><td style="color:#1A1A1A;font-weight:600;">${esc(name || "—")}</td></tr>
<tr><td style="color:#999;padding:5px 0;">Email</td><td><a href="mailto:${esc(email)}" style="color:#8B7355;">${esc(email || "—")}</a></td></tr>
${product  ? `<tr><td style="color:#999;padding:5px 0;">Memorial</td><td style="color:#1A1A1A;">${esc(product)}</td></tr>` : ""}
${cemetery ? `<tr><td style="color:#999;padding:5px 0;">Cemetery</td><td style="color:#1A1A1A;">${esc(cemetery)}</td></tr>` : ""}
<tr><td style="color:#999;padding:5px 0;">Amount</td><td style="color:#1A1A1A;font-weight:700;">£${esc(amountPaid)}</td></tr>
<tr><td style="color:#999;padding:5px 0;font-size:11px;">Stripe PI</td><td style="color:#AAA;font-size:11px;">${esc(piId || "—")}</td></tr>
</table></td></tr>
<tr><td style="background:#F5F3F0;border-top:1px solid #E0DCD5;padding:12px 28px;text-align:center;"><span style="font-size:11px;color:#BBB;">Sears Melvin Memorials &middot; ${BUSINESS_EMAIL}</span></td></tr>
</table></td></tr></table></body></html>`;
}

// ─── Helper: return JSON response ────────────────────────────────────────────
function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...extraHeaders },
  });
}
