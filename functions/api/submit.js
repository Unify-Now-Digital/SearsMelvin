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
 *   3. Creates a structured task in your ClickUp Orders list
 *
 * Environment variables — set in Cloudflare Pages dashboard → Settings → Variables:
 *   RESEND_API_KEY    → from resend.com
 *   CLICKUP_API_KEY   → from ClickUp → Settings → Apps → API Token
 */

const CLICKUP_LIST_ID = "901207633256"; // Your Orders list ID
const BUSINESS_EMAIL  = "info@searsmelvin.co.uk";
const FROM_EMAIL      = "info@searsmelvin.co.uk"; // Must be verified in Resend
const BUSINESS_NAME   = "Sears Melvin Memorials";

// Stone colour name → hex (for the coloured swatch sidebar in emails)
const STONE_COLOURS = {
  "Black Galaxy":    "#1a1a1a",
  "Rustenberg Grey": "#6b6b6b",
  "Vizag Blue":      "#2c3e50",
  "Indian Aurora":   "#8B5A2B",
  "Emerald Pearl":   "#2d4a3e",
  "Ruby Red":        "#722F37",
};

// ─── CORS headers (same-origin Pages requests don't need these, but
//     they're kept so the endpoint can be tested from anywhere) ────────────────
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

  // 0. Guard: ensure required env vars are present
  if (!env.RESEND_API_KEY) {
    console.error("RESEND_API_KEY is not set in environment variables");
    return jsonResponse({ ok: false, error: "Server configuration error" }, 500);
  }

  // 1. Parse body
  let data;
  try {
    data = await request.json();
  } catch {
    return jsonResponse({ ok: false, error: "Invalid JSON" }, 400);
  }

  // 2. Basic validation
  if (!data.name || !data.email) {
    return jsonResponse({ ok: false, error: "Missing required fields" }, 400);
  }

  const submittedAt = new Date().toLocaleString("en-GB", {
    timeZone: "Europe/London",
    dateStyle: "medium",
    timeStyle: "short",
  });

  // 3. Route by submission type
  if (data.type === "quote") {
    return handleQuoteRequest(env, data, submittedAt);
  }
  return handleEnquiry(env, data, submittedAt);
}


// ═══════════════════════════════════════════════════════════════════
//  QUOTE REQUEST HANDLER
// ═══════════════════════════════════════════════════════════════════
async function handleQuoteRequest(env, data, submittedAt) {
  const { name, email, phone, message, product = {} } = data;
  const firstName = name.split(" ")[0];
  const stoneHex  = STONE_COLOURS[product.colour] || "#8B7355";

  // Send branded quote notification to business (critical)
  try {
    await sendEmail(env.RESEND_API_KEY, {
      from:    `${BUSINESS_NAME} <${FROM_EMAIL}>`,
      to:      BUSINESS_EMAIL,
      subject: `New Quote Request — ${product.name || "Memorial"} — ${name}`,
      html:    quoteBusinessEmail({ name, email, phone, message, product, stoneHex, submittedAt }),
    });
  } catch (err) {
    console.error("Failed to send quote business email:", err);
    return jsonResponse({ ok: false, error: "Failed to send notification email" }, 500);
  }

  // Send quote confirmation to customer (non-critical)
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

  // Create structured task in ClickUp (non-critical)
  try {
    await createClickUpTask(env.CLICKUP_API_KEY, {
      name:        `Quote Request — ${product.name || "Memorial"} — ${name}`,
      description: buildQuoteClickUpDescription({ name, email, phone, message, product, submittedAt }),
      listId:      CLICKUP_LIST_ID,
    });
  } catch (err) {
    console.error("Failed to create ClickUp quote task:", err);
  }

  return jsonResponse({ ok: true });
}


// ═══════════════════════════════════════════════════════════════════
//  REGULAR ENQUIRY HANDLER
// ═══════════════════════════════════════════════════════════════════
async function handleEnquiry(env, data, submittedAt) {
  const { name, email, phone, message, enquiry_type } = data;

  if (!message) {
    return jsonResponse({ ok: false, error: "Missing required fields" }, 400);
  }

  // Send notification to business (critical)
  try {
    await sendEmail(env.RESEND_API_KEY, {
      from:    `${BUSINESS_NAME} <${FROM_EMAIL}>`,
      to:      BUSINESS_EMAIL,
      subject: `New Enquiry — ${name}`,
      html: `
        <div style="font-family:-apple-system,sans-serif;max-width:600px;color:#1a1a1a;background:#fff;border-radius:8px;overflow:hidden;border:1px solid #E0DCD5;">
          <div style="background:#2C2C2C;padding:18px 24px;">
            <span style="font-family:Georgia,serif;font-size:17px;color:#fff;">Sears Melvin <span style="opacity:0.6;font-weight:300;">Memorials</span></span>
          </div>
          <div style="padding:24px;">
            <h2 style="font-family:Georgia,serif;font-size:20px;color:#2C2C2C;font-weight:normal;margin:0 0 6px;">New Website Enquiry</h2>
            <p style="color:#999;font-size:12px;margin:0 0 20px;">Received ${esc(submittedAt)}</p>
            <table style="width:100%;border-collapse:collapse;font-size:14px;">
              <tr><td style="padding:6px 0;color:#888;width:110px;">Name</td><td style="padding:6px 0;"><strong>${esc(name)}</strong></td></tr>
              <tr><td style="padding:6px 0;color:#888;">Email</td><td style="padding:6px 0;"><a href="mailto:${esc(email)}" style="color:#8B7355;">${esc(email)}</a></td></tr>
              <tr><td style="padding:6px 0;color:#888;">Phone</td><td style="padding:6px 0;">${esc(phone || "Not provided")}</td></tr>
              ${enquiry_type ? `<tr><td style="padding:6px 0;color:#888;">Type</td><td style="padding:6px 0;">${esc(enquiry_type.replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase()))}</td></tr>` : ""}
              <tr><td style="padding:6px 0;color:#888;vertical-align:top;">Message</td><td style="padding:6px 0;line-height:1.6;">${esc(message).replace(/\n/g, "<br>")}</td></tr>
            </table>
          </div>
        </div>
      `,
    });
  } catch (err) {
    console.error("Failed to send business notification email:", err);
    return jsonResponse({ ok: false, error: "Failed to send notification email" }, 500);
  }

  // Send confirmation to customer (non-critical)
  try {
    await sendEmail(env.RESEND_API_KEY, {
      from:    `${BUSINESS_NAME} <${FROM_EMAIL}>`,
      to:      email,
      subject: `We've received your enquiry — ${BUSINESS_NAME}`,
      html: `
        <div style="font-family:-apple-system,sans-serif;max-width:580px;color:#1a1a1a;">
          <div style="background:#2C2C2C;padding:18px 24px;border-radius:8px 8px 0 0;">
            <span style="font-family:Georgia,serif;font-size:17px;color:#fff;">Sears Melvin <span style="opacity:0.6;font-weight:300;">Memorials</span></span>
          </div>
          <div style="background:#fff;padding:28px 24px;border:1px solid #E0DCD5;border-top:none;border-radius:0 0 8px 8px;">
            <h2 style="font-family:Georgia,serif;font-size:22px;color:#2C2C2C;font-weight:normal;margin:0 0 12px;">Thank you, ${esc(name.split(" ")[0])}.</h2>
            <p style="color:#555;line-height:1.7;margin:0 0 16px;">We've received your enquiry and one of our team will be in contact within 24 hours.</p>
            <p style="color:#555;line-height:1.7;margin:0 0 24px;">If you have any urgent questions, please call us on <strong>01268 208 559</strong>.</p>
            <p style="color:#888;font-size:13px;margin:0;">With care,<br><strong style="color:#2C2C2C;">The Sears Melvin Team</strong></p>
          </div>
          <p style="color:#bbb;font-size:11px;text-align:center;margin-top:12px;">Sears Melvin Memorials &middot; South London &amp; Beyond &middot; ${BUSINESS_EMAIL}</p>
        </div>
      `,
    });
  } catch (err) {
    console.error("Failed to send customer confirmation email:", err);
  }

  // Create task in ClickUp (non-critical)
  try {
    await createClickUpTask(env.CLICKUP_API_KEY, {
      name:        `New Enquiry — ${name}`,
      description: `=== WEBSITE ENQUIRY ===\n\nCUSTOMER\n• Name:         ${name}\n• Email:        ${email}\n• Phone:        ${phone || "Not provided"}\n• Enquiry type: ${enquiry_type || "Not specified"}\n\nMESSAGE\n${message}\n\n---\nSubmitted: ${submittedAt}`,
      listId:      CLICKUP_LIST_ID,
    });
  } catch (err) {
    console.error("Failed to create ClickUp task:", err);
  }

  return jsonResponse({ ok: true });
}


// ═══════════════════════════════════════════════════════════════════
//  EMAIL TEMPLATES
// ═══════════════════════════════════════════════════════════════════

/** Business notification — product card layout with coloured stone swatch */
function quoteBusinessEmail({ name, email, phone, message, product, stoneHex, submittedAt }) {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#F5F3F0;font-family:-apple-system,'DM Sans',sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#F5F3F0;padding:24px 0;">
  <tr><td align="center">
  <table width="620" cellpadding="0" cellspacing="0" style="max-width:620px;background:#fff;border-radius:10px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.08);">

    <tr>
      <td colspan="2" style="background:#2C2C2C;padding:18px 28px;">
        <table width="100%" cellpadding="0" cellspacing="0"><tr>
          <td><span style="font-family:Georgia,serif;font-size:18px;color:#fff;font-weight:normal;">Sears Melvin <span style="opacity:0.55;font-weight:300;">Memorials</span></span></td>
          <td align="right"><span style="background:#8B7355;color:#fff;padding:4px 11px;border-radius:3px;font-size:11px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;">New Quote</span></td>
        </tr></table>
      </td>
    </tr>

    <tr>
      <td colspan="2" style="padding:26px 28px 4px;">
        <h2 style="font-family:Georgia,serif;font-size:22px;color:#2C2C2C;font-weight:normal;margin:0 0 4px;">New Quote Request</h2>
        <p style="color:#AAA;font-size:12px;margin:0;">Received ${esc(submittedAt)}</p>
      </td>
    </tr>

    <tr>
      <td colspan="2" style="padding:20px 28px 0;">
        <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #E0DCD5;border-radius:8px;overflow:hidden;">
          <tr>
            <td width="8" style="background:${stoneHex};">&nbsp;</td>
            <td style="padding:16px 18px;">
              <div style="font-size:10px;letter-spacing:0.1em;text-transform:uppercase;color:#8B7355;font-weight:700;margin-bottom:4px;">${esc(product.type || "Memorial")}</div>
              <div style="font-family:Georgia,serif;font-size:20px;color:#2C2C2C;margin-bottom:10px;">${esc(product.name || "—")}</div>
              <table cellpadding="0" cellspacing="0"><tr>
                <td style="padding-right:18px;">
                  <span style="display:inline-block;width:11px;height:11px;border-radius:50%;background:${stoneHex};vertical-align:middle;margin-right:5px;border:1px solid rgba(0,0,0,0.15);"></span>
                  <span style="font-size:13px;color:#555;">${esc(product.colour || "—")}</span>
                </td>
                <td><span style="font-size:14px;color:#2C2C2C;font-weight:700;">From £${esc(product.price || "—")}</span></td>
              </tr></table>
            </td>
          </tr>
        </table>
      </td>
    </tr>

    <tr><td colspan="2" style="padding:20px 28px 0;"><hr style="border:none;border-top:1px solid #E0DCD5;margin:0;"></td></tr>

    <tr>
      <td colspan="2" style="padding:20px 28px 28px;">
        <div style="font-size:10px;letter-spacing:0.08em;text-transform:uppercase;color:#8B7355;font-weight:700;margin-bottom:12px;">Customer Details</div>
        <table width="100%" cellpadding="0" cellspacing="0" style="font-size:13px;">
          <tr><td style="padding:5px 0;color:#999;width:90px;">Name</td><td style="padding:5px 0;color:#1A1A1A;font-weight:600;">${esc(name)}</td></tr>
          <tr><td style="padding:5px 0;color:#999;">Email</td><td style="padding:5px 0;"><a href="mailto:${esc(email)}" style="color:#8B7355;">${esc(email)}</a></td></tr>
          <tr><td style="padding:5px 0;color:#999;">Phone</td><td style="padding:5px 0;color:#1A1A1A;">${esc(phone || "Not provided")}</td></tr>
          ${message ? `<tr><td style="padding:5px 0;color:#999;vertical-align:top;">Message</td><td style="padding:5px 0;color:#1A1A1A;line-height:1.6;">${esc(message).replace(/\n/g, "<br>")}</td></tr>` : ""}
        </table>
      </td>
    </tr>

    <tr>
      <td colspan="2" style="background:#F5F3F0;border-top:1px solid #E0DCD5;padding:14px 28px;text-align:center;">
        <span style="font-size:11px;color:#BBB;">Sears Melvin Memorials &middot; South London &amp; Beyond &middot; <a href="mailto:${BUSINESS_EMAIL}" style="color:#BBB;">${BUSINESS_EMAIL}</a></span>
      </td>
    </tr>

  </table>
  </td></tr>
</table>
</body></html>`;
}

/** Customer confirmation email — warm, branded, with quote summary card */
function quoteCustomerEmail({ firstName, product, stoneHex }) {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#F5F3F0;font-family:-apple-system,'DM Sans',sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#F5F3F0;padding:24px 0;">
  <tr><td align="center">
  <table width="580" cellpadding="0" cellspacing="0" style="max-width:580px;background:#fff;border-radius:10px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.08);">

    <tr>
      <td style="background:#2C2C2C;padding:20px 28px;border-radius:10px 10px 0 0;">
        <span style="font-family:Georgia,serif;font-size:18px;color:#fff;font-weight:normal;">Sears Melvin <span style="opacity:0.55;font-weight:300;">Memorials</span></span>
      </td>
    </tr>

    <tr>
      <td style="padding:30px 28px 0;">
        <h2 style="font-family:Georgia,serif;font-size:23px;color:#2C2C2C;font-weight:normal;margin:0 0 14px;">Thank you, ${esc(firstName)}.</h2>
        <p style="color:#555;font-size:15px;line-height:1.7;margin:0 0 22px;">
          We've received your quote request for the
          <strong style="color:#2C2C2C;">${esc(product.name || "memorial")}</strong>
          and our team will be in touch within 24 hours to discuss your requirements.
        </p>
      </td>
    </tr>

    <tr>
      <td style="padding:0 28px 24px;">
        <table width="100%" cellpadding="0" cellspacing="0" style="background:#FAF8F5;border:1px solid #E0DCD5;border-radius:8px;overflow:hidden;">
          <tr>
            <td width="6" style="background:${stoneHex};">&nbsp;</td>
            <td style="padding:16px 18px;">
              <div style="font-size:10px;letter-spacing:0.1em;text-transform:uppercase;color:#8B7355;font-weight:700;margin-bottom:4px;">Your Quote Summary</div>
              <div style="font-family:Georgia,serif;font-size:18px;color:#2C2C2C;margin-bottom:10px;">${esc(product.name || "—")}</div>
              <table cellpadding="0" cellspacing="4" style="font-size:13px;">
                <tr><td style="color:#999;width:90px;padding:3px 0;">Type</td><td style="color:#2C2C2C;">${esc(product.type || "—")}</td></tr>
                <tr>
                  <td style="color:#999;padding:3px 0;">Stone</td>
                  <td style="color:#2C2C2C;">
                    <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${stoneHex};vertical-align:middle;margin-right:5px;border:1px solid rgba(0,0,0,0.15);"></span>
                    ${esc(product.colour || "—")}
                  </td>
                </tr>
                <tr><td style="color:#999;padding:3px 0;">Guide price</td><td style="color:#2C2C2C;font-weight:700;">From £${esc(product.price || "—")}</td></tr>
              </table>
            </td>
          </tr>
        </table>
      </td>
    </tr>

    <tr>
      <td style="padding:0 28px 32px;">
        <p style="color:#555;font-size:14px;line-height:1.7;margin:0 0 10px;">
          If you have any urgent questions, please call us on <strong style="color:#2C2C2C;">01268 208 559</strong>.
        </p>
        <p style="color:#888;font-size:13px;margin:0;line-height:1.7;">
          With care,<br><strong style="color:#2C2C2C;">The Sears Melvin Team</strong>
        </p>
      </td>
    </tr>

    <tr>
      <td style="background:#1A1A1A;padding:16px 28px;text-align:center;border-radius:0 0 10px 10px;">
        <span style="font-size:11px;color:rgba(255,255,255,0.35);">Sears Melvin Memorials &middot; South London &amp; Beyond &middot; ${BUSINESS_EMAIL}</span>
      </td>
    </tr>

  </table>
  </td></tr>
</table>
</body></html>`;
}


// ─── ClickUp task description ─────────────────────────────────────────────────
function buildQuoteClickUpDescription({ name, email, phone, message, product, submittedAt }) {
  return [
    "=== QUOTE REQUEST ===",
    "",
    "PRODUCT SELECTED",
    `• Memorial:    ${product.name    || "—"}`,
    `• Type:        ${product.type    || "—"}`,
    `• Stone:       ${product.colour  || "—"}`,
    `• Guide price: From £${product.price || "—"}`,
    "",
    "CUSTOMER",
    `• Name:        ${name}`,
    `• Email:       ${email}`,
    `• Phone:       ${phone || "Not provided"}`,
    "",
    message ? `MESSAGE\n"${message}"` : "",
    "",
    "---",
    `Submitted: ${submittedAt}`,
  ].join("\n");
}


// ─── Helper: escape HTML in user-supplied strings ─────────────────────────────
function esc(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}


// ─── Helper: send email via Resend ───────────────────────────────────────────
async function sendEmail(apiKey, { from, to, subject, html }) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to, subject, html }),
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
    method: "POST",
    headers: { "Authorization": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({ name, description }),
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
