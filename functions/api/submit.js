/**
 * Sears Melvin Memorials — Cloudflare Pages Function
 * Route: /api/submit (POST)
 */
const CLICKUP_LIST_ID = "901207633256";
const BUSINESS_EMAIL = "info@searsmelvin.co.uk";
const FROM_EMAIL = "info@searsmelvin.co.uk";
const BUSINESS_NAME = "Sears Melvin Memorials";

const STONE_COLOURS = {
  "Black Galaxy": "#1a1a1a",
  "Rustenberg Grey": "#6b6b6b",
  "Vizag Blue": "#2c3e50",
  "Indian Aurora": "#8B5A2B",
  "Emerald Pearl": "#2d4a3e",
  "Ruby Red": "#722F37",
};

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!env.RESEND_API_KEY) {
    console.error("RESEND_API_KEY is not set");
    return jsonResponse({ ok: false, error: "Server configuration error" }, 500);
  }
  let data;
  try { data = await request.json(); }
  catch { return jsonResponse({ ok: false, error: "Invalid JSON" }, 400); }
  if (!data.name || !data.email) {
    return jsonResponse({ ok: false, error: "Missing required fields" }, 400);
  }
  const submittedAt = new Date().toLocaleString("en-GB", {
    timeZone: "Europe/London", dateStyle: "medium", timeStyle: "short",
  });
  if (data.type === "quote") return handleQuoteRequest(env, data, submittedAt);
  return handleEnquiry(env, data, submittedAt);
}

async function handleQuoteRequest(env, data, submittedAt) {
  const { name, email, phone, message, product = {}, location, payment_preference } = data;
  const invoiceOnly = payment_preference === 'invoice_only';
  const firstName = name.split(" ")[0];
  const stoneHex = STONE_COLOURS[product.colour] || "#8B7355";

  // 0. Stripe Invoice — generate FIRST so URL is available for emails
  let stripeInvoiceUrl = null;
  if (invoiceOnly && env.STRIPE_SECRET_KEY) {
    try {
      stripeInvoiceUrl = await createStripeInvoice(env.STRIPE_SECRET_KEY, { name, email, phone, product, location });
    } catch (err) { console.error("Stripe invoice creation failed:", err); }
  }

  // 1. Business notification email (critical)
  try {
    await sendEmail(env.RESEND_API_KEY, {
      from: `${BUSINESS_NAME} <${FROM_EMAIL}>`,
      to: BUSINESS_EMAIL,
      subject: `${invoiceOnly ? "Invoice Request" : "New Quote Request"} — ${product.name || "Memorial"} — ${name}`,
      html: quoteBusinessEmail({ name, email, phone, message, location, product, stoneHex, submittedAt, invoiceOnly, stripeInvoiceUrl }),
    });
  } catch (err) {
    console.error("Failed to send quote business email:", err);
    return jsonResponse({ ok: false, error: "Failed to send notification email" }, 500);
  }

  // 2. Customer confirmation email (non-critical)
  try {
    await sendEmail(env.RESEND_API_KEY, {
      from: `${BUSINESS_NAME} <${FROM_EMAIL}>`,
      to: email,
      subject: `Your ${invoiceOnly ? "invoice request" : "quote request"} — ${product.name || "Memorial"} — ${BUSINESS_NAME}`,
      html: quoteCustomerEmail({ firstName, product, stoneHex, invoiceOnly, stripeInvoiceUrl }),
    });
  } catch (err) { console.error("Failed to send quote customer email:", err); }

  // 3. ClickUp
  try {
    await createClickUpTask(env.CLICKUP_API_KEY, {
      name: `Quote Request — ${product.name || "Memorial"} — ${name}`,
      description: buildQuoteClickUpDescription({ name, email, phone, message, product, submittedAt }),
      listId: CLICKUP_LIST_ID,
    });
  } catch (err) { console.error("Failed to create ClickUp quote task:", err); }

  // 4. Supabase
  let invoiceId = null;
  try {
    const sbResult = await insertSupabaseRecord(env, { type: "quote", name, email, phone, product, location });
    invoiceId = sbResult?.invoiceId || null;
  } catch (err) { console.error("Supabase insert failed:", err); }

  // 5. GHL
  try { await createGHLContact(env, { name, email, phone, type: "quote", product }); }
  catch (err) { console.error("GHL contact create failed:", err); }

  return jsonResponse({ ok: true, invoiceId, invoiceOnly, stripeInvoiceUrl });
}

async function handleEnquiry(env, data, submittedAt) {
  const { name, email, phone, message, enquiry_type, location } = data;
  if (!message) return jsonResponse({ ok: false, error: "Missing required fields" }, 400);

  try {
    await sendEmail(env.RESEND_API_KEY, {
      from: `${BUSINESS_NAME} <${FROM_EMAIL}>`,
      to: BUSINESS_EMAIL,
      subject: `New Enquiry — ${name}`,
      html: `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#F5F3F0;font-family:-apple-system,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#F5F3F0;padding:24px 0;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#fff;border-radius:10px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.08);">
<tr><td style="background:#2C2C2C;padding:18px 28px;">
<table width="100%" cellpadding="0" cellspacing="0"><tr>
<td><span style="font-family:Georgia,serif;font-size:18px;color:#fff;">Sears Melvin <span style="opacity:0.55;font-weight:300;">Memorials</span></span></td>
<td align="right"><span style="background:#8B7355;color:#fff;padding:4px 11px;border-radius:3px;font-size:11px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;">New Enquiry</span></td>
</tr></table></td></tr>
<tr><td style="padding:26px 28px 0;">
<h2 style="font-family:Georgia,serif;font-size:22px;color:#2C2C2C;font-weight:normal;margin:0 0 4px;">New Website Enquiry</h2>
<p style="color:#AAA;font-size:12px;margin:0;">Received ${esc(submittedAt)}</p></td></tr>
<tr><td style="padding:20px 28px 0;"><hr style="border:none;border-top:1px solid #E0DCD5;margin:0;"></td></tr>
<tr><td style="padding:20px 28px 28px;">
<div style="font-size:10px;letter-spacing:0.08em;text-transform:uppercase;color:#8B7355;font-weight:700;margin-bottom:12px;">Customer</div>
<table width="100%" cellpadding="0" cellspacing="0" style="font-size:13px;">
<tr><td style="padding:5px 0;color:#999;width:110px;">Name</td><td style="padding:5px 0;color:#1A1A1A;font-weight:600;">${esc(name)}</td></tr>
<tr><td style="padding:5px 0;color:#999;">Email</td><td style="padding:5px 0;"><a href="mailto:${esc(email)}" style="color:#8B7355;">${esc(email)}</a></td></tr>
<tr><td style="padding:5px 0;color:#999;">Phone</td><td style="padding:5px 0;color:#1A1A1A;">${esc(phone || "Not provided")}</td></tr>
${enquiry_type ? `<tr><td style="padding:5px 0;color:#999;">Enquiry type</td><td style="padding:5px 0;color:#1A1A1A;">${esc(enquiry_type.replace(/-/g," ").replace(/\b\w/g,c=>c.toUpperCase()))}</td></tr>` : ""}
</table></td></tr>
<tr><td style="padding:0 28px 28px;">
<div style="font-size:10px;letter-spacing:0.08em;text-transform:uppercase;color:#8B7355;font-weight:700;margin-bottom:10px;">Message</div>
<div style="background:#F5F3F0;border-radius:6px;padding:14px 16px;font-size:13px;color:#1A1A1A;line-height:1.7;">${esc(message).replace(/\n/g,"<br>")}</div></td></tr>
<tr><td style="background:#F5F3F0;border-top:1px solid #E0DCD5;padding:14px 28px;text-align:center;">
<span style="font-size:11px;color:#BBB;">Sears Melvin Memorials &middot; <a href="mailto:${BUSINESS_EMAIL}" style="color:#BBB;">${BUSINESS_EMAIL}</a></span></td></tr>
</table></td></tr></table></body></html>`,
    });
  } catch (err) {
    console.error("Failed to send business notification email:", err);
    return jsonResponse({ ok: false, error: "Failed to send notification email" }, 500);
  }

  try {
    await sendEmail(env.RESEND_API_KEY, {
      from: `${BUSINESS_NAME} <${FROM_EMAIL}>`,
      to: email,
      subject: `We've received your enquiry — ${BUSINESS_NAME}`,
      html: `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#F5F3F0;font-family:-apple-system,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#F5F3F0;padding:24px 0;">
<tr><td align="center">
<table width="580" cellpadding="0" cellspacing="0" style="max-width:580px;background:#fff;border-radius:10px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.08);">
<tr><td style="background:#2C2C2C;padding:20px 28px;">
<span style="font-family:Georgia,serif;font-size:18px;color:#fff;">Sears Melvin <span style="opacity:0.55;font-weight:300;">Memorials</span></span></td></tr>
<tr><td style="padding:30px 28px 24px;">
<h2 style="font-family:Georgia,serif;font-size:23px;color:#2C2C2C;font-weight:normal;margin:0 0 14px;">Thank you, ${esc(name.split(" ")[0])}.</h2>
<p style="color:#555;font-size:15px;line-height:1.7;margin:0 0 16px;">We've received your enquiry and one of our team will be in contact within 24 hours.</p>
<p style="color:#555;font-size:14px;line-height:1.7;margin:0 0 24px;">If you have any urgent questions in the meantime, please call us on <strong style="color:#2C2C2C;">01268 208 559</strong>.</p>
<p style="color:#888;font-size:13px;margin:0;line-height:1.7;">With care,<br><strong style="color:#2C2C2C;">The Sears Melvin Team</strong></p></td></tr>
<tr><td style="background:#1A1A1A;padding:14px 28px;text-align:center;">
<span style="font-size:11px;color:rgba(255,255,255,0.35);">Sears Melvin Memorials &middot; South London &amp; Beyond &middot; ${BUSINESS_EMAIL}</span></td></tr>
</table></td></tr></table></body></html>`,
    });
  } catch (err) { console.error("Failed to send customer confirmation email:", err); }

  try {
    await createClickUpTask(env.CLICKUP_API_KEY, {
      name: `New Enquiry — ${name}`,
      description: `=== WEBSITE ENQUIRY ===\n\nCUSTOMER\n• Name: ${name}\n• Email: ${email}\n• Phone: ${phone || "Not provided"}\n• Enquiry type: ${enquiry_type || "Not specified"}\n\nMESSAGE\n${message}\n\n---\nSubmitted: ${submittedAt}`,
      listId: CLICKUP_LIST_ID,
    });
  } catch (err) { console.error("Failed to create ClickUp task:", err); }

  try { await insertSupabaseRecord(env, { type: "enquiry", name, email, phone, enquiry_type, location }); }
  catch (err) { console.error("Supabase insert failed:", err); }

  try { await createGHLContact(env, { name, email, phone, type: "enquiry" }); }
  catch (err) { console.error("GHL contact create failed:", err); }

  return jsonResponse({ ok: true });
}

// ═══════════════════════════════════════════════════════════════════
// EMAIL TEMPLATES
// ═══════════════════════════════════════════════════════════════════

function quoteBusinessEmail({ name, email, phone, message, location, product, stoneHex, submittedAt, invoiceOnly, stripeInvoiceUrl }) {
  const addonItems = Array.isArray(product.addonLineItems) && product.addonLineItems.length > 0
    ? product.addonLineItems
    : Array.isArray(product.addons) && product.addons.length > 0
      ? product.addons.map(function(n){ return { name: n, price: null }; })
      : [];
  const inscription = product.inscription ? product.inscription.trim() : "";
  const totalPrice = parseFloat(product.price) || 0;
  const addonTotal = addonItems.reduce((s, a) => s + (parseFloat(a.price) || 0), 0);
  const basePrice = Math.max(0, totalPrice - addonTotal);
  const imageUrl = product.image && product.image.trim() ? product.image.trim() : "";

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#F5F3F0;font-family:-apple-system,'DM Sans',sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#F5F3F0;padding:24px 0;">
<tr><td align="center">
<table width="620" cellpadding="0" cellspacing="0" style="max-width:620px;background:#fff;border-radius:10px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.08);">
<tr><td style="background:#2C2C2C;padding:18px 28px;">
<table width="100%" cellpadding="0" cellspacing="0"><tr>
<td><span style="font-family:Georgia,serif;font-size:18px;color:#fff;font-weight:normal;">Sears Melvin <span style="opacity:0.55;font-weight:300;">Memorials</span></span></td>
<td align="right"><span style="background:#8B7355;color:#fff;padding:4px 11px;border-radius:3px;font-size:11px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;">${invoiceOnly ? "Invoice Request" : "New Quote"}</span></td>
</tr></table></td></tr>
<tr><td style="padding:26px 28px 4px;">
<h2 style="font-family:Georgia,serif;font-size:22px;color:#2C2C2C;font-weight:normal;margin:0 0 4px;">${invoiceOnly ? "Invoice Request" : "New Quote Request"}</h2>
<p style="color:#AAA;font-size:12px;margin:0;">Received ${esc(submittedAt)}</p></td></tr>

<!-- Memorial Configuration card -->
<tr><td style="padding:20px 28px 0;">
<table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #E0DCD5;border-radius:8px;overflow:hidden;">
<tr>
<td width="6" style="background:${stoneHex};">&nbsp;</td>
<td style="padding:18px 20px;">
<div style="font-size:10px;letter-spacing:0.1em;text-transform:uppercase;color:#8B7355;font-weight:700;margin-bottom:6px;">Memorial Configuration</div>
<div style="font-family:Georgia,serif;font-size:20px;color:#2C2C2C;margin-bottom:14px;">${esc(product.name || "—")}</div>
${imageUrl ? `<div style="margin-bottom:16px;text-align:center;background:#F5F3F0;border-radius:6px;padding:12px;border:1px solid #E0DCD5;">
<img src="${imageUrl}" alt="${esc(product.name || "Memorial")}" style="display:block;margin:0 auto;max-width:200px;width:100%;height:auto;max-height:200px;object-fit:contain;border-radius:4px;">
</div>` : ""}
<table cellpadding="0" cellspacing="0" style="font-size:13px;width:100%;">
<tr><td style="color:#999;padding:4px 0;width:120px;">Type</td><td style="color:#1A1A1A;padding:4px 0;">${esc(product.type || "—")}</td></tr>
<tr><td style="color:#999;padding:4px 0;">Stone colour</td><td style="color:#1A1A1A;padding:4px 0;"><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${stoneHex};vertical-align:middle;margin-right:5px;border:1px solid rgba(0,0,0,0.15);"></span>${esc(product.colour || "—")}</td></tr>
${product.size ? `<tr><td style="color:#999;padding:4px 0;">Size</td><td style="color:#1A1A1A;padding:4px 0;">${esc(product.size)}</td></tr>` : ""}
</table>

<!-- Line items breakdown -->
<table cellpadding="0" cellspacing="0" style="font-size:13px;width:100%;margin-top:12px;border-top:1px solid #E0DCD5;">
<tr style="background:#F5F3F0;">
<td style="padding:8px 10px;color:#999;font-size:11px;letter-spacing:0.05em;text-transform:uppercase;">Item</td>
<td style="padding:8px 10px;color:#999;font-size:11px;letter-spacing:0.05em;text-transform:uppercase;text-align:right;">Price</td>
</tr>
<tr><td style="padding:7px 10px;color:#1A1A1A;border-bottom:1px solid #F0EDE8;">${esc(product.name || "Memorial")} (inc. installation &amp; permit)</td>
<td style="padding:7px 10px;color:#1A1A1A;text-align:right;border-bottom:1px solid #F0EDE8;font-weight:500;">£${basePrice.toLocaleString("en-GB", {maximumFractionDigits:0})}</td></tr>
${addonItems.filter(a => parseFloat(a.price) > 0).map(function(item){
  return `<tr><td style="padding:7px 10px;color:#555;border-bottom:1px solid #F0EDE8;">${esc(item.name)}</td>
<td style="padding:7px 10px;color:#555;text-align:right;border-bottom:1px solid #F0EDE8;">+£${parseFloat(item.price).toLocaleString("en-GB",{maximumFractionDigits:0})}</td></tr>`;
}).join("")}
<tr style="background:#F5F3F0;">
<td style="padding:8px 10px;color:#2C2C2C;font-weight:700;">Total (fully installed)</td>
<td style="padding:8px 10px;color:#2C2C2C;font-weight:700;text-align:right;font-size:15px;">£${totalPrice.toLocaleString("en-GB",{maximumFractionDigits:0})}</td>
</tr>
</table>

${inscription ? `<div style="margin-top:12px;background:#FAF8F5;border-left:3px solid #D4AF37;padding:8px 12px;font-family:Georgia,serif;font-style:italic;color:#2C2C2C;font-size:13px;line-height:1.6;">${esc(inscription).replace(/\n/g,"<br>")}</div>` : ""}
</td></tr></table></td></tr>

<!-- Customer section -->
<tr><td style="padding:16px 28px 0;"><hr style="border:none;border-top:1px solid #E0DCD5;margin:0;"></td></tr>
<tr><td style="padding:16px 28px ${message ? "0" : "24px"};">
<div style="font-size:10px;letter-spacing:0.08em;text-transform:uppercase;color:#8B7355;font-weight:700;margin-bottom:12px;">Customer</div>
<table width="100%" cellpadding="0" cellspacing="0" style="font-size:13px;">
<tr><td style="padding:5px 0;color:#999;width:110px;">Name</td><td style="padding:5px 0;color:#1A1A1A;font-weight:600;">${esc(name)}</td></tr>
<tr><td style="padding:5px 0;color:#999;">Email</td><td style="padding:5px 0;"><a href="mailto:${esc(email)}" style="color:#8B7355;">${esc(email)}</a></td></tr>
<tr><td style="padding:5px 0;color:#999;">Phone</td><td style="padding:5px 0;color:#1A1A1A;">${esc(phone || "Not provided")}</td></tr>
${location ? `<tr><td style="padding:5px 0;color:#999;">Cemetery</td><td style="padding:5px 0;color:#1A1A1A;">${esc(location)}</td></tr>` : ""}
${invoiceOnly && stripeInvoiceUrl ? `<tr><td style="padding:5px 0;color:#999;vertical-align:top;">Stripe Invoice</td><td style="padding:5px 0;"><a href="${stripeInvoiceUrl}" style="color:#8B7355;font-weight:600;">View invoice ↗</a></td></tr>` : ""}
</table></td></tr>

${message ? `<tr><td style="padding:12px 28px 24px;">
<div style="font-size:10px;letter-spacing:0.08em;text-transform:uppercase;color:#8B7355;font-weight:700;margin-bottom:10px;">Customer Notes</div>
<div style="background:#F5F3F0;border-radius:6px;padding:14px 16px;font-size:13px;color:#1A1A1A;line-height:1.7;">${esc(message).replace(/\n/g,"<br>")}</div></td></tr>` : ""}

<tr><td style="background:#F5F3F0;border-top:1px solid #E0DCD5;padding:14px 28px;text-align:center;">
<span style="font-size:11px;color:#BBB;">Sears Melvin Memorials &middot; South London &amp; Beyond &middot; <a href="mailto:${BUSINESS_EMAIL}" style="color:#BBB;">${BUSINESS_EMAIL}</a></span></td></tr>
</table></td></tr></table></body></html>`;
}

function quoteCustomerEmail({ firstName, product, stoneHex, invoiceOnly, stripeInvoiceUrl }) {
  const totalPrice = parseFloat(product.price) || 0;
  const addonItems = Array.isArray(product.addonLineItems) && product.addonLineItems.length > 0
    ? product.addonLineItems
    : Array.isArray(product.addons) && product.addons.length > 0
      ? product.addons.map(function(n){ return { name: n, price: null }; })
      : [];
  const addonTotal = addonItems.reduce((s, a) => s + (parseFloat(a.price) || 0), 0);
  const basePrice = Math.max(0, totalPrice - addonTotal);
  const imageUrl = product.image && product.image.trim() ? product.image.trim() : "";

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#F5F3F0;font-family:-apple-system,'DM Sans',sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#F5F3F0;padding:24px 0;">
<tr><td align="center">
<table width="580" cellpadding="0" cellspacing="0" style="max-width:580px;background:#fff;border-radius:10px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.08);">
<tr><td style="background:#2C2C2C;padding:20px 28px;">
<table width="100%" cellpadding="0" cellspacing="0"><tr>
<td><span style="font-family:Georgia,serif;font-size:18px;color:#fff;font-weight:normal;">Sears Melvin <span style="opacity:0.55;font-weight:300;">Memorials</span></span></td>
<td align="right"><span style="background:#8B7355;color:#fff;padding:4px 11px;border-radius:3px;font-size:11px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;">${invoiceOnly ? "Invoice Request" : "Quote Request"}</span></td>
</tr></table></td></tr>
<tr><td style="padding:30px 28px 0;">
<h2 style="font-family:Georgia,serif;font-size:23px;color:#2C2C2C;font-weight:normal;margin:0 0 14px;">Thank you, ${esc(firstName)}.</h2>
<p style="color:#555;font-size:15px;line-height:1.7;margin:0 0 22px;">We've received your ${invoiceOnly ? "invoice request" : "quote request"} for the <strong style="color:#2C2C2C;">${esc(product.name || "memorial")}</strong> and our team will be in touch within 24 hours.</p></td></tr>

<!-- Quote summary card -->
<tr><td style="padding:0 28px 24px;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#FAF8F5;border:1px solid #E0DCD5;border-radius:8px;overflow:hidden;">
<tr>
<td width="6" style="background:${stoneHex};">&nbsp;</td>
<td style="padding:16px 18px;">
<div style="font-size:10px;letter-spacing:0.1em;text-transform:uppercase;color:#8B7355;font-weight:700;margin-bottom:6px;">Your Order Summary</div>
<div style="font-family:Georgia,serif;font-size:18px;color:#2C2C2C;margin-bottom:14px;">${esc(product.name || "—")}</div>

${imageUrl ? `<div style="margin-bottom:16px;text-align:center;background:#fff;border-radius:6px;padding:12px;border:1px solid #E0DCD5;">
<img src="${imageUrl}" alt="${esc(product.name || "Memorial")}" style="display:block;margin:0 auto;max-width:200px;width:100%;height:auto;max-height:200px;object-fit:contain;border-radius:4px;">
</div>` : ""}

<table cellpadding="0" cellspacing="0" style="font-size:13px;width:100%;margin-bottom:12px;">
<tr><td style="color:#999;padding:3px 0;width:100px;">Type</td><td style="color:#2C2C2C;">${esc(product.type || "—")}</td></tr>
<tr><td style="color:#999;padding:3px 0;">Stone colour</td><td style="color:#2C2C2C;"><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${stoneHex};vertical-align:middle;margin-right:5px;border:1px solid rgba(0,0,0,0.15);"></span>${esc(product.colour || "—")}</td></tr>
${product.size ? `<tr><td style="color:#999;padding:3px 0;">Size</td><td style="color:#2C2C2C;">${esc(product.size)}</td></tr>` : ""}
</table>

<!-- Price breakdown table -->
<table cellpadding="0" cellspacing="0" style="font-size:13px;width:100%;border-top:1px solid #E0DCD5;">
<tr><td style="padding:7px 0;color:#555;border-bottom:1px solid #F0EDE8;">${esc(product.name || "Memorial")} (inc. installation)</td>
<td style="padding:7px 0;color:#555;text-align:right;border-bottom:1px solid #F0EDE8;">£${basePrice.toLocaleString("en-GB",{maximumFractionDigits:0})}</td></tr>
${addonItems.filter(a => parseFloat(a.price) > 0).map(function(item){
  return `<tr><td style="padding:7px 0;color:#555;border-bottom:1px solid #F0EDE8;">${esc(item.name)}</td>
<td style="padding:7px 0;color:#555;text-align:right;border-bottom:1px solid #F0EDE8;">+£${parseFloat(item.price).toLocaleString("en-GB",{maximumFractionDigits:0})}</td></tr>`;
}).join("")}
<tr><td style="padding:8px 0 3px;color:#2C2C2C;font-weight:700;">Total (fully installed)</td>
<td style="padding:8px 0 3px;color:#2C2C2C;font-weight:700;text-align:right;font-size:15px;">£${totalPrice.toLocaleString("en-GB",{maximumFractionDigits:0})}</td></tr>
</table>
</td></tr></table></td></tr>

<tr><td style="padding:0 28px 32px;">
${invoiceOnly && stripeInvoiceUrl ? `<div style="margin:0 0 20px;">
<a href="${stripeInvoiceUrl}" style="display:inline-block;background:#8B7355;color:#fff;text-decoration:none;padding:13px 28px;border-radius:6px;font-size:14px;font-weight:600;letter-spacing:0.03em;">View &amp; Pay Invoice →</a>
<p style="color:#888;font-size:12px;margin:8px 0 0;">Your invoice is ready. Pay at any time before the due date — no rush.</p>
</div>` : ""}
<p style="color:#555;font-size:14px;line-height:1.7;margin:0 0 10px;">If you have any urgent questions, please call us on <strong style="color:#2C2C2C;">01268 208 559</strong>.</p>
<p style="color:#888;font-size:13px;margin:0;line-height:1.7;">With care,<br><strong style="color:#2C2C2C;">The Sears Melvin Team</strong></p></td></tr>
<tr><td style="background:#1A1A1A;padding:16px 28px;text-align:center;border-radius:0 0 10px 10px;">
<span style="font-size:11px;color:rgba(255,255,255,0.35);">Sears Melvin Memorials &middot; South London &amp; Beyond &middot; ${BUSINESS_EMAIL}</span></td></tr>
</table></td></tr></table></body></html>`;
}

// ─── ClickUp task description ────────────────────────────────────────────────
function buildQuoteClickUpDescription({ name, email, phone, message, product, submittedAt }) {
  const addons = Array.isArray(product.addons) && product.addons.length > 0
    ? product.addons.join(", ") : "None";
  const lines = [
    "=== QUOTE REQUEST ===", "",
    "PRODUCT SELECTED",
    `• Memorial: ${product.name || "—"}`,
    `• Type: ${product.type || "—"}`,
    `• Stone: ${product.colour || "—"}`,
    `• Size: ${product.size || "—"}`,
    `• Extras: ${addons}`,
    product.inscription ? `• Inscription: "${product.inscription}"` : "",
    `• Guide total: £${formatPrice(product.price)}`,
    "", "CUSTOMER",
    `• Name: ${name}`,
    `• Email: ${email}`,
    `• Phone: ${phone || "Not provided"}`,
    "", message ? `CUSTOMER NOTES\n"${message}"` : "",
    "", "---", `Submitted: ${submittedAt}`,
  ].filter(l => l !== undefined);
  return lines.join("\n");
}

// ═══════════════════════════════════════════════════════════════════
// SUPABASE INTEGRATION
// ═══════════════════════════════════════════════════════════════════
async function insertSupabaseRecord(env, { type, name, email, phone, enquiry_type, location, product }) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) return;
  const headers = {
    "apikey": env.SUPABASE_SERVICE_KEY,
    "Authorization": `Bearer ${env.SUPABASE_SERVICE_KEY}`,
    "Content-Type": "application/json",
    "Prefer": "return=minimal",
  };
  const parts = name.trim().split(" ");
  const today = new Date().toISOString().split("T")[0];

  const custRes = await fetch(`${env.SUPABASE_URL}/rest/v1/customers`, {
    method: "POST", headers,
    body: JSON.stringify({ first_name: parts[0], last_name: parts.slice(1).join(" ") || null, email, phone: phone || null }),
  });
  if (!custRes.ok) throw new Error(`Supabase customers error ${custRes.status}: ${await custRes.text()}`);

  const orderRes = await fetch(`${env.SUPABASE_URL}/rest/v1/orders`, {
    method: "POST", headers: { ...headers, "Prefer": "return=representation" },
    body: JSON.stringify({
      customer_name: name, customer_email: email, customer_phone: phone || null,
      order_type: type === "quote" ? "quote" : (enquiry_type || null),
      sku: product?.name || null, color: product?.colour || null,
      value: product?.price ? parseFloat(product.price) : null, location: location || null,
    }),
  });
  if (!orderRes.ok) throw new Error(`Supabase orders error ${orderRes.status}: ${await orderRes.text()}`);
  const orderRows = await orderRes.json();
  const orderId = orderRows[0]?.id || null;

  let invoiceId = null;
  if (type === "quote" && product?.price) {
    const fullAmount = parseFloat(product.price);
    const invRes = await fetch(`${env.SUPABASE_URL}/rest/v1/invoices`, {
      method: "POST", headers: { ...headers, "Prefer": "return=representation" },
      body: JSON.stringify({
        order_id: orderId, customer_name: name, amount: fullAmount,
        status: "pending", issue_date: today, due_date: today,
      }),
    });
    if (!invRes.ok) {
      console.error(`Supabase invoices insert error ${invRes.status}: ${await invRes.text()}`);
    } else {
      const invRows = await invRes.json();
      invoiceId = invRows[0]?.id || null;
    }
  }

  if (product?.inscription) {
    const inscRes = await fetch(`${env.SUPABASE_URL}/rest/v1/inscriptions`, {
      method: "POST", headers,
      body: JSON.stringify({ inscription_text: product.inscription }),
    });
    if (!inscRes.ok) throw new Error(`Supabase inscriptions error ${inscRes.status}: ${await inscRes.text()}`);
  }

  return invoiceId ? { invoiceId } : undefined;
}

// ═══════════════════════════════════════════════════════════════════
// GOHIGHLEVEL INTEGRATION
// ═══════════════════════════════════════════════════════════════════
async function createGHLContact(env, { name, email, phone, type, product }) {
  if (!env.GHL_API_KEY || !env.GHL_LOCATION_ID) return;
  const parts = name.trim().split(" ");
  const tags = ["website-lead", type === "quote" ? "quote-request" : "enquiry"];
  if (product?.type) tags.push(product.type.toLowerCase().replace(/\s+/g, "-"));
  const customFields = [
    product?.name ? { key: "memorial_product", field_value: product.name } : null,
    product?.colour ? { key: "stone_colour", field_value: product.colour } : null,
    product?.size ? { key: "memorial_size", field_value: product.size } : null,
    product?.price ? { key: "guide_price", field_value: `£${formatPrice(product.price)}` } : null,
  ].filter(Boolean);
  const res = await fetch("https://services.leadconnectorhq.com/contacts/", {
    method: "POST",
    headers: { "Authorization": `Bearer ${env.GHL_API_KEY}`, "Version": "2021-07-28", "Content-Type": "application/json" },
    body: JSON.stringify({
      locationId: env.GHL_LOCATION_ID, firstName: parts[0], lastName: parts.slice(1).join(" ") || "",
      email, phone: phone || undefined, source: "Website", tags, customFields,
    }),
  });
  if (!res.ok) throw new Error(`GHL error ${res.status}: ${await res.text()}`);
}

// ═══════════════════════════════════════════════════════════════════
// STRIPE INVOICE HELPER — fixed line items
// ═══════════════════════════════════════════════════════════════════
async function createStripeInvoice(stripeKey, { name, email, phone, product, location }) {
  const stripePost = (path, params) => fetch(`https://api.stripe.com/v1${path}`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${stripeKey}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params),
  }).then(async r => {
    const json = await r.json();
    if (json.error) throw new Error(`Stripe ${path}: ${json.error.message}`);
    return json;
  });

  // 1. Find or create Stripe Customer
  const existingRes = await fetch(
    `https://api.stripe.com/v1/customers?email=${encodeURIComponent(email)}&limit=1`,
    { headers: { "Authorization": `Bearer ${stripeKey}` } }
  ).then(r => r.json());

  let customerId;
  if (existingRes.data && existingRes.data.length > 0) {
    customerId = existingRes.data[0].id;
    await stripePost(`/customers/${customerId}`, { name: name || "", ...(phone ? { phone } : {}) });
  } else {
    const customer = await stripePost("/customers", {
      email, name: name || "",
      ...(phone ? { phone } : {}),
      ...(location ? { "metadata[cemetery]": location } : {}),
    });
    customerId = customer.id;
  }

  // 2. Calculate amounts in pence
  const totalPricePence = Math.round(parseFloat(product.price || 0) * 100);
  const addonItems = Array.isArray(product.addonLineItems) && product.addonLineItems.length > 0
    ? product.addonLineItems : [];
  const addonTotalPence = addonItems.reduce((sum, a) => sum + Math.round(parseFloat(a.price || 0) * 100), 0);
  const basePricePence = Math.max(0, totalPricePence - addonTotalPence);

  const productDescription = [
    product.name || "Memorial",
    product.colour ? `· ${product.colour}` : "",
    product.size ? `· ${product.size}` : "",
  ].filter(Boolean).join(" ");

  // 3. Create invoice items — NO extra metadata params on invoice items (causes issues)
  await stripePost("/invoiceitems", {
    customer: customerId,
    amount: String(basePricePence),
    currency: "gbp",
    description: productDescription + " (inc. installation & permit)",
  });

  for (const addon of addonItems) {
    const addonPence = Math.round(parseFloat(addon.price || 0) * 100);
    if (addonPence > 0) {
      await stripePost("/invoiceitems", {
        customer: customerId,
        amount: String(addonPence),
        currency: "gbp",
        description: addon.name || "Add-on",
      });
    }
  }

  if (addonItems.length === 0 && Array.isArray(product.addons) && product.addons.length > 0) {
    for (const addonName of product.addons) {
      await stripePost("/invoiceitems", {
        customer: customerId, amount: "0", currency: "gbp", description: addonName,
      });
    }
  }

  // 4. Create Invoice
  const invoice = await stripePost("/invoices", {
    customer: customerId,
    collection_method: "send_invoice",
    days_until_due: "30",
    auto_advance: "false",
    description: `Sears Melvin Memorials — ${productDescription}`,
    footer: "Thank you for choosing Sears Melvin Memorials. All prices include installation. Balance due within 30 days.",
    "metadata[customer_name]": name || "",
    "metadata[product]": product.name || "",
    "metadata[cemetery]": location || "",
  });

  // 5. Finalise — generates PDF + hosted_invoice_url, does NOT send Stripe email
  const finalised = await stripePost(`/invoices/${invoice.id}/finalize`, { auto_advance: "false" });
  return finalised.hosted_invoice_url || null;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function formatPrice(str) {
  const n = parseFloat(str);
  if (isNaN(n)) return str || "—";
  return n.toLocaleString("en-GB", { maximumFractionDigits: 0 });
}

function esc(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

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

async function createClickUpTask(apiKey, { name, description, listId }) {
  const res = await fetch(`https://api.clickup.com/api/v2/list/${listId}/task`, {
    method: "POST",
    headers: { "Authorization": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({ name, description }),
  });
  if (!res.ok) throw new Error(`ClickUp error: ${await res.text()}`);
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}
