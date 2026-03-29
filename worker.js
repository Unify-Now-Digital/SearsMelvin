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
      const { amount, name, email, cemetery, product: productName, invoiceId } = await request.json();
      const parsedAmount = Number(amount);
      if (!parsedAmount || parsedAmount <= 0) {
        return new Response(JSON.stringify({ error: "Invalid amount" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const body = new URLSearchParams({
        amount:                               String(Math.round(parsedAmount * 100)),
        currency:                             "gbp",
        "automatic_payment_methods[enabled]": "true",
        "metadata[customer_name]":            name         || "",
        "metadata[customer_email]":           email        || "",
        "metadata[cemetery]":                 cemetery     || "",
        "metadata[product]":                  productName  || "",
        "metadata[invoice_id]":               invoiceId    || "",
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
        const { customer_name: custName, customer_email: custEmail, cemetery,
                product: prodName, invoice_id: piInvoiceId } = pi.metadata;
        const amountPaid = (pi.amount_received / 100).toFixed(2);
        const today      = new Date().toISOString().split("T")[0];

        if (env.SUPABASE_URL && env.SUPABASE_SERVICE_KEY) {
          const sbH = {
            "apikey":        env.SUPABASE_SERVICE_KEY,
            "Authorization": `Bearer ${env.SUPABASE_SERVICE_KEY}`,
            "Content-Type":  "application/json",
          };
          try {
            if (piInvoiceId) {
              // Invoice was created at quote time — update status to "partial" and record payment.
              const patchRes = await fetch(
                `${env.SUPABASE_URL}/rest/v1/invoices?id=eq.${piInvoiceId}`,
                {
                  method:  "PATCH",
                  headers: { ...sbH, "Prefer": "return=minimal" },
                  body: JSON.stringify({ status: "partial", payment_method: "Stripe" }),
                },
              );
              if (!patchRes.ok) {
                console.error(`Supabase invoices PATCH error ${patchRes.status}: ${await patchRes.text()}`);
              }

              await fetch(`${env.SUPABASE_URL}/rest/v1/payments`, {
                method:  "POST",
                headers: { ...sbH, "Prefer": "return=minimal" },
                body: JSON.stringify({
                  invoice_id: piInvoiceId,
                  amount:     parseFloat(amountPaid),
                  date:       today,
                  method:     "card",
                  reference:  pi.id,
                  notes:      prodName ? `50% deposit — ${prodName}` : "50% deposit",
                }),
              });
            } else {
              // Fallback: no invoice_id in metadata — look up order by email,
              // create invoice and payment records.
              let orderId = null;
              if (custEmail) {
                const oRes = await fetch(
                  `${env.SUPABASE_URL}/rest/v1/orders?customer_email=eq.${encodeURIComponent(custEmail)}&order=created_at.desc&limit=1&select=id`,
                  { headers: sbH },
                );
                if (oRes.ok) { const rows = await oRes.json(); orderId = rows[0]?.id || null; }
              }

              const invRes = await fetch(`${env.SUPABASE_URL}/rest/v1/invoices`, {
                method:  "POST",
                headers: { ...sbH, "Prefer": "return=representation" },
                body: JSON.stringify({
                  order_id:       orderId,
                  customer_name:  custName || custEmail || "Unknown",
                  amount:         parseFloat(amountPaid),
                  status:         "partial",
                  issue_date:     today,
                  due_date:       today,
                  payment_method: "Stripe",
                }),
              });
              if (invRes.ok) {
                const invoices  = await invRes.json();
                const invoiceId = invoices[0]?.id || null;

                await fetch(`${env.SUPABASE_URL}/rest/v1/payments`, {
                  method:  "POST",
                  headers: { ...sbH, "Prefer": "return=minimal" },
                  body: JSON.stringify({
                    invoice_id: invoiceId,
                    amount:     parseFloat(amountPaid),
                    date:       today,
                    method:     "card",
                    reference:  pi.id,
                    notes:      prodName ? `50% deposit — ${prodName}` : "50% deposit",
                  }),
                });
              } else {
                console.error(`Supabase invoices insert error ${invRes.status}: ${await invRes.text()}`);
              }
            }
          } catch (e) { console.error("Supabase invoice/payment insert failed:", e); }
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
    if (data.type === "appointment") {
      return handleAppointment(env, data, submittedAt, corsHeaders);
    }
    return handleEnquiry(env, data, submittedAt, corsHeaders);
  },
};


// ═══════════════════════════════════════════════════════════════════
//  QUOTE REQUEST HANDLER
// ═══════════════════════════════════════════════════════════════════
async function handleQuoteRequest(env, data, submittedAt, corsHeaders) {
  const { name, email, phone, message, product = {}, location, payment_preference } = data;
  const firstName = name.split(" ")[0];
  const stoneHex  = STONE_COLOURS[product.colour] || "#8B7355";
  const preEditToken = generateToken();

  // 0. Stripe Invoices — always create both deposit and full payment invoices
  let stripeDepositUrl = null;
  let stripeFullUrl = null;
  if (env.STRIPE_SECRET_KEY) {
    try {
      stripeDepositUrl = await createStripeDepositInvoice(env.STRIPE_SECRET_KEY, {
        name, email, phone, product, location,
        isFullInvoice: false,
      });
    } catch (err) {
      console.error("Stripe deposit invoice creation failed:", err);
    }
    try {
      stripeFullUrl = await createStripeDepositInvoice(env.STRIPE_SECRET_KEY, {
        name, email, phone, product, location,
        isFullInvoice: true,
      });
    } catch (err) {
      console.error("Stripe full invoice creation failed:", err);
    }
  }

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
      html:    quoteCustomerEmail({ firstName, product, stoneHex, editToken: preEditToken, email }),
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

  // 4. Supabase record (non-critical) — returns { invoiceId, editToken } for quotes
  let invoiceId = null;
  let editToken = null;
  try {
    const sbResult = await insertSupabaseRecord(env, { type: "quote", name, email, phone, product, location, message, preEditToken });
    invoiceId = sbResult?.invoiceId || null;
    editToken = sbResult?.editToken || null;
  } catch (err) {
    console.error("Supabase insert failed:", err);
  }

  // 5. GoHighLevel contact + opportunity (non-critical)
  try {
    const contactId = await createGHLContact(env, { name, email, phone, type: "quote", cemetery: location });
    try {
      await createGHLOpportunity(env, {
        contactId,
        name: `${product.name || "Memorial"} — ${name}`,
        monetaryValue: parseFloat(product.price) || 0,
        message: message || null,
        productChoice: product.name || null,
        colour: product.colour || null,
      });
    } catch (err) {
      console.error("GHL opportunity create failed:", err);
    }
  } catch (err) {
    console.error("GHL contact create failed:", err);
  }

  return json({ ok: true, invoiceId, stripeDepositUrl, stripeFullUrl, editToken }, 200, corsHeaders);
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
      <p style="color:#AAA;font-size:12px;margin:0;">Received ${esc(submittedAt)}</p>
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
      <span style="font-size:11px;color:#BBB;">Sears Melvin Memorials &middot; North London (NW11) &middot; <a href="mailto:${BUSINESS_EMAIL}" style="color:#BBB;">${BUSINESS_EMAIL}</a></span>
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
      <p style="color:#555;font-size:14px;line-height:1.7;margin:0 0 24px;">If you have any urgent questions in the meantime, please call us on <strong style="color:#2C2C2C;">+44 20 3835 2548</strong>.</p>
      <p style="color:#888;font-size:13px;margin:0;line-height:1.7;">With care,<br><strong style="color:#2C2C2C;">The Sears Melvin Team</strong></p>
    </td></tr>
    <tr><td style="background:#1A1A1A;padding:14px 28px;text-align:center;">
      <span style="font-size:11px;color:rgba(255,255,255,0.35);">Sears Melvin Memorials &middot; North London (NW11) &middot; ${BUSINESS_EMAIL}</span>
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
    await createGHLContact(env, { name, email, phone, type: "enquiry", cemetery: location });
  } catch (err) {
    console.error("GHL contact create failed:", err);
  }

  return json({ ok: true }, 200, corsHeaders);
}


// ═══════════════════════════════════════════════════════════════════
//  APPOINTMENT HANDLER
// ═══════════════════════════════════════════════════════════════════

async function handleAppointment(env, data, submittedAt, corsHeaders) {
  const { name, email, phone, appointment_type, appointment_date, appointment_time, notes } = data;
  if (!appointment_date || !appointment_time)
    return json({ ok: false, error: "Missing date or time" }, 400, corsHeaders);

  const firstName = name.split(" ")[0];
  const typeLabels = { showroom: "Showroom Visit (NW11)", phone: "Phone Consultation", video: "Video Call" };
  const typeLabel = typeLabels[appointment_type] || appointment_type;
  const dateFormatted = new Date(appointment_date + "T00:00:00").toLocaleDateString("en-GB", {
    weekday: "long", day: "numeric", month: "long", year: "numeric",
  });

  // 1. Google Calendar event
  let calendarLink = null;
  try {
    calendarLink = await createGoogleCalendarEvent(env, { name, email, phone, appointment_type, appointment_date, appointment_time, notes, typeLabel });
  } catch (err) {
    console.error("Google Calendar event creation failed:", err);
  }

  // 2. Business notification email
  try {
    await sendEmail(env.RESEND_API_KEY, {
      from: `${BUSINESS_NAME} <${FROM_EMAIL}>`,
      to: BUSINESS_EMAIL,
      subject: `New Appointment Request — ${typeLabel} — ${name}`,
      html: `<div style="font-family:-apple-system,sans-serif;max-width:600px;margin:0 auto;padding:2rem;">
        <h2 style="color:#2C2C2C;">New Appointment Request</h2>
        <table style="width:100%;border-collapse:collapse;">
          <tr><td style="padding:8px 0;color:#666;width:140px;">Customer</td><td style="padding:8px 0;font-weight:600;">${esc(name)}</td></tr>
          <tr><td style="padding:8px 0;color:#666;">Email</td><td style="padding:8px 0;"><a href="mailto:${esc(email)}">${esc(email)}</a></td></tr>
          <tr><td style="padding:8px 0;color:#666;">Phone</td><td style="padding:8px 0;">${esc(phone || "Not provided")}</td></tr>
          <tr><td style="padding:8px 0;color:#666;">Type</td><td style="padding:8px 0;font-weight:600;">${esc(typeLabel)}</td></tr>
          <tr><td style="padding:8px 0;color:#666;">Date</td><td style="padding:8px 0;font-weight:600;">${dateFormatted}</td></tr>
          <tr><td style="padding:8px 0;color:#666;">Time</td><td style="padding:8px 0;font-weight:600;">${esc(appointment_time)}</td></tr>
          ${notes ? `<tr><td style="padding:8px 0;color:#666;">Notes</td><td style="padding:8px 0;">${esc(notes)}</td></tr>` : ""}
        </table>
        ${calendarLink ? `<p style="margin-top:1rem;"><a href="${calendarLink}" style="color:#8B7355;font-weight:600;">View in Google Calendar →</a></p>` : ""}
        <p style="color:#999;font-size:0.85rem;margin-top:1.5rem;">Submitted: ${submittedAt}</p>
      </div>`,
    });
  } catch (err) {
    console.error("Failed to send appointment business email:", err);
    return json({ ok: false, error: "Failed to send notification" }, 500, corsHeaders);
  }

  // 3. Customer confirmation email
  try {
    await sendEmail(env.RESEND_API_KEY, {
      from: `${BUSINESS_NAME} <${FROM_EMAIL}>`,
      to: email,
      subject: `Appointment request received — ${BUSINESS_NAME}`,
      html: `<div style="font-family:-apple-system,sans-serif;max-width:600px;margin:0 auto;padding:2rem;">
        <h1 style="color:#2C2C2C;font-size:1.5rem;text-align:center;">Appointment Request Received</h1>
        <p style="color:#666;line-height:1.8;">Dear ${esc(firstName)},</p>
        <p style="color:#666;line-height:1.8;">Thank you for requesting a <strong>${esc(typeLabel.toLowerCase())}</strong>. We've received your request for:</p>
        <div style="background:#FAF8F5;border-radius:8px;padding:1.25rem;margin:1.5rem 0;border-left:4px solid #8B7355;">
          <p style="margin:0;color:#2C2C2C;font-weight:600;">${dateFormatted} at ${esc(appointment_time)}</p>
          <p style="margin:0.25rem 0 0;color:#666;">${esc(typeLabel)}</p>
        </div>
        <p style="color:#666;line-height:1.8;">We'll confirm your appointment within 24 hours. Once confirmed, you'll receive a calendar invite.</p>
        <p style="color:#666;line-height:1.8;">To change or cancel, reply to this email or call <strong>+44 20 3835 2548</strong>.</p>
        <p style="color:#666;line-height:1.8;margin-top:1.5rem;">Warm regards,<br><strong>Sears Melvin Memorials</strong></p>
      </div>`,
    });
  } catch (err) {
    console.error("Failed to send appointment customer email:", err);
  }

  // 4. ClickUp task
  try {
    await createClickUpTask(env.CLICKUP_API_KEY, {
      name: `Appointment — ${typeLabel} — ${name}`,
      description: `=== APPOINTMENT REQUEST ===\n\nCUSTOMER\n• Name: ${name}\n• Email: ${email}\n• Phone: ${phone || "Not provided"}\n\nAPPOINTMENT\n• Type: ${typeLabel}\n• Date: ${dateFormatted}\n• Time: ${appointment_time}\n• Notes: ${notes || "None"}\n\n---\nSubmitted: ${submittedAt}`,
      listId: CLICKUP_LIST_ID,
    });
  } catch (err) {
    console.error("Failed to create ClickUp appointment task:", err);
  }

  // 5. Supabase
  try {
    await insertSupabaseRecord(env, { type: "appointment", name, email, phone, enquiry_type: appointment_type });
  } catch (err) {
    console.error("Supabase appointment insert failed:", err);
  }

  // 6. GHL
  try {
    await createGHLContact(env, { name, email, phone, type: "appointment" });
  } catch (err) {
    console.error("GHL contact create failed:", err);
  }

  return json({ ok: true }, 200, corsHeaders);
}

async function createGoogleCalendarEvent(env, { name, email, phone, appointment_type, appointment_date, appointment_time, notes, typeLabel }) {
  const hasOAuth = env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.GOOGLE_REFRESH_TOKEN;
  const hasServiceAccount = env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if ((!hasOAuth && !hasServiceAccount) || !env.GOOGLE_CALENDAR_ID) return null;

  const token = hasOAuth
    ? await getOAuthAccessToken(env)
    : await getServiceAccountAccessToken(JSON.parse(env.GOOGLE_SERVICE_ACCOUNT_KEY));

  const startDateTime = `${appointment_date}T${appointment_time}:00`;
  const endHour = parseInt(appointment_time.split(":")[0]);
  const endMin = parseInt(appointment_time.split(":")[1]) + 30;
  const endTime = `${String(endHour + Math.floor(endMin / 60)).padStart(2, "0")}:${String(endMin % 60).padStart(2, "0")}`;
  const endDateTime = `${appointment_date}T${endTime}:00`;

  const event = {
    summary: `${typeLabel} — ${name}`,
    description: `Customer: ${name}\nEmail: ${email}\nPhone: ${phone || "Not provided"}\nType: ${typeLabel}\n${notes ? "\nNotes: " + notes : ""}`,
    start: { dateTime: startDateTime, timeZone: "Europe/London" },
    end: { dateTime: endDateTime, timeZone: "Europe/London" },
    attendees: [{ email }],
    reminders: { useDefault: false, overrides: [{ method: "email", minutes: 60 }, { method: "popup", minutes: 30 }] },
  };

  const calendarId = encodeURIComponent(env.GOOGLE_CALENDAR_ID);
  const res = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events?sendUpdates=all`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(event),
  });

  if (!res.ok) throw new Error(`Google Calendar API error ${res.status}: ${await res.text()}`);
  const created = await res.json();
  return created.htmlLink || null;
}

// ── OAuth 2.0 refresh token flow (preferred) ────────────────────────────────
async function getOAuthAccessToken(env) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      refresh_token: env.GOOGLE_REFRESH_TOKEN,
    }),
  });
  const data = await res.json();
  if (!data.access_token) throw new Error("OAuth token refresh failed: " + JSON.stringify(data));
  return data.access_token;
}

// ── Service account fallback ─────────────────────────────────────────────────
async function getServiceAccountAccessToken(serviceAccount) {
  const header = btoa(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const now = Math.floor(Date.now() / 1000);
  const claimSet = btoa(JSON.stringify({
    iss: serviceAccount.client_email,
    scope: "https://www.googleapis.com/auth/calendar.events",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  }));
  const signatureInput = `${header}.${claimSet}`;
  const key = await importPKCS8Key(serviceAccount.private_key);
  const sig = await crypto.subtle.sign({ name: "RSASSA-PKCS1-v1_5" }, key, new TextEncoder().encode(signatureInput));
  const jwt = `${signatureInput}.${arrayBufferToBase64Url(sig)}`;

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });
  const tokenData = await tokenRes.json();
  if (!tokenData.access_token) throw new Error("Service account token failed: " + JSON.stringify(tokenData));
  return tokenData.access_token;
}

async function importPKCS8Key(pem) {
  const pemContents = pem.replace(/-----BEGIN PRIVATE KEY-----/g, "").replace(/-----END PRIVATE KEY-----/g, "").replace(/\s/g, "");
  const binaryDer = Uint8Array.from(atob(pemContents), c => c.charCodeAt(0));
  return crypto.subtle.importKey("pkcs8", binaryDer, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
}

function arrayBufferToBase64Url(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  bytes.forEach(b => binary += String.fromCharCode(b));
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}


// ═══════════════════════════════════════════════════════════════════
//  EMAIL TEMPLATES
// ═══════════════════════════════════════════════════════════════════

/**
 * Business notification — three clearly labelled sections:
 *   A. Memorial Configuration  B. Customer  C. Customer Notes
 */
function quoteBusinessEmail({ name, email, phone, message, location, product, stoneHex, submittedAt }) {
  const addonItems = Array.isArray(product.addonLineItems) && product.addonLineItems.length > 0
    ? product.addonLineItems
    : Array.isArray(product.addons) && product.addons.length > 0
      ? product.addons.map(n => ({ name: n, price: null }))
      : [];
  const inscription = product.inscription ? product.inscription.trim() : "";
  const totalPrice = parseFloat(product.price) || 0;
  const permitFee = parseFloat(product.permit_fee) || 0;
  const addonTotal = addonItems.reduce((s, a) => s + (parseFloat(a.price) || 0), 0);
  const basePrice = Math.max(0, totalPrice - addonTotal);
  const grandTotal = totalPrice + permitFee;

  const rawImage = product.image && product.image.trim() ? product.image.trim() : "";
  const imageUrl = rawImage.startsWith('http') || rawImage.startsWith('data:') ? rawImage : rawImage ? `https://searsmelvin.co.uk${rawImage.startsWith('/') ? '' : '/'}${rawImage}` : "";

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#F5F3F0;font-family:Arial,Helvetica,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#F5F3F0;padding:24px 0;">
  <tr><td align="center">
  <table role="presentation" width="620" cellpadding="0" cellspacing="0" border="0" style="max-width:620px;width:100%;background:#fff;border-radius:10px;overflow:hidden;">

    <tr><td style="background:#2C2C2C;padding:18px 28px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
        <td style="font-family:Georgia,serif;font-size:18px;color:#fff;">Sears Melvin <span style="opacity:0.55;font-weight:300;">Memorials</span></td>
        <td align="right"><span style="background:#8B7355;color:#fff;padding:5px 12px;border-radius:3px;font-size:11px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;">New Quote</span></td>
      </tr></table>
    </td></tr>

    <tr><td style="padding:26px 28px 4px;">
      <h2 style="font-family:Georgia,serif;font-size:22px;color:#2C2C2C;font-weight:normal;margin:0 0 4px;">New Quote Request</h2>
      <p style="color:#AAA;font-size:12px;margin:0;">Received ${esc(submittedAt)}</p>
    </td></tr>

    <tr><td style="padding:20px 28px 0;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #E0DCD5;border-radius:8px;border-collapse:separate;">
        <tr>
          <td width="6" style="background:${stoneHex};border-radius:8px 0 0 8px;">&nbsp;</td>
          <td style="padding:18px 20px;">
            <p style="font-size:10px;letter-spacing:0.1em;text-transform:uppercase;color:#8B7355;font-weight:700;margin:0 0 6px;">Memorial Configuration</p>
            <p style="font-family:Georgia,serif;font-size:20px;color:#2C2C2C;margin:0 0 14px;">${esc(product.name || "—")}</p>

            ${imageUrl ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:16px;">
              <tr><td align="center" style="background:#F5F3F0;border:1px solid #E0DCD5;border-radius:6px;padding:12px;">
                <img src="${imageUrl}" alt="${esc(product.name || "Memorial")}" width="360" style="display:block;width:100%;max-width:360px;height:auto;" />
              </td></tr>
            </table>` : ""}

            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="font-size:13px;margin-bottom:0;">
              <tr><td width="130" style="color:#999;padding:4px 0;">Type</td><td style="color:#1A1A1A;padding:4px 0;">${esc(product.type || "—")}</td></tr>
              <tr><td style="color:#999;padding:4px 0;">Stone colour</td><td style="color:#1A1A1A;padding:4px 0;">
                <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${stoneHex};vertical-align:middle;margin-right:5px;border:1px solid rgba(0,0,0,0.15);"></span>${esc(product.colour || "—")}
              </td></tr>
              ${product.size ? `<tr><td style="color:#999;padding:4px 0;">Size</td><td style="color:#1A1A1A;padding:4px 0;">${esc(product.size)}</td></tr>` : ""}
              ${product.font ? `<tr><td style="color:#999;padding:4px 0;">Font</td><td style="color:#1A1A1A;padding:4px 0;">${esc(product.font === 'script' ? 'Script' : 'Traditional')}</td></tr>` : ""}
              ${product.letterColour ? `<tr><td style="color:#999;padding:4px 0;">Lettering colour</td><td style="color:#1A1A1A;padding:4px 0;">${esc(product.letterColour.charAt(0).toUpperCase() + product.letterColour.slice(1))}</td></tr>` : ""}
            </table>

            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="font-size:13px;margin-top:14px;border-top:1px solid #E0DCD5;">
              <tr style="background:#F5F3F0;">
                <td style="padding:8px 10px;color:#999;font-size:11px;letter-spacing:0.05em;text-transform:uppercase;">Item</td>
                <td width="80" align="right" style="padding:8px 10px;color:#999;font-size:11px;letter-spacing:0.05em;text-transform:uppercase;">Price</td>
              </tr>
              <tr>
                <td style="padding:8px 10px;color:#1A1A1A;border-bottom:1px solid #F0EDE8;">${esc(product.name || "Memorial")} (inc. installation)</td>
                <td align="right" style="padding:8px 10px;color:#1A1A1A;border-bottom:1px solid #F0EDE8;white-space:nowrap;">£${basePrice.toLocaleString("en-GB",{maximumFractionDigits:0})}</td>
              </tr>
              ${addonItems.filter(a => parseFloat(a.price) > 0).map(function(item) {
                return `<tr>
                <td style="padding:8px 10px;color:#555;border-bottom:1px solid #F0EDE8;">${esc(item.name)}</td>
                <td align="right" style="padding:8px 10px;color:#555;border-bottom:1px solid #F0EDE8;white-space:nowrap;">+£${parseFloat(item.price).toLocaleString("en-GB",{maximumFractionDigits:0})}</td>
              </tr>`;
              }).join("")}
              ${addonItems.filter(a => !(parseFloat(a.price) > 0) && a.name).map(function(item) {
                return `<tr>
                <td style="padding:8px 10px;color:#555;border-bottom:1px solid #F0EDE8;">${esc(item.name)}</td>
                <td align="right" style="padding:8px 10px;color:#555;border-bottom:1px solid #F0EDE8;white-space:nowrap;">—</td>
              </tr>`;
              }).join("")}
              ${permitFee > 0 ? `<tr>
                <td style="padding:8px 10px;color:#555;border-bottom:1px solid #F0EDE8;">Cemetery Permit Fee</td>
                <td align="right" style="padding:8px 10px;color:#555;border-bottom:1px solid #F0EDE8;white-space:nowrap;">+£${permitFee.toLocaleString("en-GB",{maximumFractionDigits:0})}</td>
              </tr>` : ""}
              <tr style="background:#F5F3F0;">
                <td style="padding:9px 10px;color:#2C2C2C;font-weight:700;">Guide total (installed)</td>
                <td align="right" style="padding:9px 10px;color:#2C2C2C;font-weight:700;font-size:15px;white-space:nowrap;">£${grandTotal.toLocaleString("en-GB",{maximumFractionDigits:0})}</td>
              </tr>
            </table>
            ${permitFee <= 0 ? `<p style="font-size:11px;color:#999;margin:6px 0 0;">*Permit fee not yet determined — varies by cemetery</p>` : ""}

            ${inscription ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:12px;">
              <tr><td style="background:#FAF8F5;border-left:3px solid #D4AF37;padding:8px 12px;font-family:Georgia,serif;font-style:italic;color:#2C2C2C;font-size:13px;line-height:1.6;">${esc(inscription).replace(/\n/g,"<br>")}</td></tr>
            </table>` : ""}
          </td>
        </tr>
      </table>
    </td></tr>

    <tr><td style="padding:16px 28px 0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="border-top:1px solid #E0DCD5;font-size:0;line-height:0;">&nbsp;</td></tr></table></td></tr>

    <tr><td style="padding:16px 28px ${message ? "0" : "28px"};">
      <p style="font-size:10px;letter-spacing:0.08em;text-transform:uppercase;color:#8B7355;font-weight:700;margin:0 0 12px;">Customer</p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="font-size:13px;">
        <tr><td width="120" style="padding:5px 0;color:#999;">Name</td><td style="padding:5px 0;color:#1A1A1A;font-weight:600;">${esc(name)}</td></tr>
        <tr><td style="padding:5px 0;color:#999;">Email</td><td style="padding:5px 0;"><a href="mailto:${esc(email)}" style="color:#8B7355;">${esc(email)}</a></td></tr>
        <tr><td style="padding:5px 0;color:#999;">Phone</td><td style="padding:5px 0;color:#1A1A1A;">${esc(phone || "Not provided")}</td></tr>
        ${location ? `<tr><td style="padding:5px 0;color:#999;">Cemetery</td><td style="padding:5px 0;color:#1A1A1A;">${esc(location)}</td></tr>` : ""}
      </table>
    </td></tr>

    ${message ? `<tr><td style="padding:16px 28px 28px;">
      <p style="font-size:10px;letter-spacing:0.08em;text-transform:uppercase;color:#8B7355;font-weight:700;margin:0 0 10px;">Customer Notes</p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr><td style="background:#F5F3F0;border-radius:6px;padding:14px 16px;font-size:13px;color:#1A1A1A;line-height:1.7;">${esc(message).replace(/\n/g,"<br>")}</td></tr>
      </table>
    </td></tr>` : ""}

    <tr><td style="background:#F5F3F0;border-top:1px solid #E0DCD5;padding:14px 28px;text-align:center;">
      <span style="font-size:11px;color:#BBB;">Sears Melvin Memorials &middot; North London (NW11) &middot; <a href="mailto:${BUSINESS_EMAIL}" style="color:#BBB;">${BUSINESS_EMAIL}</a></span>
    </td></tr>

  </table>
  </td></tr>
</table>
</body></html>`;
}

/** Customer confirmation — warm and branded, with quote summary card and line items */
function quoteCustomerEmail({ firstName, product, stoneHex, editToken, email }) {
  const totalPrice = parseFloat(product.price) || 0;
  const permitFee = parseFloat(product.permit_fee) || 0;
  const addonItems = Array.isArray(product.addonLineItems) && product.addonLineItems.length > 0
    ? product.addonLineItems
    : Array.isArray(product.addons) && product.addons.length > 0
      ? product.addons.map(n => ({ name: n, price: null }))
      : [];
  const addonTotal = addonItems.reduce((s, a) => s + (parseFloat(a.price) || 0), 0);
  const basePrice = Math.max(0, totalPrice - addonTotal);
  const grandTotal = totalPrice + permitFee;

  const rawImage = product.image && product.image.trim() ? product.image.trim() : "";
  const imageUrl = rawImage.startsWith('http') ? rawImage : rawImage ? `https://searsmelvin.co.uk${rawImage.startsWith('/') ? '' : '/'}${rawImage}` : "";

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#F5F3F0;font-family:Arial,Helvetica,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#F5F3F0;padding:24px 0;">
  <tr><td align="center">
  <table role="presentation" width="580" cellpadding="0" cellspacing="0" border="0" style="max-width:580px;width:100%;background:#fff;border-radius:10px;overflow:hidden;">

    <tr><td style="background:#2C2C2C;padding:20px 28px;">
      <span style="font-family:Georgia,serif;font-size:18px;color:#fff;">Sears Melvin <span style="opacity:0.55;font-weight:300;">Memorials</span></span>
    </td></tr>

    <tr><td style="padding:30px 28px 0;">
      <h2 style="font-family:Georgia,serif;font-size:23px;color:#2C2C2C;font-weight:normal;margin:0 0 14px;">Thank you, ${esc(firstName)}.</h2>
      <p style="color:#555;font-size:15px;line-height:1.7;margin:0 0 22px;">
        We've received your quote request for the
        <strong style="color:#2C2C2C;">${esc(product.name || "memorial")}</strong>
        and our team will be in touch within 24 hours.
      </p>
    </td></tr>

    <tr><td style="padding:0 28px 24px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#FAF8F5;border:1px solid #E0DCD5;border-radius:8px;border-collapse:separate;">
        <tr>
          <td width="6" style="background:${stoneHex};border-radius:8px 0 0 8px;">&nbsp;</td>
          <td style="padding:16px 18px;">
            <p style="font-size:10px;letter-spacing:0.1em;text-transform:uppercase;color:#8B7355;font-weight:700;margin:0 0 6px;">Your Order Summary</p>
            <p style="font-family:Georgia,serif;font-size:18px;color:#2C2C2C;margin:0 0 14px;">${esc(product.name || "—")}</p>

            ${imageUrl ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:16px;">
              <tr><td align="center" style="background:#fff;border:1px solid #E0DCD5;border-radius:6px;padding:12px;">
                <img src="${imageUrl}" alt="${esc(product.name || "Memorial")}" width="360" style="display:block;width:100%;max-width:360px;height:auto;" />
              </td></tr>
            </table>` : ""}

            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="font-size:13px;margin-bottom:12px;">
              <tr><td width="110" style="color:#999;padding:3px 0;">Type</td><td style="color:#2C2C2C;">${esc(product.type || "—")}</td></tr>
              <tr><td style="color:#999;padding:3px 0;">Stone colour</td><td style="color:#2C2C2C;">
                <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${stoneHex};vertical-align:middle;margin-right:5px;border:1px solid rgba(0,0,0,0.15);"></span>${esc(product.colour || "—")}
              </td></tr>
              ${product.size ? `<tr><td style="color:#999;padding:3px 0;">Size</td><td style="color:#2C2C2C;">${esc(product.size)}</td></tr>` : ""}
              ${product.font ? `<tr><td style="color:#999;padding:3px 0;">Font</td><td style="color:#2C2C2C;">${esc(product.font === 'script' ? 'Script' : 'Traditional')}</td></tr>` : ""}
              ${product.letterColour ? `<tr><td style="color:#999;padding:3px 0;">Lettering colour</td><td style="color:#2C2C2C;">${esc(product.letterColour.charAt(0).toUpperCase() + product.letterColour.slice(1))}</td></tr>` : ""}
            </table>

            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="font-size:13px;border-top:1px solid #E0DCD5;">
              <tr>
                <td style="padding:8px 0;color:#555;border-bottom:1px solid #F0EDE8;">${esc(product.name || "Memorial")} (inc. installation)</td>
                <td align="right" style="padding:8px 0;color:#555;border-bottom:1px solid #F0EDE8;white-space:nowrap;">£${basePrice.toLocaleString("en-GB",{maximumFractionDigits:0})}</td>
              </tr>
              ${addonItems.filter(a => parseFloat(a.price) > 0).map(function(item) {
                return `<tr>
                <td style="padding:8px 0;color:#555;border-bottom:1px solid #F0EDE8;">${esc(item.name)}</td>
                <td align="right" style="padding:8px 0;color:#555;border-bottom:1px solid #F0EDE8;white-space:nowrap;">+£${parseFloat(item.price).toLocaleString("en-GB",{maximumFractionDigits:0})}</td>
              </tr>`;
              }).join("")}
              ${addonItems.filter(a => !(parseFloat(a.price) > 0) && a.name).map(function(item) {
                return `<tr>
                <td style="padding:8px 0;color:#555;border-bottom:1px solid #F0EDE8;">${esc(item.name)}</td>
                <td align="right" style="padding:8px 0;color:#555;border-bottom:1px solid #F0EDE8;white-space:nowrap;">—</td>
              </tr>`;
              }).join("")}
              ${permitFee > 0 ? `<tr>
                <td style="padding:8px 0;color:#555;border-bottom:1px solid #F0EDE8;">Cemetery Permit Fee</td>
                <td align="right" style="padding:8px 0;color:#555;border-bottom:1px solid #F0EDE8;white-space:nowrap;">+£${permitFee.toLocaleString("en-GB",{maximumFractionDigits:0})}</td>
              </tr>` : ""}
              <tr>
                <td style="padding:9px 0 3px;color:#2C2C2C;font-weight:700;">Guide total (installed)</td>
                <td align="right" style="padding:9px 0 3px;color:#2C2C2C;font-weight:700;font-size:15px;white-space:nowrap;">£${grandTotal.toLocaleString("en-GB",{maximumFractionDigits:0})}</td>
              </tr>
            </table>
            ${permitFee <= 0 ? `<p style="font-size:11px;color:#999;margin:6px 0 0;">*Permit fee not yet determined — varies by cemetery</p>` : ""}
          </td>
        </tr>
      </table>
    </td></tr>

    ${editToken ? `<tr><td style="padding:0 28px 20px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#F5F3F0;border-radius:8px;">
        <tr><td style="padding:14px 18px;">
          <p style="font-size:13px;color:#555;margin:0 0 8px;line-height:1.5;">Changed your mind about colour, size, or extras? You can update your quote at any time:</p>
          <a href="https://searsmelvin.co.uk/quote.html?token=${editToken}" style="color:#8B7355;font-size:13px;font-weight:600;text-decoration:none;">Edit Your Quote &rarr;</a>
        </td></tr>
      </table>
    </td></tr>` : ""}

    ${email ? `<tr><td style="padding:0 28px 16px;">
      <p style="font-size:12px;color:#999;margin:0;text-align:center;">
        <a href="https://searsmelvin.co.uk/quote.html?email=${encodeURIComponent(email)}" style="color:#8B7355;text-decoration:none;">View all your quotes</a>
      </p>
    </td></tr>` : ""}

    <tr><td style="padding:0 28px 32px;">
      <p style="color:#555;font-size:14px;line-height:1.7;margin:0 0 10px;">
        If you have any urgent questions, please call us on <strong style="color:#2C2C2C;">+44 20 3835 2548</strong>.
      </p>
      <p style="color:#888;font-size:13px;margin:0;line-height:1.7;">
        With care,<br><strong style="color:#2C2C2C;">The Sears Melvin Team</strong>
      </p>
    </td></tr>

    <tr><td style="background:#1A1A1A;padding:16px 28px;text-align:center;border-radius:0 0 10px 10px;">
      <span style="font-size:11px;color:rgba(255,255,255,0.35);">Sears Melvin Memorials &middot; North London (NW11) &middot; ${BUSINESS_EMAIL}</span>
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
 * Creates Supabase records for a new quote/enquiry:
 *   orders   — order details (sku, color, value, order_type, customer contact, inscription_text)
 *   invoices — invoice with full order value (only for quotes with pricing)
 */
function generateToken() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let token = '';
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  for (const b of bytes) token += chars[b % chars.length];
  return token;
}

async function insertSupabaseRecord(env, { type, name, email, phone, enquiry_type, location, product, message, preEditToken }) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) return;

  const headers = {
    "apikey":        env.SUPABASE_SERVICE_KEY,
    "Authorization": `Bearer ${env.SUPABASE_SERVICE_KEY}`,
    "Content-Type":  "application/json",
    "Prefer":        "return=minimal",
  };

  const today = new Date().toISOString().split("T")[0];
  const dueDate = new Date(Date.now() + 30 * 86400000).toISOString().split("T")[0];
  const editToken = preEditToken || (type === "quote" ? generateToken() : null);

  // orders table — return=representation so we get the new row's id
  const orderRes = await fetch(`${env.SUPABASE_URL}/rest/v1/orders`, {
    method: "POST",
    headers: { ...headers, "Prefer": "return=representation" },
    body: JSON.stringify({
      customer_name:  name,
      customer_email: email,
      customer_phone: phone || null,
      order_type:     type === "quote" ? "quote" : (enquiry_type || null),
      sku:            product?.name   || null,
      color:          product?.colour || null,
      value:          product?.price  ? parseFloat(product.price) : null,
      permit_fee:     product?.permit_fee ? parseFloat(product.permit_fee) : null,
      location:       location || null,
      ...(editToken ? { edit_token: editToken } : {}),
      ...(type === "quote" && product ? { product_config: JSON.stringify(product) } : {}),
      ...(message ? { notes: message } : {}),
    }),
  });
  if (!orderRes.ok) throw new Error(`Supabase orders error ${orderRes.status}: ${await orderRes.text()}`);
  const orderRows = await orderRes.json();
  const orderId   = orderRows[0]?.id || null;

  // invoices table — created at quote time with the FULL order value so that
  //    outstanding balance = invoice.amount − SUM(payments.amount) at any point.
  let invoiceId = null;
  if (type === "quote" && product?.price) {
    const fullAmount = parseFloat(product.price) + parseFloat(product.permit_fee || 0);
    const invRes = await fetch(`${env.SUPABASE_URL}/rest/v1/invoices`, {
      method: "POST",
      headers: { ...headers, "Prefer": "return=representation" },
      body: JSON.stringify({
        order_id:      orderId,
        customer_name: name,
        amount:        fullAmount,
        status:        "pending",
        issue_date:    today,
        due_date:      dueDate,
      }),
    });
    if (!invRes.ok) {
      console.error(`Supabase invoices insert error ${invRes.status}: ${await invRes.text()}`);
    } else {
      const invRows = await invRes.json();
      invoiceId = invRows[0]?.id || null;
    }
  }

  // Set inscription_text on the order itself (used by tracking system)
  if (product?.inscription && orderId) {
    await fetch(`${env.SUPABASE_URL}/rest/v1/orders?id=eq.${orderId}`, {
      method: "PATCH",
      headers: { ...headers, "Prefer": "return=minimal" },
      body: JSON.stringify({ inscription_text: product.inscription }),
    });
  }

  return { invoiceId: invoiceId || null, editToken };
}


// ═══════════════════════════════════════════════════════════════════
//  GOHIGHLEVEL INTEGRATION
// ═══════════════════════════════════════════════════════════════════
async function createGHLContact(env, { name, email, phone, type, cemetery }) {
  if (!env.GHL_API_KEY || !env.GHL_LOCATION_ID) return null;

  const parts     = name.trim().split(" ");
  const firstName = parts[0];
  const lastName  = parts.slice(1).join(" ") || "";

  const tags = ["website-lead", type === "quote" ? "quote-request" : type];
  const customFields = cemetery ? [{ key: "cemetery", field_value: cemetery }] : [];

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
  const body = await res.json();
  return body.contact?.id || null;
}

async function createGHLOpportunity(env, { contactId, name, monetaryValue, message, productChoice, colour }) {
  if (!env.GHL_API_KEY || !env.GHL_PIPELINE_ID || !env.GHL_PIPELINE_STAGE_ID || !contactId) return;
  const customFields = [
    message       ? { key: "message",        field_value: message } : null,
    productChoice ? { key: "product_choice",  field_value: productChoice } : null,
    colour        ? { key: "colour",          field_value: colour } : null,
  ].filter(Boolean);
  const res = await fetch("https://services.leadconnectorhq.com/opportunities/", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${env.GHL_API_KEY}`,
      "Version":       "2021-07-28",
      "Content-Type":  "application/json",
    },
    body: JSON.stringify({
      pipelineId: env.GHL_PIPELINE_ID,
      pipelineStageId: env.GHL_PIPELINE_STAGE_ID,
      locationId: env.GHL_LOCATION_ID,
      contactId, name,
      monetaryValue: monetaryValue || 0,
      source: "Website",
      status: "open",
      customFields,
    }),
  });
  if (!res.ok) throw new Error(`GHL Opportunity error ${res.status}: ${await res.text()}`);
}

// ═══════════════════════════════════════════════════════════════════
// STRIPE DEPOSIT INVOICE — creates a 50% deposit invoice (or full if invoice_only)
// ═══════════════════════════════════════════════════════════════════
async function createStripeDepositInvoice(stripeKey, { name, email, phone, product, location, isFullInvoice }) {
  const stripePost = (path, params) => fetch(`https://api.stripe.com/v1${path}`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${stripeKey}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params),
  }).then(async r => {
    const json = await r.json();
    if (json.error) throw new Error(`Stripe ${path}: ${json.error.message}`);
    return json;
  });

  const stripeGet = (path) => fetch(`https://api.stripe.com/v1${path}`, {
    headers: { "Authorization": `Bearer ${stripeKey}` },
  }).then(r => r.json());

  // Find or create Stripe customer
  const existingRes = await stripeGet(`/customers?email=${encodeURIComponent(email)}&limit=1`);
  let customerId;
  if (existingRes.data && existingRes.data.length > 0) {
    customerId = existingRes.data[0].id;
    await stripePost(`/customers/${customerId}`, { name: name || "", ...(phone ? { phone } : {}) });
  } else {
    const customer = await stripePost("/customers", {
      email, name: name || "", ...(phone ? { phone } : {}),
      ...(location ? { "metadata[cemetery]": location } : {}),
    });
    customerId = customer.id;
  }

  const totalPricePence = Math.round(parseFloat(product.price || 0) * 100);
  const permitFeePence = Math.round(parseFloat(product.permit_fee || 0) * 100);
  const addonItems = Array.isArray(product.addonLineItems) && product.addonLineItems.length > 0
    ? product.addonLineItems : [];
  const addonTotalPence = addonItems.reduce((sum, a) => sum + Math.round(parseFloat(a.price || 0) * 100), 0);
  const basePricePence = Math.max(0, totalPricePence - addonTotalPence);
  const productDescription = [product.name || "Memorial", product.colour ? `· ${product.colour}` : "", product.size ? `· ${product.size}` : ""].filter(Boolean).join(" ");

  // For deposit invoices, charge 50%. For full invoices, charge 100%.
  const multiplier = isFullInvoice ? 1 : 0.5;
  const label = isFullInvoice ? "" : " — 50% deposit";

  // Helper: find existing Stripe Product by metadata key, or create a new one
  async function findOrCreateStripeProduct(itemName, itemType) {
    const searchRes = await stripeGet(
      `/products/search?query=metadata['sm_name']:'${encodeURIComponent(itemName)}' AND metadata['sm_type']:'${encodeURIComponent(itemType)}'&limit=1`
    );
    if (searchRes.data && searchRes.data.length > 0) return searchRes.data[0];
    return stripePost("/products", {
      name: itemName,
      "metadata[sm_name]": itemName,
      "metadata[sm_type]": itemType,
      "metadata[source]": "searsmelvin",
    });
  }

  const invoiceDescription = isFullInvoice
    ? `Sears Melvin Memorials — ${productDescription}`
    : `Sears Melvin Memorials — 50% Deposit — ${productDescription}`;
  const invoiceFooter = isFullInvoice
    ? "Thank you for choosing Sears Melvin Memorials. All prices include installation. Balance due within 30 days."
    : "Thank you for choosing Sears Melvin Memorials. This invoice is for a 50% deposit. The remaining balance is due on completion. Your installation timeline begins once the deposit is confirmed.";

  // Create invoice FIRST as a draft, then attach line items explicitly
  const invoice = await stripePost("/invoices", {
    customer: customerId, collection_method: "send_invoice", days_until_due: "30", auto_advance: "false",
    description: invoiceDescription,
    footer: invoiceFooter,
    "metadata[customer_name]": name || "", "metadata[product]": product.name || "",
    "metadata[cemetery]": location || "", "metadata[invoice_type]": isFullInvoice ? "full" : "deposit",
  });

  // Create Stripe Product + one-time Price for the base memorial
  const memorialProduct = await findOrCreateStripeProduct(product.name || "Memorial", "memorial");
  const basePrice = await stripePost("/prices", {
    product: memorialProduct.id,
    unit_amount: String(Math.round(basePricePence * multiplier)),
    currency: "gbp",
  });
  await stripePost("/invoiceitems", {
    customer: customerId,
    invoice: invoice.id,
    price: basePrice.id,
    description: productDescription + " (inc. installation)" + label,
  });

  // Create permit fee line item (if applicable)
  if (permitFeePence > 0) {
    const permitProduct = await findOrCreateStripeProduct("Cemetery Permit Fee", "permit");
    const permitPrice = await stripePost("/prices", {
      product: permitProduct.id,
      unit_amount: String(Math.round(permitFeePence * multiplier)),
      currency: "gbp",
    });
    await stripePost("/invoiceitems", {
      customer: customerId,
      invoice: invoice.id,
      price: permitPrice.id,
      description: "Cemetery Permit Fee" + label,
    });
  }

  // Create Stripe Products + Prices for each addon line item
  for (const addon of addonItems) {
    const addonPence = Math.round(parseFloat(addon.price || 0) * 100);
    if (addonPence > 0) {
      const addonProduct = await findOrCreateStripeProduct(addon.name || "Add-on", "addon");
      const addonPrice = await stripePost("/prices", {
        product: addonProduct.id,
        unit_amount: String(Math.round(addonPence * multiplier)),
        currency: "gbp",
      });
      await stripePost("/invoiceitems", {
        customer: customerId,
        invoice: invoice.id,
        price: addonPrice.id,
        description: (addon.name || "Add-on") + label,
      });
    }
  }

  // Fallback: add addon names as zero-value items if no priced line items
  if (addonItems.length === 0 && Array.isArray(product.addons) && product.addons.length > 0) {
    for (const addonName of product.addons) {
      const addonProduct = await findOrCreateStripeProduct(addonName, "addon");
      const zeroPrice = await stripePost("/prices", {
        product: addonProduct.id,
        unit_amount: "0",
        currency: "gbp",
      });
      await stripePost("/invoiceitems", { customer: customerId, invoice: invoice.id, price: zeroPrice.id, description: addonName });
    }
  }

  const finalised = await stripePost(`/invoices/${invoice.id}/finalize`, { auto_advance: "false" });
  return finalised.hosted_invoice_url || null;
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
<tr><td style="background:#F5F3F0;border-top:1px solid #E0DCD5;padding:14px 28px;text-align:center;"><span style="font-size:11px;color:#BBB;">Sears Melvin Memorials &middot; North London (NW11) &middot; ${BUSINESS_EMAIL}</span></td></tr>
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
<tr><td style="background:#F5F3F0;border-top:1px solid #E0DCD5;padding:12px 28px;text-align:center;"><span style="font-size:11px;color:#BBB;">Sears Melvin Memorials &middot; North London (NW11) &middot; ${BUSINESS_EMAIL}</span></td></tr>
</table></td></tr></table></body></html>`;
}

// ─── Helper: return JSON response ────────────────────────────────────────────
function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...extraHeaders },
  });
}
