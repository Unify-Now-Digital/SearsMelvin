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
  "Access-Control-Allow-Origin": "https://searsmelvin.co.uk",
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
  if (!data.name || !data.email)
    return jsonResponse({ ok: false, error: "Missing required fields" }, 400);
  const submittedAt = new Date().toLocaleString("en-GB", {
    timeZone: "Europe/London", dateStyle: "medium", timeStyle: "short",
  });
  if (data.type === "quote") return handleQuoteRequest(env, data, submittedAt);
  if (data.type === "appointment") return handleAppointment(env, data, submittedAt);
  return handleEnquiry(env, data, submittedAt);
}

async function handleQuoteRequest(env, data, submittedAt) {
  const { name, email, phone, cemetery, message, product = {}, location, payment_preference } = data;
  const firstName = name.split(" ")[0];
  const stoneHex = STONE_COLOURS[product.colour] || "#8B7355";

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
      html:    quoteBusinessEmail({ name, email, phone, location: cemetery, message, product, stoneHex, submittedAt, stripeDepositUrl, stripeFullUrl }),
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
      subject: `Your quote — ${product.name || "Memorial"} — ${BUSINESS_NAME}`,
      html: quoteCustomerEmail({ firstName, product, stoneHex, stripeDepositUrl, stripeFullUrl, editToken }),
    });
  } catch (err) {
    console.error("Failed to send quote customer email:", err);
  }

  // 3. ClickUp
  try {
    await createClickUpTask(env.CLICKUP_API_KEY, {
      name: `Quote Request — ${product.name || "Memorial"} — ${name}`,
      description: buildQuoteClickUpDescription({ name, email, phone, message, product, submittedAt }),
      listId: CLICKUP_LIST_ID,
    });
  } catch (err) {
    console.error("Failed to create ClickUp quote task:", err);
  }

  // 4. Supabase
  let invoiceId = null;
  let editToken = null;
  try {
    const sbResult = await insertSupabaseRecord(env, { type: "quote", name, email, phone, product, location, message });
    invoiceId = sbResult?.invoiceId || null;
    editToken = sbResult?.editToken || null;
  } catch (err) {
    console.error("Supabase insert failed:", err);
  }

  // 5. GHL
  try {
    await createGHLContact(env, { name, email, phone, type: "quote", product });
  } catch (err) {
    console.error("GHL contact create failed:", err);
  }

  return jsonResponse({ ok: true, invoiceId, stripeDepositUrl, stripeFullUrl, editToken });
}

async function handleEnquiry(env, data, submittedAt) {
  const { name, email, phone, message, enquiry_type, location } = data;
  if (!message) return jsonResponse({ ok: false, error: "Missing required fields" }, 400);
  try {
    await sendEmail(env.RESEND_API_KEY, {
      from: `${BUSINESS_NAME} <${FROM_EMAIL}>`,
      to: BUSINESS_EMAIL,
      subject: `New Enquiry — ${name}`,
      html: enquiryBusinessEmail({ name, email, phone, message, enquiry_type, submittedAt }),
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
      html: enquiryCustomerEmail({ name }),
    });
  } catch (err) {
    console.error("Failed to send customer confirmation email:", err);
  }
  try {
    await createClickUpTask(env.CLICKUP_API_KEY, {
      name: `New Enquiry — ${name}`,
      description: `=== WEBSITE ENQUIRY ===\n\nCUSTOMER\n• Name: ${name}\n• Email: ${email}\n• Phone: ${phone || "Not provided"}\n• Enquiry type: ${enquiry_type || "Not specified"}\n\nMESSAGE\n${message}\n\n---\nSubmitted: ${submittedAt}`,
      listId: CLICKUP_LIST_ID,
    });
  } catch (err) {
    console.error("Failed to create ClickUp task:", err);
  }
  try {
    await insertSupabaseRecord(env, { type: "enquiry", name, email, phone, enquiry_type, location });
  } catch (err) {
    console.error("Supabase insert failed:", err);
  }
  try {
    await createGHLContact(env, { name, email, phone, type: "enquiry" });
  } catch (err) {
    console.error("GHL contact create failed:", err);
  }
  return jsonResponse({ ok: true });
}

// ═══════════════════════════════════════════════════════════════════
// APPOINTMENT BOOKING
// ═══════════════════════════════════════════════════════════════════

async function handleAppointment(env, data, submittedAt) {
  const { name, email, phone, appointment_type, appointment_date, appointment_time, notes } = data;
  if (!appointment_date || !appointment_time)
    return jsonResponse({ ok: false, error: "Missing date or time" }, 400);

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
      html: appointmentBusinessEmail({ name, email, phone, typeLabel, dateFormatted, appointment_time, notes, submittedAt, calendarLink }),
    });
  } catch (err) {
    console.error("Failed to send appointment business email:", err);
    return jsonResponse({ ok: false, error: "Failed to send notification" }, 500);
  }

  // 3. Customer confirmation email
  try {
    await sendEmail(env.RESEND_API_KEY, {
      from: `${BUSINESS_NAME} <${FROM_EMAIL}>`,
      to: email,
      subject: `Appointment request received — ${BUSINESS_NAME}`,
      html: appointmentCustomerEmail({ firstName, typeLabel, dateFormatted, appointment_time }),
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

  return jsonResponse({ ok: true });
}

async function createGoogleCalendarEvent(env, { name, email, phone, appointment_type, appointment_date, appointment_time, notes, typeLabel }) {
  // Supports both OAuth 2.0 refresh token (preferred) and service account key
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

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Google Calendar API error ${res.status}: ${errText}`);
  }

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

function appointmentBusinessEmail({ name, email, phone, typeLabel, dateFormatted, appointment_time, notes, submittedAt, calendarLink }) {
  return `
    <div style="font-family:-apple-system,sans-serif;max-width:600px;margin:0 auto;padding:2rem;">
      <h2 style="color:#2C2C2C;margin-bottom:1rem;">New Appointment Request</h2>
      <table style="width:100%;border-collapse:collapse;">
        <tr><td style="padding:8px 0;color:#666;width:140px;">Customer</td><td style="padding:8px 0;font-weight:600;">${name}</td></tr>
        <tr><td style="padding:8px 0;color:#666;">Email</td><td style="padding:8px 0;"><a href="mailto:${email}">${email}</a></td></tr>
        <tr><td style="padding:8px 0;color:#666;">Phone</td><td style="padding:8px 0;">${phone || "Not provided"}</td></tr>
        <tr><td style="padding:8px 0;color:#666;">Type</td><td style="padding:8px 0;font-weight:600;">${typeLabel}</td></tr>
        <tr><td style="padding:8px 0;color:#666;">Date</td><td style="padding:8px 0;font-weight:600;">${dateFormatted}</td></tr>
        <tr><td style="padding:8px 0;color:#666;">Time</td><td style="padding:8px 0;font-weight:600;">${appointment_time}</td></tr>
        ${notes ? `<tr><td style="padding:8px 0;color:#666;">Notes</td><td style="padding:8px 0;">${notes}</td></tr>` : ""}
      </table>
      ${calendarLink ? `<p style="margin-top:1rem;"><a href="${calendarLink}" style="color:#8B7355;font-weight:600;">View in Google Calendar →</a></p>` : ""}
      <p style="color:#999;font-size:0.85rem;margin-top:1.5rem;">Submitted: ${submittedAt}</p>
    </div>`;
}

function appointmentCustomerEmail({ firstName, typeLabel, dateFormatted, appointment_time }) {
  return `
    <div style="font-family:-apple-system,sans-serif;max-width:600px;margin:0 auto;padding:2rem;">
      <div style="text-align:center;margin-bottom:2rem;">
        <h1 style="color:#2C2C2C;font-size:1.5rem;">Appointment Request Received</h1>
      </div>
      <p style="color:#666;line-height:1.8;">Dear ${firstName},</p>
      <p style="color:#666;line-height:1.8;">Thank you for requesting a <strong>${typeLabel.toLowerCase()}</strong>. We've received your request for:</p>
      <div style="background:#FAF8F5;border-radius:8px;padding:1.25rem;margin:1.5rem 0;border-left:4px solid #8B7355;">
        <p style="margin:0;color:#2C2C2C;font-weight:600;">${dateFormatted} at ${appointment_time}</p>
        <p style="margin:0.25rem 0 0;color:#666;">${typeLabel}</p>
      </div>
      <p style="color:#666;line-height:1.8;">We'll confirm your appointment within 24 hours. Once confirmed, you'll receive a calendar invite with all the details.</p>
      <p style="color:#666;line-height:1.8;">If you need to change or cancel, just reply to this email or call us on <strong>+44 20 3835 2548</strong>.</p>
      <p style="color:#666;line-height:1.8;margin-top:1.5rem;">Warm regards,<br><strong>Sears Melvin Memorials</strong></p>
    </div>`;
}

// ═══════════════════════════════════════════════════════════════════
// EMAIL TEMPLATES
// ═══════════════════════════════════════════════════════════════════

function quoteBusinessEmail({ name, email, phone, message, location, product, stoneHex, submittedAt, stripeDepositUrl, stripeFullUrl }) {
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

  // Product image: must be a full absolute URL for email clients
  const rawImage = product.image && product.image.trim() ? product.image.trim() : "";
  const imageUrl = rawImage.startsWith('http') || rawImage.startsWith('data:') ? rawImage : rawImage ? `https://searsmelvin.co.uk${rawImage.startsWith('/') ? '' : '/'}${rawImage}` : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta http-equiv="Content-Type" content="text/html; charset=UTF-8">
</head>
<body style="margin:0;padding:0;background-color:#F5F3F0;font-family:Arial,Helvetica,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#F5F3F0;padding:24px 0;">
  <tr>
    <td align="center">
      <table role="presentation" width="620" cellpadding="0" cellspacing="0" border="0" style="max-width:620px;width:100%;background-color:#ffffff;border-radius:10px;overflow:hidden;">

        <!-- Header -->
        <tr>
          <td style="background-color:#2C2C2C;padding:18px 28px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td style="font-family:Georgia,Times New Roman,serif;font-size:18px;color:#ffffff;font-weight:normal;">
                  Sears Melvin <span style="opacity:0.55;font-weight:300;">Memorials</span>
                </td>
                <td align="right">
                  <span style="background-color:#8B7355;color:#ffffff;padding:5px 12px;border-radius:3px;font-size:11px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;font-family:Arial,sans-serif;">New Quote</span>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- Title row -->
        <tr>
          <td style="padding:26px 28px 4px;">
            <h2 style="font-family:Georgia,Times New Roman,serif;font-size:22px;color:#2C2C2C;font-weight:normal;margin:0 0 4px 0;">New Quote Request</h2>
            <p style="color:#AAAAAA;font-size:12px;margin:0;font-family:Arial,sans-serif;">Received ${esc(submittedAt)}</p>
          </td>
        </tr>

        <!-- Memorial Configuration card -->
        <tr>
          <td style="padding:20px 28px 0;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #E0DCD5;border-radius:8px;border-collapse:separate;">
              <tr>
                <td width="6" style="background-color:${stoneHex};border-radius:8px 0 0 8px;">&nbsp;</td>
                <td style="padding:18px 20px;">

                  <!-- Section label -->
                  <p style="font-size:10px;letter-spacing:0.1em;text-transform:uppercase;color:#8B7355;font-weight:700;margin:0 0 6px 0;font-family:Arial,sans-serif;">Memorial Configuration</p>

                  <!-- Product name -->
                  <p style="font-family:Georgia,Times New Roman,serif;font-size:20px;color:#2C2C2C;margin:0 0 14px 0;">${esc(product.name || "—")}</p>

                  ${imageUrl ? `<!-- Product image -->
                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:16px;">
                    <tr>
                      <td align="center" style="background-color:#F5F3F0;border:1px solid #E0DCD5;border-radius:6px;padding:12px;">
                        <img src="${imageUrl}" alt="${esc(product.name || "Memorial")}" width="360" style="display:block;width:100%;max-width:360px;height:auto;" />
                      </td>
                    </tr>
                  </table>` : ""}

                  <!-- Spec rows -->
                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="font-size:13px;font-family:Arial,sans-serif;margin-bottom:0;">
                    <tr>
                      <td width="130" style="color:#999999;padding:4px 0;vertical-align:top;">Type</td>
                      <td style="color:#1A1A1A;padding:4px 0;">${esc(product.type || "—")}</td>
                    </tr>
                    <tr>
                      <td style="color:#999999;padding:4px 0;vertical-align:top;">Stone colour</td>
                      <td style="color:#1A1A1A;padding:4px 0;">
                        <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background-color:${stoneHex};vertical-align:middle;margin-right:5px;border:1px solid rgba(0,0,0,0.15);"></span>${esc(product.colour || "—")}
                      </td>
                    </tr>
                    ${product.size ? `<tr>
                      <td style="color:#999999;padding:4px 0;vertical-align:top;">Size</td>
                      <td style="color:#1A1A1A;padding:4px 0;">${esc(product.size)}</td>
                    </tr>` : ""}
                    ${product.font ? `<tr>
                      <td style="color:#999999;padding:4px 0;vertical-align:top;">Font</td>
                      <td style="color:#1A1A1A;padding:4px 0;">${esc(product.font === 'script' ? 'Script' : 'Traditional')}</td>
                    </tr>` : ""}
                    ${product.letterColour ? `<tr>
                      <td style="color:#999999;padding:4px 0;vertical-align:top;">Lettering colour</td>
                      <td style="color:#1A1A1A;padding:4px 0;">${esc(product.letterColour.charAt(0).toUpperCase() + product.letterColour.slice(1))}</td>
                    </tr>` : ""}
                  </table>

                  <!-- Line items table -->
                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="font-size:13px;font-family:Arial,sans-serif;margin-top:14px;border-top:1px solid #E0DCD5;">

                    <!-- Header row -->
                    <tr style="background-color:#F5F3F0;">
                      <td style="padding:8px 10px;color:#999999;font-size:11px;letter-spacing:0.05em;text-transform:uppercase;">Item</td>
                      <td width="80" align="right" style="padding:8px 10px;color:#999999;font-size:11px;letter-spacing:0.05em;text-transform:uppercase;">Price</td>
                    </tr>

                    <!-- Base memorial row -->
                    <tr>
                      <td style="padding:8px 10px;color:#1A1A1A;border-bottom:1px solid #F0EDE8;">${esc(product.name || "Memorial")} (inc. installation)</td>
                      <td align="right" style="padding:8px 10px;color:#1A1A1A;border-bottom:1px solid #F0EDE8;font-weight:500;white-space:nowrap;">£${basePrice.toLocaleString("en-GB",{maximumFractionDigits:0})}</td>
                    </tr>

                    ${addonItems.filter(a => parseFloat(a.price) > 0).map(function(item) {
                      return `<tr>
                      <td style="padding:8px 10px;color:#555555;border-bottom:1px solid #F0EDE8;">${esc(item.name)}</td>
                      <td align="right" style="padding:8px 10px;color:#555555;border-bottom:1px solid #F0EDE8;white-space:nowrap;">+£${parseFloat(item.price).toLocaleString("en-GB",{maximumFractionDigits:0})}</td>
                    </tr>`;
                    }).join("")}

                    ${addonItems.filter(a => !(parseFloat(a.price) > 0) && a.name).map(function(item) {
                      return `<tr>
                      <td style="padding:8px 10px;color:#555555;border-bottom:1px solid #F0EDE8;">${esc(item.name)}</td>
                      <td align="right" style="padding:8px 10px;color:#555555;border-bottom:1px solid #F0EDE8;white-space:nowrap;">—</td>
                    </tr>`;
                    }).join("")}

                    ${permitFee > 0 ? `<!-- Permit fee row -->
                    <tr>
                      <td style="padding:8px 10px;color:#555555;border-bottom:1px solid #F0EDE8;">Cemetery Permit Fee</td>
                      <td align="right" style="padding:8px 10px;color:#555555;border-bottom:1px solid #F0EDE8;white-space:nowrap;">+£${permitFee.toLocaleString("en-GB",{maximumFractionDigits:0})}</td>
                    </tr>` : ""}

                    <!-- Total row -->
                    <tr style="background-color:#F5F3F0;">
                      <td style="padding:9px 10px;color:#2C2C2C;font-weight:700;">Guide total (installed)</td>
                      <td align="right" style="padding:9px 10px;color:#2C2C2C;font-weight:700;font-size:15px;white-space:nowrap;">£${grandTotal.toLocaleString("en-GB",{maximumFractionDigits:0})}</td>
                    </tr>

                  </table>
                  ${permitFee <= 0 ? `<p style="font-size:11px;color:#999999;margin:6px 10px 0;font-family:Arial,sans-serif;">*Permit fee not yet determined — varies by cemetery</p>` : ""}

                  ${inscription ? `<!-- Inscription -->
                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:12px;">
                    <tr>
                      <td style="background-color:#FAF8F5;border-left:3px solid #D4AF37;padding:8px 12px;font-family:Georgia,Times New Roman,serif;font-style:italic;color:#2C2C2C;font-size:13px;line-height:1.6;">${esc(inscription).replace(/\n/g,"<br>")}</td>
                    </tr>
                  </table>` : ""}

                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- Divider -->
        <tr>
          <td style="padding:16px 28px 0;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr><td style="border-top:1px solid #E0DCD5;font-size:0;line-height:0;">&nbsp;</td></tr>
            </table>
          </td>
        </tr>

        <!-- Customer section -->
        <tr>
          <td style="padding:16px 28px ${message ? "0" : "24px"};">
            <p style="font-size:10px;letter-spacing:0.08em;text-transform:uppercase;color:#8B7355;font-weight:700;margin:0 0 12px 0;font-family:Arial,sans-serif;">Customer</p>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="font-size:13px;font-family:Arial,sans-serif;">
              <tr>
                <td width="120" style="padding:5px 0;color:#999999;vertical-align:top;">Name</td>
                <td style="padding:5px 0;color:#1A1A1A;font-weight:600;">${esc(name)}</td>
              </tr>
              <tr>
                <td style="padding:5px 0;color:#999999;vertical-align:top;">Email</td>
                <td style="padding:5px 0;"><a href="mailto:${esc(email)}" style="color:#8B7355;text-decoration:none;">${esc(email)}</a></td>
              </tr>
              <tr>
                <td style="padding:5px 0;color:#999999;vertical-align:top;">Phone</td>
                <td style="padding:5px 0;color:#1A1A1A;">${esc(phone || "Not provided")}</td>
              </tr>
              ${location ? `<tr>
                <td style="padding:5px 0;color:#999999;vertical-align:top;">Cemetery</td>
                <td style="padding:5px 0;color:#1A1A1A;">${esc(location)}</td>
              </tr>` : ""}
            </table>
          </td>
        </tr>

        ${stripeDepositUrl || stripeFullUrl ? `<!-- Payment CTA buttons -->
        <tr>
          <td style="padding:20px 28px 10px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
              ${stripeDepositUrl ? `<tr>
                <td align="center" style="background-color:#8B7355;border-radius:8px;padding:0;margin-bottom:8px;">
                  <a href="${stripeDepositUrl}" style="display:block;padding:14px 20px;font-family:Arial,sans-serif;font-size:14px;font-weight:700;color:#ffffff;text-decoration:none;">50% Deposit Invoice &rarr;</a>
                </td>
              </tr>
              <tr><td style="height:8px;"></td></tr>` : ""}
              ${stripeFullUrl ? `<tr>
                <td align="center" style="background-color:#2C2C2C;border-radius:8px;padding:0;">
                  <a href="${stripeFullUrl}" style="display:block;padding:14px 20px;font-family:Arial,sans-serif;font-size:14px;font-weight:700;color:#ffffff;text-decoration:none;">Full Payment Invoice &rarr;</a>
                </td>
              </tr>` : ""}
            </table>
          </td>
        </tr>
        <tr>
          <td style="padding:0 28px 10px;">
            <p style="font-family:Arial,sans-serif;font-size:12px;color:#999999;margin:0;text-align:center;line-height:1.5;">
              <em>Note: Outstanding balance may be required if modifications are made to the memorial after deposit.</em>
            </p>
          </td>
        </tr>` : ""}

        ${message ? `<!-- Customer notes -->
        <tr>
          <td style="padding:12px 28px 24px;">
            <p style="font-size:10px;letter-spacing:0.08em;text-transform:uppercase;color:#8B7355;font-weight:700;margin:0 0 10px 0;font-family:Arial,sans-serif;">Customer Notes</p>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td style="background-color:#F5F3F0;border-radius:6px;padding:14px 16px;font-size:13px;color:#1A1A1A;line-height:1.7;font-family:Arial,sans-serif;">${esc(message).replace(/\n/g,"<br>")}</td>
              </tr>
            </table>
          </td>
        </tr>` : ""}

        <!-- Footer -->
        <tr>
          <td style="background-color:#F5F3F0;border-top:1px solid #E0DCD5;padding:14px 28px;text-align:center;">
            <span style="font-size:11px;color:#BBBBBB;font-family:Arial,sans-serif;">Sears Melvin Memorials &middot; North London (NW11) &middot; <a href="mailto:${BUSINESS_EMAIL}" style="color:#BBBBBB;text-decoration:none;">${BUSINESS_EMAIL}</a></span>
          </td>
        </tr>

      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}

function quoteCustomerEmail({ firstName, product, stoneHex, stripeDepositUrl, stripeFullUrl, editToken }) {
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
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta http-equiv="Content-Type" content="text/html; charset=UTF-8">
</head>
<body style="margin:0;padding:0;background-color:#F5F3F0;font-family:Arial,Helvetica,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#F5F3F0;padding:24px 0;">
  <tr>
    <td align="center">
      <table role="presentation" width="580" cellpadding="0" cellspacing="0" border="0" style="max-width:580px;width:100%;background-color:#ffffff;border-radius:10px;overflow:hidden;">

        <!-- Header -->
        <tr>
          <td style="background-color:#2C2C2C;padding:20px 28px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td style="font-family:Georgia,Times New Roman,serif;font-size:18px;color:#ffffff;font-weight:normal;">
                  Sears Melvin <span style="opacity:0.55;font-weight:300;">Memorials</span>
                </td>
                <td align="right">
                  <span style="background-color:#8B7355;color:#ffffff;padding:5px 12px;border-radius:3px;font-size:11px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;font-family:Arial,sans-serif;">Quote Request</span>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- Thank you message -->
        <tr>
          <td style="padding:30px 28px 0;">
            <h2 style="font-family:Georgia,Times New Roman,serif;font-size:23px;color:#2C2C2C;font-weight:normal;margin:0 0 14px 0;">Thank you, ${esc(firstName)}.</h2>
            <p style="color:#555555;font-size:15px;line-height:1.7;margin:0 0 22px 0;font-family:Arial,sans-serif;">We've received your quote request for the <strong style="color:#2C2C2C;">${esc(product.name || "memorial")}</strong> and our team will be in touch within 24 hours.</p>
          </td>
        </tr>

        <!-- Quote summary card -->
        <tr>
          <td style="padding:0 28px 24px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#FAF8F5;border:1px solid #E0DCD5;border-radius:8px;border-collapse:separate;">
              <tr>
                <td width="6" style="background-color:${stoneHex};border-radius:8px 0 0 8px;">&nbsp;</td>
                <td style="padding:16px 18px;">

                  <p style="font-size:10px;letter-spacing:0.1em;text-transform:uppercase;color:#8B7355;font-weight:700;margin:0 0 6px 0;font-family:Arial,sans-serif;">Your Order Summary</p>
                  <p style="font-family:Georgia,Times New Roman,serif;font-size:18px;color:#2C2C2C;margin:0 0 14px 0;">${esc(product.name || "—")}</p>

                  ${imageUrl ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:16px;">
                    <tr>
                      <td align="center" style="background-color:#ffffff;border:1px solid #E0DCD5;border-radius:6px;padding:12px;">
                        <img src="${imageUrl}" alt="${esc(product.name || "Memorial")}" width="360" style="display:block;width:100%;max-width:360px;height:auto;" />
                      </td>
                    </tr>
                  </table>` : ""}

                  <!-- Spec rows -->
                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="font-size:13px;font-family:Arial,sans-serif;margin-bottom:12px;">
                    <tr>
                      <td width="110" style="color:#999999;padding:3px 0;vertical-align:top;">Type</td>
                      <td style="color:#2C2C2C;">${esc(product.type || "—")}</td>
                    </tr>
                    <tr>
                      <td style="color:#999999;padding:3px 0;vertical-align:top;">Stone colour</td>
                      <td style="color:#2C2C2C;">
                        <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background-color:${stoneHex};vertical-align:middle;margin-right:5px;border:1px solid rgba(0,0,0,0.15);"></span>${esc(product.colour || "—")}
                      </td>
                    </tr>
                    ${product.size ? `<tr>
                      <td style="color:#999999;padding:3px 0;vertical-align:top;">Size</td>
                      <td style="color:#2C2C2C;">${esc(product.size)}</td>
                    </tr>` : ""}
                    ${product.font ? `<tr>
                      <td style="color:#999999;padding:3px 0;vertical-align:top;">Font</td>
                      <td style="color:#2C2C2C;">${esc(product.font === 'script' ? 'Script' : 'Traditional')}</td>
                    </tr>` : ""}
                    ${product.letterColour ? `<tr>
                      <td style="color:#999999;padding:3px 0;vertical-align:top;">Lettering colour</td>
                      <td style="color:#2C2C2C;">${esc(product.letterColour.charAt(0).toUpperCase() + product.letterColour.slice(1))}</td>
                    </tr>` : ""}
                  </table>

                  <!-- Price breakdown -->
                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="font-size:13px;font-family:Arial,sans-serif;border-top:1px solid #E0DCD5;">
                    <tr>
                      <td style="padding:8px 0;color:#555555;border-bottom:1px solid #F0EDE8;">${esc(product.name || "Memorial")} (inc. installation)</td>
                      <td align="right" style="padding:8px 0;color:#555555;border-bottom:1px solid #F0EDE8;white-space:nowrap;">£${basePrice.toLocaleString("en-GB",{maximumFractionDigits:0})}</td>
                    </tr>

                    ${addonItems.filter(a => parseFloat(a.price) > 0).map(function(item) {
                      return `<tr>
                      <td style="padding:8px 0;color:#555555;border-bottom:1px solid #F0EDE8;">${esc(item.name)}</td>
                      <td align="right" style="padding:8px 0;color:#555555;border-bottom:1px solid #F0EDE8;white-space:nowrap;">+£${parseFloat(item.price).toLocaleString("en-GB",{maximumFractionDigits:0})}</td>
                    </tr>`;
                    }).join("")}

                    ${addonItems.filter(a => !(parseFloat(a.price) > 0) && a.name).map(function(item) {
                      return `<tr>
                      <td style="padding:8px 0;color:#555555;border-bottom:1px solid #F0EDE8;">${esc(item.name)}</td>
                      <td align="right" style="padding:8px 0;color:#555555;border-bottom:1px solid #F0EDE8;white-space:nowrap;">—</td>
                    </tr>`;
                    }).join("")}

                    ${permitFee > 0 ? `<tr>
                      <td style="padding:8px 0;color:#555555;border-bottom:1px solid #F0EDE8;">Cemetery Permit Fee</td>
                      <td align="right" style="padding:8px 0;color:#555555;border-bottom:1px solid #F0EDE8;white-space:nowrap;">+£${permitFee.toLocaleString("en-GB",{maximumFractionDigits:0})}</td>
                    </tr>` : ""}

                    <tr>
                      <td style="padding:9px 0 3px;color:#2C2C2C;font-weight:700;">Guide total (installed)</td>
                      <td align="right" style="padding:9px 0 3px;color:#2C2C2C;font-weight:700;font-size:15px;white-space:nowrap;">£${grandTotal.toLocaleString("en-GB",{maximumFractionDigits:0})}</td>
                    </tr>
                  </table>
                  ${permitFee <= 0 ? `<p style="font-size:11px;color:#999999;margin:6px 0 0;font-family:Arial,sans-serif;">*Permit fee not yet determined — varies by cemetery</p>` : ""}

                </td>
              </tr>
            </table>
          </td>
        </tr>

        ${stripeDepositUrl || stripeFullUrl ? `<!-- Payment CTA buttons -->
        <tr>
          <td style="padding:0 28px 16px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
              ${stripeDepositUrl ? `<tr>
                <td align="center" style="background-color:#8B7355;border-radius:8px;padding:0;">
                  <a href="${stripeDepositUrl}" style="display:block;padding:16px 28px;font-family:Arial,sans-serif;font-size:16px;font-weight:700;color:#ffffff;text-decoration:none;text-align:center;border-radius:8px;">Pay 50% Deposit &rarr;</a>
                </td>
              </tr>
              <tr><td style="height:10px;"></td></tr>` : ""}
              ${stripeFullUrl ? `<tr>
                <td align="center" style="background-color:#2C2C2C;border-radius:8px;padding:0;">
                  <a href="${stripeFullUrl}" style="display:block;padding:16px 28px;font-family:Arial,sans-serif;font-size:16px;font-weight:700;color:#ffffff;text-decoration:none;text-align:center;border-radius:8px;">Pay in Full &rarr;</a>
                </td>
              </tr>` : ""}
              <tr>
                <td style="padding:10px 0 0;text-align:center;">
                  <span style="font-family:Arial,sans-serif;color:#888888;font-size:12px;">No obligation — pay only when you're ready to proceed.</span>
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <!-- Outstanding balance note -->
        <tr>
          <td style="padding:0 28px 16px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#FAF8F5;border-radius:6px;border-left:3px solid #8B7355;">
              <tr>
                <td style="padding:12px 14px;font-family:Arial,sans-serif;font-size:13px;color:#555555;line-height:1.6;">
                  <strong style="color:#2C2C2C;">Please note:</strong> Outstanding balance may be required if modifications are made to the memorial after deposit. Your installation timeline begins once payment is confirmed — we'll be in touch to discuss dates and next steps.
                </td>
              </tr>
            </table>
          </td>
        </tr>` : ""}

        ${editToken ? `<!-- Edit quote link -->
        <tr>
          <td style="padding:0 28px 20px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#F5F3F0;border-radius:8px;">
              <tr>
                <td style="padding:14px 18px;font-family:Arial,sans-serif;">
                  <p style="font-size:13px;color:#555555;margin:0 0 8px;line-height:1.5;">Changed your mind about colour, size, or extras? You can update your quote at any time:</p>
                  <a href="https://searsmelvin.co.uk/quote.html?token=${editToken}" style="color:#8B7355;font-size:13px;font-weight:600;text-decoration:none;">Edit Your Quote &rarr;</a>
                </td>
              </tr>
            </table>
          </td>
        </tr>` : ""}

        <!-- Track quotes link -->
        <tr>
          <td style="padding:0 28px 16px;">
            <p style="font-family:Arial,sans-serif;font-size:12px;color:#999999;margin:0;text-align:center;">
              <a href="https://searsmelvin.co.uk/quote.html?email=${encodeURIComponent(email)}" style="color:#8B7355;text-decoration:none;">View all your quotes</a> &middot; Quote reference available in your account
            </p>
          </td>
        </tr>

        <!-- Contact / sign-off -->
        <tr>
          <td style="padding:0 28px 32px;">
            <p style="color:#555555;font-size:14px;line-height:1.7;margin:0 0 10px 0;font-family:Arial,sans-serif;">If you have any urgent questions, please call us on <strong style="color:#2C2C2C;">+44 20 3835 2548</strong>.</p>
            <p style="color:#888888;font-size:13px;margin:0;line-height:1.7;font-family:Arial,sans-serif;">With care,<br><strong style="color:#2C2C2C;">The Sears Melvin Team</strong></p>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="background-color:#1A1A1A;padding:16px 28px;text-align:center;border-radius:0 0 10px 10px;">
            <span style="font-size:11px;color:rgba(255,255,255,0.35);font-family:Arial,sans-serif;">Sears Melvin Memorials &middot; North London (NW11) &middot; ${BUSINESS_EMAIL}</span>
          </td>
        </tr>

      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}

function enquiryBusinessEmail({ name, email, phone, message, enquiry_type, submittedAt }) {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background-color:#F5F3F0;font-family:Arial,Helvetica,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#F5F3F0;padding:24px 0;">
  <tr><td align="center">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;background-color:#ffffff;border-radius:10px;overflow:hidden;">
      <tr><td style="background-color:#2C2C2C;padding:18px 28px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
          <td style="font-family:Georgia,Times New Roman,serif;font-size:18px;color:#ffffff;">Sears Melvin <span style="opacity:0.55;font-weight:300;">Memorials</span></td>
          <td align="right"><span style="background-color:#8B7355;color:#ffffff;padding:5px 12px;border-radius:3px;font-size:11px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;font-family:Arial,sans-serif;">New Enquiry</span></td>
        </tr></table>
      </td></tr>
      <tr><td style="padding:26px 28px 4px;">
        <h2 style="font-family:Georgia,Times New Roman,serif;font-size:22px;color:#2C2C2C;font-weight:normal;margin:0 0 4px 0;">New Website Enquiry</h2>
        <p style="color:#AAAAAA;font-size:12px;margin:0;font-family:Arial,sans-serif;">Received ${esc(submittedAt)}</p>
      </td></tr>
      <tr><td style="padding:16px 28px 0;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="border-top:1px solid #E0DCD5;line-height:0;font-size:0;">&nbsp;</td></tr></table>
      </td></tr>
      <tr><td style="padding:16px 28px 0;">
        <p style="font-size:10px;letter-spacing:0.08em;text-transform:uppercase;color:#8B7355;font-weight:700;margin:0 0 12px 0;font-family:Arial,sans-serif;">Customer</p>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="font-size:13px;font-family:Arial,sans-serif;">
          <tr><td width="120" style="padding:5px 0;color:#999999;">Name</td><td style="padding:5px 0;color:#1A1A1A;font-weight:600;">${esc(name)}</td></tr>
          <tr><td style="padding:5px 0;color:#999999;">Email</td><td style="padding:5px 0;"><a href="mailto:${esc(email)}" style="color:#8B7355;">${esc(email)}</a></td></tr>
          <tr><td style="padding:5px 0;color:#999999;">Phone</td><td style="padding:5px 0;color:#1A1A1A;">${esc(phone || "Not provided")}</td></tr>
          ${enquiry_type ? `<tr><td style="padding:5px 0;color:#999999;">Enquiry type</td><td style="padding:5px 0;color:#1A1A1A;">${esc(enquiry_type.replace(/-/g," ").replace(/\b\w/g,c=>c.toUpperCase()))}</td></tr>` : ""}
        </table>
      </td></tr>
      <tr><td style="padding:12px 28px 28px;">
        <p style="font-size:10px;letter-spacing:0.08em;text-transform:uppercase;color:#8B7355;font-weight:700;margin:0 0 10px 0;font-family:Arial,sans-serif;">Message</p>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr><td style="background-color:#F5F3F0;border-radius:6px;padding:14px 16px;font-size:13px;color:#1A1A1A;line-height:1.7;font-family:Arial,sans-serif;">${esc(message).replace(/\n/g,"<br>")}</td></tr>
        </table>
      </td></tr>
      <tr><td style="background-color:#F5F3F0;border-top:1px solid #E0DCD5;padding:14px 28px;text-align:center;">
        <span style="font-size:11px;color:#BBBBBB;font-family:Arial,sans-serif;">Sears Melvin Memorials &middot; North London (NW11) &middot; <a href="mailto:${BUSINESS_EMAIL}" style="color:#BBBBBB;">${BUSINESS_EMAIL}</a></span>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;
}

function enquiryCustomerEmail({ name }) {
  const firstName = name.split(" ")[0];
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background-color:#F5F3F0;font-family:Arial,Helvetica,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#F5F3F0;padding:24px 0;">
  <tr><td align="center">
    <table role="presentation" width="580" cellpadding="0" cellspacing="0" border="0" style="max-width:580px;width:100%;background-color:#ffffff;border-radius:10px;overflow:hidden;">
      <tr><td style="background-color:#2C2C2C;padding:20px 28px;">
        <span style="font-family:Georgia,Times New Roman,serif;font-size:18px;color:#ffffff;">Sears Melvin <span style="opacity:0.55;font-weight:300;">Memorials</span></span>
      </td></tr>
      <tr><td style="padding:30px 28px 24px;">
        <h2 style="font-family:Georgia,Times New Roman,serif;font-size:23px;color:#2C2C2C;font-weight:normal;margin:0 0 14px 0;">Thank you, ${esc(firstName)}.</h2>
        <p style="color:#555555;font-size:15px;line-height:1.7;margin:0 0 16px 0;font-family:Arial,sans-serif;">We've received your enquiry and one of our team will be in contact within 24 hours.</p>
        <p style="color:#555555;font-size:14px;line-height:1.7;margin:0 0 24px 0;font-family:Arial,sans-serif;">If you have any urgent questions in the meantime, please call us on <strong style="color:#2C2C2C;">+44 20 3835 2548</strong>.</p>
        <p style="color:#888888;font-size:13px;margin:0;line-height:1.7;font-family:Arial,sans-serif;">With care,<br><strong style="color:#2C2C2C;">The Sears Melvin Team</strong></p>
      </td></tr>
      <tr><td style="background-color:#1A1A1A;padding:14px 28px;text-align:center;">
        <span style="font-size:11px;color:rgba(255,255,255,0.35);font-family:Arial,sans-serif;">Sears Melvin Memorials &middot; North London (NW11) &middot; ${BUSINESS_EMAIL}</span>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;
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
    product.font ? `• Font: ${product.font === 'script' ? 'Script' : 'Traditional'}` : "",
    product.letterColour ? `• Lettering colour: ${product.letterColour}` : "",
    `• Extras: ${addons}`,
    product.inscription ? `• Inscription: "${product.inscription}"` : "",
    `• Guide total: £${formatPrice(product.price)}`, "",
    "CUSTOMER",
    `• Name: ${name}`,
    `• Email: ${email}`,
    `• Phone: ${phone || "Not provided"}`, "",
    message ? `CUSTOMER NOTES\n"${message}"` : "", "",
    "---",
    `Submitted: ${submittedAt}`,
  ].filter(l => l !== undefined);
  return lines.join("\n");
}

// ═══════════════════════════════════════════════════════════════════
// SUPABASE INTEGRATION
// ═══════════════════════════════════════════════════════════════════
function generateToken() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let token = '';
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  for (const b of bytes) token += chars[b % chars.length];
  return token;
}

async function insertSupabaseRecord(env, { type, name, email, phone, enquiry_type, location, product, message }) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) return;
  const headers = {
    "apikey": env.SUPABASE_SERVICE_KEY,
    "Authorization": `Bearer ${env.SUPABASE_SERVICE_KEY}`,
    "Content-Type": "application/json",
    "Prefer": "return=minimal",
  };
  const today = new Date().toISOString().split("T")[0];
  const dueDate = new Date(Date.now() + 30 * 86400000).toISOString().split("T")[0];

  // Generate an edit token for quote editing
  const editToken = type === "quote" ? generateToken() : null;

  const orderRes = await fetch(`${env.SUPABASE_URL}/rest/v1/orders`, {
    method: "POST", headers: { ...headers, "Prefer": "return=representation" },
    body: JSON.stringify({
      customer_name: name, customer_email: email, customer_phone: phone || null,
      order_type: type === "quote" ? "quote" : (enquiry_type || null),
      sku: product?.name || null, color: product?.colour || null,
      value: product?.price ? parseFloat(product.price) : null,
      permit_fee: product?.permit_fee ? parseFloat(product.permit_fee) : null,
      location: location || null,
      ...(editToken ? { edit_token: editToken } : {}),
      ...(type === "quote" && product ? { product_config: JSON.stringify(product) } : {}),
      ...(message ? { notes: message } : {}),
    }),
  });
  if (!orderRes.ok) throw new Error(`Supabase orders error ${orderRes.status}: ${await orderRes.text()}`);
  const orderRows = await orderRes.json();
  const orderId = orderRows[0]?.id || null;
  let invoiceId = null;
  if (type === "quote" && product?.price) {
    const fullAmount = parseFloat(product.price) + parseFloat(product.permit_fee || 0);
    const invRes = await fetch(`${env.SUPABASE_URL}/rest/v1/invoices`, {
      method: "POST", headers: { ...headers, "Prefer": "return=representation" },
      body: JSON.stringify({ order_id: orderId, customer_name: name, amount: fullAmount, status: "pending", issue_date: today, due_date: dueDate }),
    });
    if (!invRes.ok) { console.error(`Supabase invoices insert error ${invRes.status}: ${await invRes.text()}`); }
    else { const invRows = await invRes.json(); invoiceId = invRows[0]?.id || null; }
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
// GOHIGHLEVEL INTEGRATION
// ═══════════════════════════════════════════════════════════════════
async function createGHLContact(env, { name, email, phone, type, product }) {
  if (!env.GHL_API_KEY || !env.GHL_LOCATION_ID) return;
  const parts = name.trim().split(" ");
  const tags = ["website-lead", type === "quote" ? "quote-request" : type];
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

// ─── Helpers ──────────────────────────────────────────────────────────────────
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
