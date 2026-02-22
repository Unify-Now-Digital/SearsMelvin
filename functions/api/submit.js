/**
 * Sears Melvin Memorials — Cloudflare Pages Function
 * Route: /api/submit  (POST)
 *
 * Handles two submission types:
 *   • Regular enquiry  (data.type !== 'quote')
 *   • Quote request    (data.type === 'quote')
 *
 * For each it:
 *   1. Sends a branded notification email to info@searsmelvin.co.uk
 *   2. Sends a confirmation email to the customer
 *   3. Creates a structured task in ClickUp
 *   4. Inserts a record into Supabase (leads table)
 *   5. Creates a contact in GoHighLevel
 *
 * Environment variables — set in Cloudflare Pages → Settings → Variables:
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

// ─── CORS ─────────────────────────────────────────────────────────────────────
const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

// ─── PREFLIGHT ────────────────────────────────────────────────────────────────
export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

// ─── POST ─────────────────────────────────────────────────────────────────────
export async function onRequestPost(context) {
  const { request, env } = context;

  if (!env.RESEND_API_KEY) {
    console.error("RESEND_API_KEY is not set");
    return jsonResponse({ ok: false, error: "Server configuration error" }, 500);
  }

  let data;
  try {
    data = await request.json();
  } catch {
    return jsonResponse({ ok: false, error: "Invalid JSON" }, 400);
  }

  if (!data.name || !data.email) {
    return jsonResponse({ ok: false, error: "Missing required fields" }, 400);
  }

  const submittedAt = new Date().toLocaleString("en-GB", {
    timeZone: "Europe/London",
    dateStyle: "medium",
    timeStyle: "short",
  });

  if (data.type === "quote") {
    return handleQuoteRequest(env, data, submittedAt);
  }
  return handleEnquiry(env, data, submittedAt);
}


// ═══════════════════════════════════════════════════════════════════
//  QUOTE REQUEST HANDLER
// ═══════════════════════════════════════════════════════════════════
async function handleQuoteRequest(env, data, submittedAt) {
  const { name, email, phone, message, product = {}, location, payment_preference } = data;
  const invoiceOnly = payment_preference === 'invoice_only';
  const firstName = name.split(" ")[0];
  const stoneHex  = STONE_COLOURS[product.colour] || "#8B7355";

  // 0. Stripe Invoice — generate FIRST so URL is available for the customer email
  let stripeInvoiceUrl = null;
  if (invoiceOnly && env.STRIPE_SECRET_KEY) {
    try {
      stripeInvoiceUrl = await createStripeInvoice(env.STRIPE_SECRET_KEY, {
        name, email, phone, product, location,
      });
    } catch (err) {
      console.error("Stripe invoice creation failed:", err);
    }
  }

  // 1. Business notification email (critical)
  try {
    await sendEmail(env.RESEND_API_KEY, {
      from:    `${BUSINESS_NAME} <${FROM_EMAIL}>`,
      to:      BUSINESS_EMAIL,
      subject: `${invoiceOnly ? "Invoice Request" : "New Quote Request"} — ${product.name || "Memorial"} — ${name}`,
      html:    quoteBusinessEmail({ name, email, phone, message, location, product, stoneHex, submittedAt, invoiceOnly, stripeInvoiceUrl }),
    });
  } catch (err) {
    console.error("Failed to send quote business email:", err);
    return jsonResponse({ ok: false, error: "Failed to send notification email" }, 500);
  }

  // 2. Customer confirmation email (non-critical)
  try {
    await sendEmail(env.RESEND_API_KEY, {
      from:    `${BUSINESS_NAME} <${FROM_EMAIL}>`,
      to:      email,
      subject: `Your ${invoiceOnly ? "invoice request" : "quote request"} — ${product.name || "Memorial"} — ${BUSINESS_NAME}`,
      html:    quoteCustomerEmail({ firstName, product, stoneHex, invoiceOnly, stripeInvoiceUrl }),
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

  // 4. Supabase record (non-critical) — returns { invoiceId } for quotes
  let invoiceId = null;
  try {
    const sbResult = await insertSupabaseRecord(env, { type: "quote", name, email, phone, product, location });
    invoiceId = sbResult?.invoiceId || null;
  } catch (err) {
    console.error("Supabase insert failed:", err);
  }

  // 5. GoHighLevel contact (non-critical)
  try {
    await createGHLContact(env, { name, email, phone, type: "quote", product });
  } catch (err) {
    console.error("GHL contact create failed:", err);
  }

  return jsonResponse({ ok: true, invoiceId, invoiceOnly, stripeInvoiceUrl });
}


// ═══════════════════════════════════════════════════════════════════
//  REGULAR ENQUIRY HANDLER
// ═══════════════════════════════════════════════════════════════════
async function handleEnquiry(env, data, submittedAt) {
  const { name, email, phone, message, enquiry_type, location } = data;

  if (!message) {
    return jsonResponse({ ok: false, error: "Missing required fields" }, 400);
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
    <tr><td style="padding:26px 28px 0;">
      <h2 style="font-family:Georgia,serif;font-size:22px;color:#2C2C2C;font-weight:normal;margin:0 0 4px;">New Website Enquiry</h2>
      <p style="color:#AAA;font-size:12px;margin:0;">Received ${esc(submittedAt)}</p>
    </td></tr>
    <tr><td style="padding:20px 28px 0;"><hr style="border:none;border-top:1px solid #E0DCD5;margin:0;"></td></tr>
    <tr><td style="padding:20px 28px 28px;">
      <div style="font-size:10px;letter-spacing:0.08em;text-transform:uppercase;color:#8B7355;font-weight:700;margin-bottom:12px;">Customer</div>
      <table width="100%" cellpadding="0" cellspacing="0" style="font-size:13px;">
        <tr><td style="padding:5px 0;color:#999;width:110px;">Name</td><td style="padding:5px 0;color:#1A1A1A;font-weight:600;">${esc(name)}</td></tr>
        <tr><td style="padding:5px 0;color:#999;">Email</td><td style="padding:5px 0;"><a href="mailto:${esc(email)}" style="color:#8B7355;">${esc(email)}</a></td></tr>
        <tr><td style="padding:5px 0;color:#999;">Phone</td><td style="padding:5px 0;color:#1A1A1A;">${esc(phone || "Not provided")}</td></tr>
        ${enquiry_type ? `<tr><td style="padding:5px 0;color:#999;">Enquiry type</td><td style="padding:5px 0;color:#1A1A1A;">${esc(enquiry_type.replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase()))}</td></tr>` : ""}
      </table>
    </td></tr>
    <tr><td style="padding:0 28px 28px;">
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
    return jsonResponse({ ok: false, error: "Failed to send notification email" }, 500);
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

  return jsonResponse({ ok: true });
}


// ═══════════════════════════════════════════════════════════════════
//  EMAIL TEMPLATES
// ═══════════════════════════════════════════════════════════════════

/**
 * Business notification — three clearly labelled sections:
 *   A. Memorial Configuration  B. Customer  C. Customer Notes
 */
function quoteBusinessEmail({ name, email, phone, message, location, product, stoneHex, submittedAt, invoiceOnly, stripeInvoiceUrl }) {
  // Addons: use addonLineItems (with prices) if sent, else fallback to names-only
  const addonItems = Array.isArray(product.addonLineItems) && product.addonLineItems.length > 0
    ? product.addonLineItems
    : Array.isArray(product.addons) && product.addons.length > 0
      ? product.addons.map(function(n){ return { name: n, price: null }; })
      : [];
  const inscription = product.inscription ? product.inscription.trim() : "";
  const priceFormatted = formatPrice(product.price);
  const imageUrl    = product.image && product.image.trim() ? product.image.trim() : "";

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
        <td align="right"><span style="background:#8B7355;color:#fff;padding:4px 11px;border-radius:3px;font-size:11px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;">${invoiceOnly ? "Invoice Request" : "New Quote"}</span></td>
      </tr></table>
    </td></tr>

    <!-- ── Title ── -->
    <tr><td style="padding:26px 28px 4px;">
      <h2 style="font-family:Georgia,serif;font-size:22px;color:#2C2C2C;font-weight:normal;margin:0 0 4px;">${invoiceOnly ? "Invoice Request" : "New Quote Request"}</h2>
      <p style="color:#AAA;font-size:12px;margin:0;">Received ${esc(submittedAt)}</p>
    </td></tr>

    <!-- ══ SECTION A: Memorial Configuration ══ -->
    <tr><td style="padding:20px 28px 0;">
      <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #E0DCD5;border-radius:8px;overflow:hidden;">
        <tr>
          <!-- Stone colour swatch bar -->
          <td width="8" style="background:${stoneHex};">&nbsp;</td>
          <td style="padding:18px 20px;">
            <div style="font-size:10px;letter-spacing:0.1em;text-transform:uppercase;color:#8B7355;font-weight:700;margin-bottom:6px;">Memorial Configuration</div>
            <div style="font-family:Georgia,serif;font-size:20px;color:#2C2C2C;margin-bottom:${imageUrl ? "12px" : "14px"};">${esc(product.name || "—")}</div>
            ${imageUrl ? `<div style="margin-bottom:14px;"><img src="${imageUrl}" alt="${esc(product.name || "Memorial")}" width="260" style="display:block;width:260px;max-width:100%;height:auto;border-radius:6px;border:1px solid #E0DCD5;"></div>` : ""}
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
              ${addonItems.map(function(item){ return `<tr>
                <td style="color:#999;padding:4px 0;vertical-align:top;">${item === addonItems[0] ? "Optional extras" : ""}</td>
                <td style="color:#1A1A1A;padding:4px 0;">${esc(item.name)}${item.price ? " <span style=\"color:#8B7355;font-size:12px;\">(+£" + item.price.toLocaleString() + ")</span>" : ""}</td>
              </tr>`; }).join("")}
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
      ${invoiceOnly && stripeInvoiceUrl ? `<tr><td style="padding:5px 0;color:#999;vertical-align:top;">Stripe Invoice</td><td style="padding:5px 0;"><a href="${stripeInvoiceUrl}" style="color:#8B7355;font-weight:600;">View invoice ↗</a></td></tr>` : ""}
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
function quoteCustomerEmail({ firstName, product, stoneHex, invoiceOnly, stripeInvoiceUrl }) {
  const priceFormatted = formatPrice(product.price);
  // Addons: use addonLineItems (with prices) if sent, else fallback to names-only
  const addonItems = Array.isArray(product.addonLineItems) && product.addonLineItems.length > 0
    ? product.addonLineItems
    : Array.isArray(product.addons) && product.addons.length > 0
      ? product.addons.map(function(n){ return { name: n, price: null }; })
      : [];
  const imageUrl = product.image && product.image.trim() ? product.image.trim() : "";

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
        We've received your ${invoiceOnly ? "invoice request" : "quote request"} for the
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
            <div style="font-family:Georgia,serif;font-size:18px;color:#2C2C2C;margin-bottom:${imageUrl ? "10px" : "12px"};">${esc(product.name || "—")}</div>
            ${imageUrl ? `<div style="margin-bottom:12px;"><img src="${imageUrl}" alt="${esc(product.name || "Memorial")}" width="220" style="display:block;width:220px;max-width:100%;height:auto;border-radius:5px;border:1px solid #E0DCD5;"></div>` : ""}
            <table cellpadding="0" cellspacing="4" style="font-size:13px;">
              <tr><td style="color:#999;width:100px;padding:3px 0;">Type</td><td style="color:#2C2C2C;">${esc(product.type || "—")}</td></tr>
              <tr>
                <td style="color:#999;padding:3px 0;">Stone colour</td>
                <td style="color:#2C2C2C;">
                  <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${stoneHex};vertical-align:middle;margin-right:5px;border:1px solid rgba(0,0,0,0.15);"></span>${esc(product.colour || "—")}
                </td>
              </tr>
              ${product.size ? `<tr><td style="color:#999;padding:3px 0;">Size</td><td style="color:#2C2C2C;">${esc(product.size)}</td></tr>` : ""}
              ${addonItems.map(function(item, idx){ return `<tr><td style="color:#999;padding:3px 0;width:100px;${idx===0?"":"opacity:0;"}">${idx===0?"Extras":""}</td><td style="color:#2C2C2C;">${esc(item.name)}${item.price ? " (+£" + item.price.toLocaleString() + ")" : ""}</td></tr>`; }).join("")}
              <tr><td style="color:#999;padding:6px 0 3px;border-top:1px solid #E0DCD5;">Guide total</td><td style="color:#2C2C2C;font-weight:700;padding:6px 0 3px;border-top:1px solid #E0DCD5;">£${esc(priceFormatted)} <span style="font-weight:400;color:#999;">fully installed</span></td></tr>
            </table>
          </td>
        </tr>
      </table>
    </td></tr>

    <tr><td style="padding:0 28px 32px;">
      ${invoiceOnly && stripeInvoiceUrl ? `
      <!-- Invoice CTA button -->
      <div style="margin:0 0 20px;">
        <a href="${stripeInvoiceUrl}"
           style="display:inline-block;background:#8B7355;color:#fff;text-decoration:none;
                  padding:13px 28px;border-radius:6px;font-size:14px;font-weight:600;
                  letter-spacing:0.03em;">
          View &amp; Pay Invoice →
        </a>
        <p style="color:#888;font-size:12px;margin:8px 0 0;">
          Your invoice is ready. Pay at any time before the due date — no rush.
        </p>
      </div>` : ""}
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
 * Writes to Supabase tables:
 *   customers    — contact info (first_name, last_name, email, phone)
 *   orders       — order details (sku, color, value, order_type, customer contact)
 *   invoices     — quote invoices with full order value and "pending" status (quotes only)
 *   inscriptions — inscription text (only if quote has inscription)
 *
 * Returns { invoiceId } for quotes so the deposit payment can be linked back to the
 * invoice and the outstanding balance (invoice.amount − Σ payments) can be derived.
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
  const today = new Date().toISOString().split("T")[0];

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

  // 2. orders table — return=representation so we get the new row's id
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
      location:       location || null,
    }),
  });
  if (!orderRes.ok) throw new Error(`Supabase orders error ${orderRes.status}: ${await orderRes.text()}`);
  const orderRows = await orderRes.json();
  const orderId   = orderRows[0]?.id || null;

  // 3. invoices table — created at quote time with the FULL order value so that
  //    outstanding balance = invoice.amount − SUM(payments.amount) at any point.
  //    status "pending" → deposit paid → "partial" → fully paid → "paid"
  let invoiceId = null;
  if (type === "quote" && product?.price) {
    const fullAmount = parseFloat(product.price);
    const invRes = await fetch(`${env.SUPABASE_URL}/rest/v1/invoices`, {
      method: "POST",
      headers: { ...headers, "Prefer": "return=representation" },
      body: JSON.stringify({
        order_id:      orderId,
        customer_name: name,
        amount:        fullAmount,
        status:        "pending",
        issue_date:    today,
        due_date:      today,
      }),
    });
    if (!invRes.ok) {
      console.error(`Supabase invoices insert error ${invRes.status}: ${await invRes.text()}`);
    } else {
      const invRows = await invRes.json();
      invoiceId = invRows[0]?.id || null;
    }
  }

  // 4. inscriptions table (only for quotes with inscription text)
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

  return invoiceId ? { invoiceId } : undefined;
}


// ═══════════════════════════════════════════════════════════════════
//  GOHIGHLEVEL INTEGRATION
// ═══════════════════════════════════════════════════════════════════
/**
 * Creates (or updates) a contact in GoHighLevel.
 *
 * Required setup in GHL:
 *   • Settings → Custom Fields → create fields with these keys:
 *       memorial_product, stone_colour, memorial_size, guide_price
 *   • Settings → Integrations → Private Integrations → create token (GHL_API_KEY)
 *   • GHL_LOCATION_ID from Settings → Business Profile
 *
 * Field mapping:
 *   firstName / lastName  ← split from name
 *   email, phone          ← direct
 *   source                ← "Website" (hardcoded)
 *   tags                  ← ["website-lead", "quote-request"|"enquiry", product type slug]
 *   customFields          ← memorial_product, stone_colour, memorial_size, guide_price
 */
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


// ═══════════════════════════════════════════════════════════════════
// STRIPE INVOICE HELPER
// ═══════════════════════════════════════════════════════════════════
/**
 * Creates and finalises a Stripe Invoice for a quote request.
 *
 * Line items:
 *   • Base memorial (product.price minus addon prices)
 *   • Each addon (from product.addonLineItems or product.addons)
 *   • Installation (if included in product price, shown as £0 line)
 *
 * The invoice is set to `send_invoice` with 30 days due and auto-finalised,
 * which causes Stripe to email the PDF invoice directly to the customer.
 *
 * Returns the hosted invoice URL so it can be included in the business email.
 */
async function createStripeInvoice(stripeKey, { name, email, phone, product, location }) {
  const stripePost = (path, params) => fetch(`https://api.stripe.com/v1${path}`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${stripeKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(params),
  }).then(async r => {
    const json = await r.json();
    if (json.error) throw new Error(`Stripe ${path}: ${json.error.message}`);
    return json;
  });

  // 1. Find or create a Stripe Customer
  const existingRes = await fetch(
    `https://api.stripe.com/v1/customers?email=${encodeURIComponent(email)}&limit=1`,
    { headers: { "Authorization": `Bearer ${stripeKey}` } }
  ).then(r => r.json());

  let customerId;
  if (existingRes.data && existingRes.data.length > 0) {
    customerId = existingRes.data[0].id;
    // Update name/phone if we have it
    await stripePost(`/customers/${customerId}`, {
      name: name || "",
      ...(phone ? { phone } : {}),
    });
  } else {
    const customer = await stripePost("/customers", {
      email,
      name: name || "",
      ...(phone ? { phone } : {}),
      ...(location ? { "metadata[cemetery]": location } : {}),
    });
    customerId = customer.id;
  }

  // 2. Calculate line item amounts (in pence)
  const totalPricePence = Math.round(parseFloat(product.price || 0) * 100);

  // Work out addon total so we can derive the base memorial price
  const addonItems = Array.isArray(product.addonLineItems) && product.addonLineItems.length > 0
    ? product.addonLineItems
    : [];
  const addonTotalPence = addonItems.reduce((sum, a) => sum + Math.round(parseFloat(a.price || 0) * 100), 0);

  // Base price = total - addons (ensure ≥ 0)
  const basePricePence = Math.max(0, totalPricePence - addonTotalPence);

  const productDescription = [
    product.name || "Memorial",
    product.colour ? `· ${product.colour}` : "",
    product.size ? `· ${product.size}` : "",
  ].filter(Boolean).join(" ");

  const invoiceMetadata = {
    "metadata[customer_name]": name || "",
    "metadata[product]": product.name || "",
    "metadata[cemetery]": location || "",
  };

  // 3. Create invoice items (attached to customer, pending = attached to next invoice)
  // Base memorial
  await stripePost("/invoiceitems", {
    customer: customerId,
    amount: String(basePricePence),
    currency: "gbp",
    description: productDescription + " (inc. installation)",
    ...invoiceMetadata,
  });

  // Each addon as a separate line item
  for (const addon of addonItems) {
    const addonPence = Math.round(parseFloat(addon.price || 0) * 100);
    if (addonPence > 0) {
      await stripePost("/invoiceitems", {
        customer: customerId,
        amount: String(addonPence),
        currency: "gbp",
        description: addon.name || "Add-on",
        ...invoiceMetadata,
      });
    }
  }

  // If no addonLineItems with prices, just use addons as zero-value descriptive lines
  if (addonItems.length === 0 && Array.isArray(product.addons) && product.addons.length > 0) {
    for (const addonName of product.addons) {
      await stripePost("/invoiceitems", {
        customer: customerId,
        amount: "0",
        currency: "gbp",
        description: addonName,
        ...invoiceMetadata,
      });
    }
  }

  // 4. Create the Invoice
  const invoice = await stripePost("/invoices", {
    customer: customerId,
    collection_method: "send_invoice",
    days_until_due: "30",
    auto_advance: "false",
    description: `Sears Melvin Memorials — ${productDescription}`,
    footer: "Thank you for choosing Sears Melvin Memorials. All prices include installation. Balance is due within 30 days.",
    "metadata[customer_name]": name || "",
    "metadata[product]": product.name || "",
    "metadata[cemetery]": location || "",
  });

  // 5. Finalise — this generates the PDF and the hosted_invoice_url.
  //    auto_advance: false so Stripe does NOT send its own email — we send our branded one via Resend.
  const finalised = await stripePost(`/invoices/${invoice.id}/finalize`, {
    auto_advance: "false",
  });

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
    const body = await res.text();
    console.error(`Resend error ${res.status} sending to ${to}: ${body}`);
    throw new Error(`Resend ${res.status}: ${body}`);
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

// ─── Helper: return JSON response ────────────────────────────────────────────
function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}
