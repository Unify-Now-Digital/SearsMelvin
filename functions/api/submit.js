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
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY || !env.SM_ORG_ID) {
    console.error("Supabase / SM_ORG_ID env not configured");
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
  // Accept the new `channel` envelope or the legacy `type` field.
  const channel = data.channel || data.type;
  if (channel === "quote") return handleQuoteRequest(context, data, submittedAt);
  if (channel === "appointment" || channel === "call") return handleAppointment(context, data, submittedAt);
  return handleEnquiry(context, data, submittedAt);
}

// Background-side-effect helper. Runs `task` and swallows errors so an outer
// Promise.allSettled never blows up; returns a plain promise so callers can
// hand it to ctx.waitUntil. Preserves error logging.
function bg(label, task) {
  return Promise.resolve().then(task).catch(err => {
    console.error(`[bg ${label}]`, err);
  });
}

async function handleQuoteRequest(ctx, data, submittedAt) {
  const env = ctx.env;
  const { name, email, phone, cemetery, message, product = {}, location } = data;
  const firstName = name.split(" ")[0];
  const stoneHex = STONE_COLOURS[product.colour] || "#8B7355";
  const cemeteryOrLocation = cemetery || location || null;

  // 1. Supabase save — must complete before responding so the customer only
  // sees "submitted" when the record actually persisted. Everything else
  // (Stripe invoices, emails, ClickUp, GHL) runs in the background via
  // ctx.waitUntil so the response returns in ~500ms instead of 5–10s.
  let invoiceId = null;
  let editToken = null;
  try {
    const sbResult = await createEnquiry(env, {
      channel: "quote",
      name, email, phone,
      source_page: data.source_page || null,
      message,
      location: cemeteryOrLocation,
      cemetery_id: data.cemetery_id || null,
      product,
    });
    invoiceId = sbResult?.invoiceId || null;
    editToken = sbResult?.editToken || null;
  } catch (err) {
    console.error("Supabase insert failed:", err);
    return jsonResponse({ ok: false, error: "Failed to save quote. Please try again." }, 500);
  }

  // 2. Background side-effects.
  ctx.waitUntil(quoteSideEffects({
    env, name, email, phone, message, product, submittedAt,
    cemeteryOrLocation, firstName, stoneHex, editToken, cemetery, location,
  }));

  return jsonResponse({ ok: true, invoiceId, editToken });
}

// Runs after the response has been returned. Stripe invoice creation is the
// slowest step (multiple Stripe round-trips per invoice); the deposit and full
// invoices are created in parallel because they're independent.
async function quoteSideEffects({
  env, name, email, phone, message, product, submittedAt,
  cemeteryOrLocation, firstName, stoneHex, editToken, cemetery, location,
}) {
  // Stripe deposit + full in parallel.
  let stripeDepositUrl = null;
  let stripeFullUrl = null;
  if (env.STRIPE_SECRET_KEY) {
    const [depositRes, fullRes] = await Promise.allSettled([
      createStripeDepositInvoice(env.STRIPE_SECRET_KEY, { name, email, phone, product, location: cemeteryOrLocation, isFullInvoice: false }),
      createStripeDepositInvoice(env.STRIPE_SECRET_KEY, { name, email, phone, product, location: cemeteryOrLocation, isFullInvoice: true }),
    ]);
    if (depositRes.status === "fulfilled") stripeDepositUrl = depositRes.value;
    else console.error("Stripe deposit invoice creation failed:", depositRes.reason);
    if (fullRes.status === "fulfilled") stripeFullUrl = fullRes.value;
    else console.error("Stripe full invoice creation failed:", fullRes.reason);
  }

  // Now fire emails (need the Stripe URLs) + ClickUp + GHL in parallel.
  await Promise.allSettled([
    bg("quote business email", () => sendEmail(env.RESEND_API_KEY, {
      from:    `${BUSINESS_NAME} <${FROM_EMAIL}>`,
      to:      BUSINESS_EMAIL,
      subject: `New Quote Request — ${product.name || "Memorial"} — ${name}`,
      html:    quoteBusinessEmail({ name, email, phone, location: cemeteryOrLocation, message, product, stoneHex, submittedAt, stripeDepositUrl, stripeFullUrl }),
    })),
    bg("quote customer email", () => sendEmail(env.RESEND_API_KEY, {
      from:    `${BUSINESS_NAME} <${FROM_EMAIL}>`,
      to:      email,
      subject: `Your quote — ${product.name || "Memorial"} — ${BUSINESS_NAME}`,
      html:    quoteCustomerEmail({ firstName, product, stoneHex, stripeDepositUrl, stripeFullUrl, editToken, email }),
    })),
    bg("quote clickup task", () => createClickUpTask(env.CLICKUP_API_KEY, {
      name: `Quote Request — ${product.name || "Memorial"} — ${name}`,
      description: buildQuoteClickUpDescription({ name, email, phone, message, product, submittedAt }),
      listId: CLICKUP_LIST_ID,
    })),
    bg("ghl quote contact+opportunity", async () => {
      const ghlExtraFields = [
        message              ? { key: "customer_message",   field_value: message } : null,
        cemetery || location ? { key: "cemetery_location",  field_value: cemetery || location } : null,
        product.type         ? { key: "memorial_type",      field_value: product.type } : null,
        product.font         ? { key: "font_style",         field_value: product.font } : null,
        product.letterColour ? { key: "letter_colour",      field_value: product.letterColour } : null,
        product.inscription  ? { key: "inscription_text",   field_value: product.inscription } : null,
        product.permit_fee   ? { key: "permit_fee",         field_value: `£${formatPrice(product.permit_fee)}` } : null,
        product.addons?.length ? { key: "product_addons",   field_value: product.addons.join(", ") } : null,
        product.image        ? { key: "product_image_url",  field_value: product.image } : null,
      ].filter(Boolean);
      const contactId = await createGHLContact(env, { name, email, phone, type: "quote", product, extraFields: ghlExtraFields });
      if (contactId) {
        await createGHLOpportunity(env, {
          contactId,
          name: `${product.name || "Memorial"} — ${name}`,
          monetaryValue: parseFloat(product.price) || 0,
        });
      }
    }),
  ]);
}

async function handleEnquiry(ctx, data, submittedAt) {
  const env = ctx.env;
  const { name, email, phone, message, location } = data;
  // Accept either `enquiry_type` (legacy / shortlist) or `sub_type` (contact form
  // post-refactor) — the frontend wasn't always consistent and the business
  // notification email used to silently say "Not specified" for half of them.
  const enquiry_type = data.enquiry_type || data.sub_type || null;
  const grave_number = data.grave_number ? String(data.grave_number).trim() : null;
  const contact_pref = data.contact_pref || null;
  const photo_urls = Array.isArray(data.photo_urls) ? data.photo_urls : null;
  if (!message) return jsonResponse({ ok: false, error: "Missing required fields" }, 400);

  // Channel routing: shortlist enquiries → 'shortlist'; everything else → 'contact'.
  const isShortlist = enquiry_type === "shortlist-enquiry";
  const channel = isShortlist ? "shortlist" : "contact";

  // 1. Supabase first — save record before sending any emails. If the save
  // fails the customer should see an error (and not get a confirmation email
  // for a record that doesn't exist).
  try {
    // Merge any structured details payload with our own grave_number so reports
    // can query it cleanly. For shortlist channels keep the items list shape.
    const baseDetails = isShortlist
      ? { items: Array.isArray(data.details?.items) ? data.details.items : [] }
      : (data.details && typeof data.details === "object" ? { ...data.details } : null);
    const mergedDetails = grave_number
      ? { ...(baseDetails || {}), grave_number }
      : baseDetails;
    await createEnquiry(env, {
      channel,
      name, email, phone,
      sub_type: enquiry_type || null,
      source_page: data.source_page || null,
      message,
      contact_pref,
      location,
      cemetery_id: data.cemetery_id || null,
      // Prefer the date+time pair; fall back to ISO for legacy callers. The
      // stored ISO is built in the Worker (UTC) so it's stable and timezone-safe.
      appointment_at: data.appointment_date && data.appointment_time
        ? new Date(`${data.appointment_date}T${data.appointment_time}:00Z`).toISOString()
        : (data.appointment_at || null),
      appointment_kind: data.appointment_kind || null,
      photo_urls,
      details: mergedDetails,
    });
  } catch (err) {
    console.error("Supabase insert failed:", err);
    return jsonResponse({ ok: false, error: "Failed to save enquiry. Please try again." }, 500);
  }

  // 2. Background side-effects (emails, ClickUp, calendar, GHL) run after
  // the response is returned via ctx.waitUntil — keeps the customer-facing
  // latency to ~500ms instead of 3s.
  const enquiryTypeLabel = formatEnquiryTypeLabel(enquiry_type);
  ctx.waitUntil(enquirySideEffects({
    env, name, email, phone, message, location,
    enquiry_type, enquiryTypeLabel, grave_number, contact_pref, photo_urls,
    submittedAt, appointment_date: data.appointment_date || null,
    appointment_time: data.appointment_time || null,
    appointment_at_iso: data.appointment_at || null,
    appointment_kind: data.appointment_kind || null,
  }));

  return jsonResponse({ ok: true });
}

// Runs after the response has been returned. Emails + ClickUp + calendar +
// GHL are all independent so they fire in parallel; photo signing is a
// prerequisite for the business email so it's chained inside that branch.
async function enquirySideEffects({
  env, name, email, phone, message, location,
  enquiry_type, enquiryTypeLabel, grave_number, contact_pref, photo_urls,
  submittedAt, appointment_date, appointment_time, appointment_at_iso, appointment_kind,
}) {
  await Promise.allSettled([
    bg("enquiry business email", async () => {
      let photoSignedUrls = [];
      if (Array.isArray(photo_urls) && photo_urls.length > 0) {
        try { photoSignedUrls = await signEnquiryPhotoUrls(env, photo_urls); }
        catch (err) { console.error("Failed to sign enquiry photo URLs:", err); }
      }
      await sendEmail(env.RESEND_API_KEY, {
        from: `${BUSINESS_NAME} <${FROM_EMAIL}>`,
        to: BUSINESS_EMAIL,
        subject: `New Enquiry — ${enquiryTypeLabel} — ${name}`,
        html: enquiryBusinessEmail({ name, email, phone, message, enquiry_type, grave_number, location, contact_pref, photo_urls, photo_signed_urls: photoSignedUrls, submittedAt }),
      });
    }),
    bg("enquiry customer email", () => {
      const customerSubjectExtra = grave_number
        ? ` — Grave ${grave_number}`
        : (location ? ` — ${location}` : "");
      return sendEmail(env.RESEND_API_KEY, {
        from: `${BUSINESS_NAME} <${FROM_EMAIL}>`,
        to: email,
        subject: `${enquiryTypeLabel} enquiry${customerSubjectExtra} — ${BUSINESS_NAME}`,
        html: enquiryCustomerEmail({ name, email, phone, message, enquiry_type, grave_number, location, contact_pref, photo_urls, submittedAt }),
      });
    }),
    bg("enquiry clickup task", () => {
      const clickupLines = [
        "=== WEBSITE ENQUIRY ===",
        "",
        "CUSTOMER",
        `• Name: ${name}`,
        `• Email: ${email}`,
        `• Phone: ${phone || "Not provided"}`,
        `• Enquiry type: ${enquiryTypeLabel}`,
        grave_number ? `• Grave: ${grave_number}` : null,
        location ? `• Cemetery: ${location}` : null,
        "",
        "MESSAGE",
        message,
        "",
        "---",
        `Submitted: ${submittedAt}`,
      ].filter(l => l !== null);
      return createClickUpTask(env.CLICKUP_API_KEY, {
        name: `New Enquiry — ${enquiryTypeLabel} — ${name}`,
        description: clickupLines.join("\n"),
        listId: CLICKUP_LIST_ID,
      });
    }),
    // Calendar event if the contact form picked a slot.
    appointment_date && appointment_time
      ? bg("contact-form calendar event", () => {
          const typeLabels = { showroom: "Showroom Visit (NW11)", phone: "Phone Consultation", video: "Video Call", consultation: "Consultation" };
          const kind = appointment_kind || "showroom";
          return createGoogleCalendarEvent(env, {
            name, email, phone,
            appointment_type: kind,
            appointment_date,
            appointment_time,
            notes: message,
            typeLabel: typeLabels[kind] || kind,
          });
        })
      : (appointment_at_iso
          ? bg("contact-form calendar event (ISO)", () => createCalendarEventFromIso(env, {
              name, email, phone,
              appointmentAtIso: appointment_at_iso,
              appointmentKind: appointment_kind || "consultation",
              notes: message,
            }))
          : null),
    bg("ghl enquiry contact", () => {
      const ghlExtraFields = [
        message      ? { key: "customer_message",  field_value: message } : null,
        enquiry_type ? { key: "enquiry_type",      field_value: enquiry_type } : null,
        location     ? { key: "cemetery_location", field_value: location } : null,
      ].filter(Boolean);
      return createGHLContact(env, { name, email, phone, type: "enquiry", extraFields: ghlExtraFields });
    }),
  ].filter(Boolean));
}

// ═══════════════════════════════════════════════════════════════════
// APPOINTMENT BOOKING
// ═══════════════════════════════════════════════════════════════════

async function handleAppointment(ctx, data, submittedAt) {
  const env = ctx.env;
  const { name, email, phone, appointment_type, appointment_date, appointment_time, notes } = data;
  if (!appointment_date || !appointment_time)
    return jsonResponse({ ok: false, error: "Missing date or time" }, 400);

  const firstName = name.split(" ")[0];
  const typeLabels = { showroom: "Showroom Visit (NW11)", phone: "Phone Consultation", video: "Video Call" };
  const typeLabel = typeLabels[appointment_type] || appointment_type;
  const dateFormatted = new Date(appointment_date + "T00:00:00").toLocaleDateString("en-GB", {
    weekday: "long", day: "numeric", month: "long", year: "numeric",
  });

  // 1. Supabase save — must complete before responding.
  const apptChannel = appointment_type === "phone" ? "call" : "appointment";
  const appointmentAtIso = appointment_date && appointment_time
    ? new Date(`${appointment_date}T${appointment_time}:00`).toISOString()
    : (data.appointment_at || null);
  try {
    await createEnquiry(env, {
      channel: apptChannel,
      name, email, phone,
      sub_type: appointment_type || null,
      source_page: data.source_page || null,
      message: notes || null,
      appointment_at: appointmentAtIso,
      appointment_kind: appointment_type || null,
    });
  } catch (err) {
    console.error("Supabase appointment insert failed:", err);
    return jsonResponse({ ok: false, error: "Failed to save appointment. Please try again." }, 500);
  }

  // 2. Background side-effects.
  ctx.waitUntil(appointmentSideEffects({
    env, name, email, phone, notes, submittedAt,
    appointment_type, appointment_date, appointment_time,
    typeLabel, dateFormatted, firstName,
  }));

  return jsonResponse({ ok: true });
}

// Calendar event blocks emails because the business email links to it; the
// email + ClickUp + GHL then fire in parallel once the calendar resolves.
async function appointmentSideEffects({
  env, name, email, phone, notes, submittedAt,
  appointment_type, appointment_date, appointment_time,
  typeLabel, dateFormatted, firstName,
}) {
  let calendarLink = null;
  try {
    calendarLink = await createGoogleCalendarEvent(env, { name, email, phone, appointment_type, appointment_date, appointment_time, notes, typeLabel });
  } catch (err) {
    console.error("Google Calendar event creation failed:", err);
  }

  await Promise.allSettled([
    bg("appointment business email", () => sendEmail(env.RESEND_API_KEY, {
      from: `${BUSINESS_NAME} <${FROM_EMAIL}>`,
      to: BUSINESS_EMAIL,
      subject: `New Appointment Request — ${typeLabel} — ${dateFormatted} ${appointment_time} — ${name}`,
      html: appointmentBusinessEmail({ name, email, phone, typeLabel, dateFormatted, appointment_time, notes, submittedAt, calendarLink }),
    })),
    bg("appointment customer email", () => sendEmail(env.RESEND_API_KEY, {
      from: `${BUSINESS_NAME} <${FROM_EMAIL}>`,
      to: email,
      subject: `Appointment request — ${typeLabel} — ${dateFormatted} ${appointment_time} — ${BUSINESS_NAME}`,
      html: appointmentCustomerEmail({ firstName, typeLabel, dateFormatted, appointment_time }),
    })),
    bg("appointment clickup task", () => createClickUpTask(env.CLICKUP_API_KEY, {
      name: `Appointment — ${typeLabel} — ${name}`,
      description: `=== APPOINTMENT REQUEST ===\n\nCUSTOMER\n• Name: ${name}\n• Email: ${email}\n• Phone: ${phone || "Not provided"}\n\nAPPOINTMENT\n• Type: ${typeLabel}\n• Date: ${dateFormatted}\n• Time: ${appointment_time}\n• Notes: ${notes || "None"}\n\n---\nSubmitted: ${submittedAt}`,
      listId: CLICKUP_LIST_ID,
    })),
    bg("ghl appointment contact", () => {
      const ghlExtraFields = [
        appointment_type ? { key: "appointment_type", field_value: typeLabel } : null,
        appointment_date ? { key: "appointment_date", field_value: dateFormatted } : null,
        appointment_time ? { key: "appointment_time", field_value: appointment_time } : null,
        notes            ? { key: "appointment_notes", field_value: notes } : null,
      ].filter(Boolean);
      return createGHLContact(env, { name, email, phone, type: "appointment", extraFields: ghlExtraFields });
    }),
  ]);
}

// Lightweight wrapper around createGoogleCalendarEvent for callers that already
// have an ISO timestamp (e.g. the contact form's appointment picker, which sends
// `appointment_at` rather than separate date/time fields).
async function createCalendarEventFromIso(env, { name, email, phone, appointmentAtIso, appointmentKind, notes }) {
  if (!appointmentAtIso) return null;
  const d = new Date(appointmentAtIso);
  if (isNaN(d.getTime())) return null;
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const min = String(d.getUTCMinutes()).padStart(2, "0");
  const typeLabels = { showroom: "Showroom Visit (NW11)", phone: "Phone Consultation", video: "Video Call", consultation: "Consultation" };
  const typeLabel = typeLabels[appointmentKind] || (appointmentKind || "Consultation");
  return createGoogleCalendarEvent(env, {
    name, email, phone,
    appointment_type: appointmentKind || "consultation",
    appointment_date: `${yyyy}-${mm}-${dd}`,
    appointment_time: `${hh}:${min}`,
    notes: notes || "",
    typeLabel,
  });
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

function quoteCustomerEmail({ firstName, product, stoneHex, stripeDepositUrl, stripeFullUrl, editToken, email }) {
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

        ${stripeDepositUrl || stripeFullUrl ? `<!-- Payment options header -->
        <tr>
          <td style="padding:0 28px 12px;">
            <p style="font-size:10px;letter-spacing:0.08em;text-transform:uppercase;color:#8B7355;font-weight:700;margin:0 0 6px 0;font-family:Arial,sans-serif;">Ready to proceed?</p>
            <p style="font-family:Arial,sans-serif;font-size:13px;color:#555555;margin:0;line-height:1.6;">Choose any of the options below — there's no obligation, and you can also wait for our team to call you.</p>
          </td>
        </tr>
        <!-- Payment CTA buttons -->
        <tr>
          <td style="padding:0 28px 12px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
              ${stripeDepositUrl ? `<tr>
                <td align="center" style="background-color:#8B7355;border-radius:8px;padding:0;">
                  <a href="${stripeDepositUrl}" style="display:block;padding:16px 28px;font-family:Arial,sans-serif;font-size:16px;font-weight:700;color:#ffffff;text-decoration:none;text-align:center;border-radius:8px;">Pay 50% Deposit + Permit Fee &rarr;</a>
                </td>
              </tr>
              <tr><td style="height:10px;"></td></tr>` : ""}
              ${stripeFullUrl ? `<tr>
                <td align="center" style="background-color:#2C2C2C;border-radius:8px;padding:0;">
                  <a href="${stripeFullUrl}" style="display:block;padding:16px 28px;font-family:Arial,sans-serif;font-size:16px;font-weight:700;color:#ffffff;text-decoration:none;text-align:center;border-radius:8px;">Pay in Full &rarr;</a>
                </td>
              </tr>
              <tr><td style="height:10px;"></td></tr>` : ""}
              <tr>
                <td align="center" style="background-color:#ffffff;border:1.5px solid #E0DCD5;border-radius:8px;padding:0;">
                  <span style="display:block;padding:16px 28px;font-family:Arial,sans-serif;font-size:14px;font-weight:600;color:#2C2C2C;text-align:center;">Or simply reply — we'll be in touch within 24 hours</span>
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <!-- Deposit timeline note -->
        <tr>
          <td style="padding:0 28px 16px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#FAF8F5;border-radius:6px;border-left:3px solid #8B7355;">
              <tr>
                <td style="padding:12px 14px;font-family:Arial,sans-serif;font-size:13px;color:#555555;line-height:1.6;">
                  <strong style="color:#2C2C2C;">Please note:</strong> Production and installation timelines begin from the date the deposit is received. Outstanding balance may be required if modifications are made to the memorial after the deposit is paid.
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
              ${email ? `<a href="https://searsmelvin.co.uk/quote.html?email=${encodeURIComponent(email)}" style="color:#8B7355;text-decoration:none;">View all your quotes</a> &middot; Quote reference available in your account` : ""}
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

// Render the submission detail rows shared by the business + customer emails.
// Keeping the markup in a helper means both inboxes get the same field list,
// so the customer copy is genuinely a record of what they sent.
function enquiryDetailsRows({ enquiry_type, location, grave_number, contact_pref, photo_urls }) {
  const contactPrefLabels = { email: "Email", phone: "Phone call", appointment: "Appointment" };
  const rows = [];
  if (enquiry_type) {
    rows.push(`<tr><td width="130" style="padding:5px 0;color:#999999;vertical-align:top;">Enquiry type</td><td style="padding:5px 0;color:#1A1A1A;">${esc(formatEnquiryTypeLabel(enquiry_type))}</td></tr>`);
  }
  if (location) {
    rows.push(`<tr><td style="padding:5px 0;color:#999999;vertical-align:top;">Cemetery</td><td style="padding:5px 0;color:#1A1A1A;">${esc(location)}</td></tr>`);
  }
  if (grave_number) {
    rows.push(`<tr><td style="padding:5px 0;color:#999999;vertical-align:top;">Grave</td><td style="padding:5px 0;color:#1A1A1A;">${esc(grave_number)}</td></tr>`);
  }
  if (contact_pref) {
    rows.push(`<tr><td style="padding:5px 0;color:#999999;vertical-align:top;">Preferred reply</td><td style="padding:5px 0;color:#1A1A1A;">${esc(contactPrefLabels[contact_pref] || contact_pref)}</td></tr>`);
  }
  if (Array.isArray(photo_urls) && photo_urls.length > 0) {
    rows.push(`<tr><td style="padding:5px 0;color:#999999;vertical-align:top;">Photos attached</td><td style="padding:5px 0;color:#1A1A1A;">${photo_urls.length} file${photo_urls.length === 1 ? "" : "s"}</td></tr>`);
  }
  return rows.join("");
}

// Renders a 2-column thumbnail grid of clickable photo previews for the
// business email. Uses signed URLs (1-year TTL) so the team can open the
// full-size image straight from their inbox.
function enquiryPhotoGallery(signedUrls) {
  if (!Array.isArray(signedUrls) || signedUrls.length === 0) return "";
  const cells = signedUrls.map(url => `
    <td width="50%" valign="top" style="padding:6px;">
      <a href="${esc(url)}" target="_blank" rel="noopener" style="display:block;">
        <img src="${esc(url)}" alt="Enquiry photo" width="260" style="display:block;width:100%;max-width:260px;height:auto;border:1px solid #E0DCD5;border-radius:6px;" />
      </a>
    </td>`);
  // Pair cells into rows of 2
  let rows = "";
  for (let i = 0; i < cells.length; i += 2) {
    rows += `<tr>${cells[i] || ""}${cells[i + 1] || `<td width="50%">&nbsp;</td>`}</tr>`;
  }
  return `
      <tr><td style="padding:4px 22px 0;">
        <p style="font-size:10px;letter-spacing:0.08em;text-transform:uppercase;color:#8B7355;font-weight:700;margin:0 0 8px 6px;font-family:Arial,sans-serif;">Photos attached</p>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${rows}</table>
        <p style="font-size:11px;color:#999999;margin:6px 6px 0;font-family:Arial,sans-serif;">Click any photo to open the full-size image. Links expire in 12 months.</p>
      </td></tr>`;
}

function enquiryBusinessEmail({ name, email, phone, message, enquiry_type, grave_number, location, contact_pref, photo_urls, photo_signed_urls, submittedAt }) {
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
          <td align="right"><span style="background-color:#8B7355;color:#ffffff;padding:5px 12px;border-radius:3px;font-size:11px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;font-family:Arial,sans-serif;">${esc(formatEnquiryTypeLabel(enquiry_type))}</span></td>
        </tr></table>
      </td></tr>
      <tr><td style="padding:26px 28px 4px;">
        <h2 style="font-family:Georgia,Times New Roman,serif;font-size:22px;color:#2C2C2C;font-weight:normal;margin:0 0 4px 0;">${esc(formatEnquiryTypeLabel(enquiry_type))} enquiry</h2>
        <p style="color:#AAAAAA;font-size:12px;margin:0;font-family:Arial,sans-serif;">Received ${esc(submittedAt)}</p>
      </td></tr>
      <tr><td style="padding:16px 28px 0;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="border-top:1px solid #E0DCD5;line-height:0;font-size:0;">&nbsp;</td></tr></table>
      </td></tr>
      <tr><td style="padding:16px 28px 0;">
        <p style="font-size:10px;letter-spacing:0.08em;text-transform:uppercase;color:#8B7355;font-weight:700;margin:0 0 12px 0;font-family:Arial,sans-serif;">Customer</p>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="font-size:13px;font-family:Arial,sans-serif;">
          <tr><td width="130" style="padding:5px 0;color:#999999;">Name</td><td style="padding:5px 0;color:#1A1A1A;font-weight:600;">${esc(name)}</td></tr>
          <tr><td style="padding:5px 0;color:#999999;">Email</td><td style="padding:5px 0;"><a href="mailto:${esc(email)}" style="color:#8B7355;">${esc(email)}</a></td></tr>
          <tr><td style="padding:5px 0;color:#999999;">Phone</td><td style="padding:5px 0;color:#1A1A1A;">${esc(phone || "Not provided")}</td></tr>
          ${enquiryDetailsRows({ enquiry_type, location, grave_number, contact_pref, photo_urls })}
        </table>
      </td></tr>
      <tr><td style="padding:12px 28px ${photo_signed_urls && photo_signed_urls.length ? '4px' : '28px'};">
        <p style="font-size:10px;letter-spacing:0.08em;text-transform:uppercase;color:#8B7355;font-weight:700;margin:0 0 10px 0;font-family:Arial,sans-serif;">Message</p>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr><td style="background-color:#F5F3F0;border-radius:6px;padding:14px 16px;font-size:13px;color:#1A1A1A;line-height:1.7;font-family:Arial,sans-serif;">${esc(message).replace(/\n/g,"<br>")}</td></tr>
        </table>
      </td></tr>
      ${enquiryPhotoGallery(photo_signed_urls)}
      <tr><td style="height:24px;font-size:0;line-height:0;">&nbsp;</td></tr>
      <tr><td style="background-color:#F5F3F0;border-top:1px solid #E0DCD5;padding:14px 28px;text-align:center;">
        <span style="font-size:11px;color:#BBBBBB;font-family:Arial,sans-serif;">Sears Melvin Memorials &middot; North London (NW11) &middot; <a href="mailto:${BUSINESS_EMAIL}" style="color:#BBBBBB;">${BUSINESS_EMAIL}</a></span>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;
}

// Customer copy = receipt notice + verbatim copy of what they submitted, so
// they can see exactly what reached us. Subject line carries the enquiry type
// and an extra detail (grave / cemetery) so it stands out in their inbox.
function enquiryCustomerEmail({ name, email, phone, message, enquiry_type, grave_number, location, contact_pref, photo_urls, submittedAt }) {
  const firstName = (name || "").split(" ")[0];
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background-color:#F5F3F0;font-family:Arial,Helvetica,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#F5F3F0;padding:24px 0;">
  <tr><td align="center">
    <table role="presentation" width="580" cellpadding="0" cellspacing="0" border="0" style="max-width:580px;width:100%;background-color:#ffffff;border-radius:10px;overflow:hidden;">
      <tr><td style="background-color:#2C2C2C;padding:20px 28px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
          <td style="font-family:Georgia,Times New Roman,serif;font-size:18px;color:#ffffff;">Sears Melvin <span style="opacity:0.55;font-weight:300;">Memorials</span></td>
          <td align="right"><span style="background-color:#8B7355;color:#ffffff;padding:5px 12px;border-radius:3px;font-size:11px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;font-family:Arial,sans-serif;">Submission Received</span></td>
        </tr></table>
      </td></tr>
      <tr><td style="padding:30px 28px 6px;">
        <h2 style="font-family:Georgia,Times New Roman,serif;font-size:23px;color:#2C2C2C;font-weight:normal;margin:0 0 12px 0;">Thank you, ${esc(firstName)}.</h2>
        <p style="color:#555555;font-size:15px;line-height:1.7;margin:0 0 8px 0;font-family:Arial,sans-serif;">We've received your submission and one of our team will be in contact within 24 hours.</p>
        <p style="color:#888888;font-size:13px;line-height:1.6;margin:0 0 18px 0;font-family:Arial,sans-serif;">A copy of your enquiry is below for your records.</p>
      </td></tr>
      <tr><td style="padding:0 28px 8px;">
        <p style="font-size:10px;letter-spacing:0.08em;text-transform:uppercase;color:#8B7355;font-weight:700;margin:0 0 10px 0;font-family:Arial,sans-serif;">Your details</p>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="font-size:13px;font-family:Arial,sans-serif;">
          <tr><td width="130" style="padding:5px 0;color:#999999;vertical-align:top;">Name</td><td style="padding:5px 0;color:#1A1A1A;font-weight:600;">${esc(name)}</td></tr>
          <tr><td style="padding:5px 0;color:#999999;vertical-align:top;">Email</td><td style="padding:5px 0;color:#1A1A1A;">${esc(email)}</td></tr>
          <tr><td style="padding:5px 0;color:#999999;vertical-align:top;">Phone</td><td style="padding:5px 0;color:#1A1A1A;">${esc(phone || "Not provided")}</td></tr>
          ${enquiryDetailsRows({ enquiry_type, location, grave_number, contact_pref, photo_urls })}
          ${submittedAt ? `<tr><td style="padding:5px 0;color:#999999;vertical-align:top;">Submitted</td><td style="padding:5px 0;color:#1A1A1A;">${esc(submittedAt)}</td></tr>` : ""}
        </table>
      </td></tr>
      <tr><td style="padding:14px 28px 8px;">
        <p style="font-size:10px;letter-spacing:0.08em;text-transform:uppercase;color:#8B7355;font-weight:700;margin:0 0 10px 0;font-family:Arial,sans-serif;">Your message</p>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr><td style="background-color:#F5F3F0;border-radius:6px;padding:14px 16px;font-size:13px;color:#1A1A1A;line-height:1.7;font-family:Arial,sans-serif;">${esc(message).replace(/\n/g,"<br>")}</td></tr>
        </table>
      </td></tr>
      <tr><td style="padding:18px 28px 24px;">
        <p style="color:#555555;font-size:14px;line-height:1.7;margin:0 0 6px 0;font-family:Arial,sans-serif;">If you have any urgent questions, please call us on <strong style="color:#2C2C2C;">+44 20 3835 2548</strong>.</p>
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

function supabaseHeaders(env) {
  return {
    "apikey": env.SUPABASE_SERVICE_KEY,
    "Authorization": `Bearer ${env.SUPABASE_SERVICE_KEY}`,
    "Content-Type": "application/json",
    "Prefer": "return=minimal",
  };
}

function splitName(full) {
  const parts = (full || "").trim().split(/\s+/);
  return {
    first_name: parts[0] || null,
    last_name: parts.length > 1 ? parts.slice(1).join(" ") : "-",
  };
}

// Pretty-print enquiry type slugs ("new-memorial" → "New Memorial").
// Used in subject lines and email bodies so renovation submissions don't all
// read as "New Memorial" (the first option in the picker).
function formatEnquiryTypeLabel(slug) {
  if (!slug) return "General";
  return String(slug).replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

// Storage bucket where the contact form's renovation photos live. Kept in
// sync with /api/upload-photo's BUCKET constant.
const ENQUIRY_PHOTO_BUCKET = "enquiry-photos";
// Sign for 1 year so the team can re-open old enquiry emails without the
// thumbnail links breaking. If the team needs longer-lived access, regenerate
// from the admin viewer (which signs on demand).
const ENQUIRY_PHOTO_SIGN_TTL_S = 60 * 60 * 24 * 365;

// Resolve raw storage paths to fully qualified signed URLs the email client
// can render. Uses the batch-sign endpoint to keep this to a single round-trip
// regardless of how many photos were uploaded.
async function signEnquiryPhotoUrls(env, paths) {
  if (!Array.isArray(paths) || paths.length === 0) return [];
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) return [];
  const headers = supabaseHeaders(env);
  const res = await fetch(
    `${env.SUPABASE_URL}/storage/v1/object/sign/${ENQUIRY_PHOTO_BUCKET}`,
    {
      method: "POST",
      headers: { apikey: headers.apikey, Authorization: headers.Authorization, "Content-Type": "application/json" },
      body: JSON.stringify({ expiresIn: ENQUIRY_PHOTO_SIGN_TTL_S, paths }),
    },
  );
  if (!res.ok) {
    console.error(`Storage batch-sign error ${res.status}: ${await res.text()}`);
    return [];
  }
  const rows = await res.json();
  return (Array.isArray(rows) ? rows : [])
    .filter(r => r && r.signedURL && !r.error)
    .map(r => `${env.SUPABASE_URL}/storage/v1${r.signedURL}`);
}

// Best-effort: resolve a free-text cemetery name to a row in `public.cemeteries`.
// Falls back to null so reports can flag unmatched submissions for follow-up.
async function lookupCemeteryIdByName(env, location) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) return null;
  if (!location || typeof location !== "string") return null;
  const trimmed = location.trim();
  if (trimmed.length < 3) return null;
  const headers = supabaseHeaders(env);
  // Postgres `ilike` with the full string first (exact-ish match), then loosen.
  const tries = [
    `name=ilike.${encodeURIComponent(trimmed)}`,
    `name=ilike.${encodeURIComponent(trimmed + "%")}`,
    `name=ilike.${encodeURIComponent("%" + trimmed + "%")}`,
  ];
  for (const filter of tries) {
    const url = `${env.SUPABASE_URL}/rest/v1/cemeteries?${filter}&is_active=eq.true&select=id&limit=1`;
    const res = await fetch(url, { headers: { apikey: headers.apikey, Authorization: headers.Authorization } });
    if (!res.ok) continue;
    const rows = await res.json();
    if (rows?.[0]?.id) return rows[0].id;
  }
  return null;
}

// Upsert a retail contact into `people`, deduped by email. Never sets
// is_customer — that flag means "has paid at least once" and is owned
// exclusively by the Stripe webhook (handlePaymentSucceeded).
//
// Lookup is email-only (not scoped to organization_id). The `people` table
// has a global UNIQUE index on email, so a contact registered under any
// tenant must be reused — otherwise the INSERT below would 23505 and abort
// the entire submission. The enquiry row itself carries SM_ORG_ID, so
// multi-tenant reporting is unaffected by sharing the people record.
export async function upsertPerson(env, { name, email, phone }) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY || !env.SM_ORG_ID) return null;
  if (!email) return null;
  const normalisedEmail = email.trim().toLowerCase();
  const headers = supabaseHeaders(env);
  const { first_name, last_name } = splitName(name);

  const existingRes = await fetch(
    `${env.SUPABASE_URL}/rest/v1/people?email=eq.${encodeURIComponent(normalisedEmail)}&select=id,is_customer&limit=1`,
    { headers: { apikey: headers.apikey, Authorization: headers.Authorization } }
  );
  if (!existingRes.ok) throw new Error(`Supabase people lookup error ${existingRes.status}: ${await existingRes.text()}`);
  const existing = (await existingRes.json())[0] || null;

  if (existing) {
    const patchBody = {};
    if (first_name) patchBody.first_name = first_name;
    if (last_name && last_name !== "-") patchBody.last_name = last_name;
    if (phone) patchBody.phone = phone;
    if (Object.keys(patchBody).length > 0) {
      const patchRes = await fetch(
        `${env.SUPABASE_URL}/rest/v1/people?id=eq.${existing.id}`,
        { method: "PATCH", headers, body: JSON.stringify(patchBody) }
      );
      if (!patchRes.ok) throw new Error(`Supabase people update error ${patchRes.status}: ${await patchRes.text()}`);
    }
    return { id: existing.id, is_customer: !!existing.is_customer };
  }

  const insertRes = await fetch(`${env.SUPABASE_URL}/rest/v1/people`, {
    method: "POST",
    headers: { ...headers, Prefer: "return=representation" },
    body: JSON.stringify({
      organization_id: env.SM_ORG_ID,
      email: normalisedEmail,
      first_name,
      last_name,
      phone: phone || null,
    }),
  });
  // Race-condition fallback: a concurrent submission for the same email
  // could win the INSERT. If we hit a duplicate-key error, re-run the
  // lookup and use the row that's now there.
  if (!insertRes.ok) {
    const errBody = await insertRes.text();
    if (insertRes.status === 409 || /duplicate key|23505/i.test(errBody)) {
      const refetch = await fetch(
        `${env.SUPABASE_URL}/rest/v1/people?email=eq.${encodeURIComponent(normalisedEmail)}&select=id,is_customer&limit=1`,
        { headers: { apikey: headers.apikey, Authorization: headers.Authorization } }
      );
      if (refetch.ok) {
        const row = (await refetch.json())[0];
        if (row?.id) return { id: row.id, is_customer: !!row.is_customer };
      }
    }
    throw new Error(`Supabase people insert error ${insertRes.status}: ${errBody}`);
  }
  const inserted = (await insertRes.json())[0] || null;
  return inserted ? { id: inserted.id, is_customer: !!inserted.is_customer } : null;
}

// Create the order + invoice rows for a product quote. Isolated so non-quote
// channels never touch the orders table.
async function createOrderForQuote(env, { personId, customerName, product, location, message }) {
  const headers = supabaseHeaders(env);
  const today = new Date().toISOString().split("T")[0];
  const dueDate = new Date(Date.now() + 30 * 86400000).toISOString().split("T")[0];
  const editToken = generateToken();

  const orderRes = await fetch(`${env.SUPABASE_URL}/rest/v1/orders`, {
    method: "POST", headers: { ...headers, "Prefer": "return=representation" },
    body: JSON.stringify({
      organization_id: env.SM_ORG_ID,
      person_id: personId,
      // orders.customer_name is NOT NULL; mirror onto person_name for the
      // admin views that read either column.
      customer_name: customerName || "Website lead",
      person_name: customerName || null,
      order_type: "quote",
      sku: product?.name || null,
      color: product?.colour || null,
      value: product?.price ? parseFloat(product.price) : null,
      permit_fee: product?.permit_fee ? parseFloat(product.permit_fee) : null,
      location: location || null,
      edit_token: editToken,
      ...(product ? { product_config: JSON.stringify(product) } : {}),
      ...(message ? { notes: message } : {}),
      ...(product?.inscription ? { inscription_text: product.inscription } : {}),
    }),
  });
  if (!orderRes.ok) throw new Error(`Supabase orders error ${orderRes.status}: ${await orderRes.text()}`);
  const orderId = (await orderRes.json())[0]?.id || null;

  let invoiceId = null;
  if (product?.price) {
    const fullAmount = parseFloat(product.price) + parseFloat(product.permit_fee || 0);
    // invoices.invoice_number is NOT NULL UNIQUE. The admin app uses
    // sequential INV-NNNNNN numbers; pick a clearly-distinct prefix for
    // website-generated draft invoices so the two namespaces don't collide.
    const invoiceNumber = `INV-WEB-${Date.now().toString(36).toUpperCase()}-${generateToken().slice(0, 6).toUpperCase()}`;
    const invRes = await fetch(`${env.SUPABASE_URL}/rest/v1/invoices`, {
      method: "POST", headers: { ...headers, "Prefer": "return=representation" },
      body: JSON.stringify({
        organization_id: env.SM_ORG_ID,
        order_id: orderId,
        invoice_number: invoiceNumber,
        customer_name: customerName,
        amount: fullAmount,
        status: "pending",
        issue_date: today,
        due_date: dueDate,
      }),
    });
    if (!invRes.ok) {
      console.error(`Supabase invoices insert error ${invRes.status}: ${await invRes.text()}`);
    } else {
      invoiceId = (await invRes.json())[0]?.id || null;
    }
  }
  return { orderId, editToken, invoiceId };
}

// Single source of truth for every inbound submission. Always creates a
// `people` row (deduped by email) and an `enquiries` row. For `channel='quote'`
// also creates the order + invoice and links the enquiry to it via order_id.
async function createEnquiry(env, payload) {
  // Person upsert and cemetery lookup are independent; run in parallel to
  // shave ~150–400ms off the critical path. Cemetery lookup is best-effort
  // (free-text submissions still save with cemetery_id=null).
  const cemeteryNeeded = !payload.cemetery_id && payload.location;
  const [person, lookedUpCemeteryId] = await Promise.all([
    upsertPerson(env, { name: payload.name, email: payload.email, phone: payload.phone }),
    cemeteryNeeded
      ? lookupCemeteryIdByName(env, payload.location).catch(err => {
          console.error("Cemetery name lookup failed (non-fatal):", err);
          return null;
        })
      : Promise.resolve(null),
  ]);
  if (!person) throw new Error("Person upsert returned no id");
  const resolvedCemeteryId = payload.cemetery_id ?? lookedUpCemeteryId ?? null;

  let orderId = null, editToken = null, invoiceId = null;
  if (payload.channel === "quote") {
    ({ orderId, editToken, invoiceId } = await createOrderForQuote(env, {
      personId: person.id,
      customerName: payload.name,
      product: payload.product,
      location: payload.location,
      message: payload.message,
    }));
  }

  const headers = supabaseHeaders(env);
  const enqBody = {
    organization_id: env.SM_ORG_ID,
    person_id: person.id,
    channel: payload.channel,
    sub_type: payload.sub_type ?? null,
    source_page: payload.source_page ?? null,
    message: payload.message ?? null,
    contact_pref: payload.contact_pref ?? null,
    location: payload.location ?? null,
    cemetery_id: resolvedCemeteryId,
    appointment_at: payload.appointment_at ?? null,
    appointment_kind: payload.appointment_kind ?? null,
    photo_urls: Array.isArray(payload.photo_urls) && payload.photo_urls.length > 0 ? payload.photo_urls : null,
    details: payload.details ?? (payload.product || null),
    order_id: orderId,
  };
  const enqRes = await fetch(`${env.SUPABASE_URL}/rest/v1/enquiries`, {
    method: "POST",
    headers: { ...headers, "Prefer": "return=representation" },
    body: JSON.stringify(enqBody),
  });
  if (!enqRes.ok) throw new Error(`Supabase enquiries error ${enqRes.status}: ${await enqRes.text()}`);
  const enqRow = (await enqRes.json())[0] || null;
  return {
    personId: person.id,
    enquiryId: enqRow?.id || null,
    orderId,
    editToken,
    invoiceId,
  };
}

// ═══════════════════════════════════════════════════════════════════
// GOHIGHLEVEL INTEGRATION
// ═══════════════════════════════════════════════════════════════════
async function createGHLContact(env, { name, email, phone, type, product, extraFields }) {
  if (!env.GHL_API_KEY || !env.GHL_LOCATION_ID) return null;
  const parts = name.trim().split(" ");
  const tags = ["website-lead", type === "quote" ? "quote-request" : type];
  if (product?.type) tags.push(product.type.toLowerCase().replace(/\s+/g, "-"));
  const customFields = [
    { key: "lead_type", field_value: type },
    product?.name ? { key: "memorial_product", field_value: product.name } : null,
    product?.colour ? { key: "stone_colour", field_value: product.colour } : null,
    product?.size ? { key: "memorial_size", field_value: product.size } : null,
    product?.price ? { key: "guide_price", field_value: `£${formatPrice(product.price)}` } : null,
    ...(extraFields || []),
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
  const body = await res.json();
  return body.contact?.id || null;
}

async function createGHLOpportunity(env, { contactId, name, monetaryValue }) {
  if (!env.GHL_API_KEY || !env.GHL_PIPELINE_ID || !env.GHL_PIPELINE_STAGE_ID || !contactId) return;
  const res = await fetch("https://services.leadconnectorhq.com/opportunities/", {
    method: "POST",
    headers: { "Authorization": `Bearer ${env.GHL_API_KEY}`, "Version": "2021-07-28", "Content-Type": "application/json" },
    body: JSON.stringify({
      pipelineId: env.GHL_PIPELINE_ID,
      pipelineStageId: env.GHL_PIPELINE_STAGE_ID,
      locationId: env.GHL_LOCATION_ID,
      contactId, name,
      monetaryValue: monetaryValue || 0,
      source: "Website",
      status: "open",
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

  // Deposit structure:
  //   • Memorial value (base + addons + lettering): charged 50% on deposit, 50% on completion.
  //   • Cemetery permit fee: charged 100% on deposit (we have to pay it upfront to the cemetery).
  // Full-payment invoice charges 100% of everything.
  const memorialMultiplier = isFullInvoice ? 1 : 0.5;
  const permitMultiplier = 1; // always full
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
    : `Sears Melvin Memorials — Deposit + permit fee — ${productDescription}`;
  const invoiceFooter = isFullInvoice
    ? "Thank you for choosing Sears Melvin Memorials. All prices include installation. Balance due within 30 days."
    : "Thank you for choosing Sears Melvin Memorials. This invoice covers a 50% deposit on the memorial plus the cemetery permit fee in full. The remaining 50% memorial balance is due on completion. Your installation timeline begins once the deposit is confirmed.";

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
    unit_amount: String(Math.round(basePricePence * memorialMultiplier)),
    currency: "gbp",
  });
  await stripePost("/invoiceitems", {
    customer: customerId,
    invoice: invoice.id,
    price: basePrice.id,
    description: productDescription + " (inc. installation)" + label,
  });

  // Create permit fee line item — always 100% of the fee, even on a deposit invoice.
  if (permitFeePence > 0) {
    const permitProduct = await findOrCreateStripeProduct("Cemetery Permit Fee", "permit");
    const permitPrice = await stripePost("/prices", {
      product: permitProduct.id,
      unit_amount: String(Math.round(permitFeePence * permitMultiplier)),
      currency: "gbp",
    });
    await stripePost("/invoiceitems", {
      customer: customerId,
      invoice: invoice.id,
      price: permitPrice.id,
      description: "Cemetery Permit Fee (paid in full)",
    });
  }

  // Create Stripe Products + Prices for each addon line item
  for (const addon of addonItems) {
    const addonPence = Math.round(parseFloat(addon.price || 0) * 100);
    if (addonPence > 0) {
      const addonProduct = await findOrCreateStripeProduct(addon.name || "Add-on", "addon");
      const addonPrice = await stripePost("/prices", {
        product: addonProduct.id,
        unit_amount: String(Math.round(addonPence * memorialMultiplier)),
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
