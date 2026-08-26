/**
 * Sears Melvin Memorials — Cloudflare Pages Function
 * Route: /api/submit (POST)
 */
import {
  RequestValidationError,
  checkRateLimit,
  getClientAddress,
  hardenedJson,
  isSameOriginRequest,
  rateLimitResponse,
  readBoundedJson,
} from "./_security.js";

const BUSINESS_EMAIL = "info@searsmelvin.co.uk";
const FROM_EMAIL = "info@searsmelvin.co.uk";
const BUSINESS_NAME = "Sears Melvin Memorials";
const SITE_URL = "https://searsmelvin.co.uk";

// GHL pipeline defaults. These were previously env-only, and because neither var
// was ever set in Cloudflare `createGHLOpportunity` returned early on every
// submission — no opportunity has been created since Sept 2025. Defaulting them
// here means the funnel works out of the box; env still wins if it's set.
const GHL_PIPELINE_ID_DEFAULT = "ty7z50OQyVGXMS1NARrK";              // SM Memorial Pipeline
const GHL_PIPELINE_STAGE_ID_DEFAULT = "3c1dd6af-1ccd-4acd-bf0e-96a8cb478d08"; // New Lead

// The Cemetery custom field already exists in the SM sub-account. Addressed by
// id rather than key: GHL stores keys prefixed (`contact.cemetery`) and it's
// unconfirmed whether it matches the bare keys the rest of this file sends, so
// the id is the one form guaranteed to land.
const GHL_CEMETERY_FIELD_ID_DEFAULT = "SNtzqw1uQAWjDnUPqwiK";

const STONE_COLOURS = {
  "Black Galaxy": "#1a1a1a",
  "Black": "#0d0d0d",
  "Rustenberg Grey": "#5a5a5a",
  "Grey": "#8a8a8a",
  "Vizag Blue": "#1a2a3a",
  "Indian Aurora": "#6B4423",
  "Emerald Pearl": "#1d3a2e",
  "Ruby Red": "#5a2028",
  "Bahama Blue": "#2a4a5a",
  "Tropical Green": "#2a4a3a",
};

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: { "Allow": "POST, OPTIONS" } });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!isSameOriginRequest(request)) return jsonResponse({ ok: false, error: "Forbidden" }, 403);
  if (!env.RESEND_API_KEY) {
    console.error("RESEND_API_KEY is not set");
    return jsonResponse({ ok: false, error: "Server configuration error" }, 500);
  }
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY || !env.SM_ORG_ID) {
    console.error("Supabase / SM_ORG_ID env not configured");
    return jsonResponse({ ok: false, error: "Server configuration error" }, 500);
  }
  const ipLimit = await checkRateLimit(env, request, "public-submission-ip", getClientAddress(request), {
    maxAttempts: 20,
    windowSeconds: 3600,
    blockSeconds: 3600,
    failClosed: true,
  });
  if (!ipLimit.allowed) return rateLimitResponse(jsonResponse, ipLimit.retryAfter);

  let data;
  try { data = await readBoundedJson(request, 64 * 1024); }
  catch (error) {
    const status = error instanceof RequestValidationError ? error.status : 400;
    return jsonResponse({ ok: false, error: error instanceof RequestValidationError ? error.message : "Invalid JSON" }, status);
  }
  const validation = validateSubmission(data, env.SM_ORG_ID);
  if (!validation.ok) return jsonResponse({ ok: false, error: validation.error }, 400);
  data = validation.data;
  if (!await verifyPhotoSubmissionCapabilities(env, data.photo_urls, data.photo_tokens)) {
    return jsonResponse({ ok: false, error: "Invalid photo attachment capability" }, 403);
  }
  if (!data.name || (!data.email && !data.phone))
    return jsonResponse({ ok: false, error: "Missing required fields" }, 400);
  if (data.email) {
    const emailLimit = await checkRateLimit(env, request, "public-submission-email", data.email, {
      maxAttempts: 5,
      windowSeconds: 3600,
      blockSeconds: 3600,
      failClosed: true,
    });
    if (!emailLimit.allowed) return rateLimitResponse(jsonResponse, emailLimit.retryAfter);
  }
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
    console.error(JSON.stringify({ message: "background_task_failed", task: label }));
  });
}

async function handleQuoteRequest(ctx, data, submittedAt) {
  const env = ctx.env;
  const { name, email, phone, cemetery, message, product = {}, location } = data;
  const firstName = name.split(" ")[0];
  const stoneHex = STONE_COLOURS[product.colour] || "#8B7355";
  const cemeteryOrLocation = cemetery || location || null;

  // 1. Persist the quote in a single atomic Supabase RPC — it upserts the
  // person, creates the order (carrying this edit_token) and the enquiry in one
  // transaction / one network round trip instead of ~4 sequential PostgREST
  // calls. Must complete before responding so the customer only sees
  // "submitted" once the quote actually persisted. The emails and the GHL
  // contact run in the background via ctx.waitUntil below.
  const editToken = generateToken();
  const { first_name, last_name } = splitName(name);
  try {
    const res = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/create_quote`, {
      method: "POST",
      headers: supabaseHeaders(env),
      body: JSON.stringify({
        payload: {
          organization_id: env.SM_ORG_ID,
          email, first_name, last_name, name,
          phone: phone || null,
          source_page: data.source_page || null,
          message: message || null,
          location: cemeteryOrLocation,
          cemetery_id: data.cemetery_id || null,
          edit_token: editToken,
          product,
        },
      }),
    });
    if (!res.ok) throw new Error(`create_quote RPC returned ${res.status}`);
  } catch (err) {
    console.error(JSON.stringify({ message: "quote_save_failed" }));
    return jsonResponse({ ok: false, error: "Failed to save quote. Please try again." }, 500);
  }

  // 2. Background side-effects.
  ctx.waitUntil(quoteSideEffects({
    env, name, email, phone, message, product, submittedAt,
    cemeteryOrLocation, firstName, stoneHex, editToken, cemetery, location,
  }));

  return jsonResponse({ ok: true, editToken });
}

// Runs after the response has been returned. Fires the customer + business
// emails and the GHL contact/opportunity in parallel.
async function quoteSideEffects({
  env, name, email, phone, message, product, submittedAt,
  cemeteryOrLocation, firstName, stoneHex, editToken, cemetery, location,
}) {
  const sideEffects = [
    bg("quote business email", () => sendEmail(env.RESEND_API_KEY, {
      from:    `${BUSINESS_NAME} <${FROM_EMAIL}>`,
      to:      BUSINESS_EMAIL,
      subject: `New Quote Request — ${product.name || "Memorial"} — ${name}`,
      html:    quoteBusinessEmail({ name, email, phone, location: cemeteryOrLocation, message, product, stoneHex, submittedAt }),
    })),
    bg("ghl quote contact+opportunity", async () => {
      const ghlExtraFields = [
        message              ? { key: "customer_message",   field_value: message } : null,
        product.type         ? { key: "memorial_type",      field_value: product.type } : null,
        product.font         ? { key: "font_style",         field_value: product.font } : null,
        product.letterColour ? { key: "letter_colour",      field_value: product.letterColour } : null,
        product.inscription  ? { key: "inscription_text",   field_value: product.inscription } : null,
        product.permit_fee   ? { key: "permit_fee",         field_value: `£${formatPrice(product.permit_fee)}` } : null,
        product.addons?.length ? { key: "product_addons",   field_value: product.addons.join(", ") } : null,
        product.image        ? { key: "product_image_url",  field_value: product.image } : null,
      ].filter(Boolean);
      const contactId = await createGHLContact(env, {
        name, email, phone, type: "quote", product,
        cemetery: cemeteryOrLocation,
        extraFields: ghlExtraFields,
      });
      if (contactId) {
        await createGHLOpportunity(env, {
          contactId,
          name: `${product.name || "Memorial"} — ${name}`,
          monetaryValue: parseFloat(product.price) || 0,
        });
      }
    }),
  ];
  // Phone-only requests are valid. In that case there is no customer email to
  // send, but the business notification and GHL hand-off must still complete.
  if (email) {
    sideEffects.splice(1, 0, bg("quote customer email", () => sendEmail(env.RESEND_API_KEY, {
      from:    `${BUSINESS_NAME} <${FROM_EMAIL}>`,
      to:      email,
      subject: `Your quote — ${product.name || "Memorial"} — ${BUSINESS_NAME}`,
      html:    quoteCustomerEmail({ firstName, product, stoneHex, location: cemeteryOrLocation, editToken, email }),
    })));
  }
  await Promise.allSettled(sideEffects);
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

  // Channel routing: shortlist enquiries → 'shortlist'; everything else → 'contact'.
  const isShortlist = enquiry_type === "shortlist-enquiry";
  const channel = isShortlist ? "shortlist" : "contact";

  // The shortlist panel's note field is optional in the UI, so a shortlist with
  // saved memorials and no note is a legitimate submission — it used to be
  // rejected here as "Missing required fields". For every other channel the
  // message is still the whole enquiry, so it stays required.
  const shortlistItems = isShortlist ? normaliseShortlistItems(data.details?.items) : [];
  if (!message && shortlistItems.length === 0) {
    return jsonResponse({ ok: false, error: "Missing required fields" }, 400);
  }

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
      message: message || null,
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
    console.error(JSON.stringify({ message: "enquiry_insert_failed" }));
    return jsonResponse({ ok: false, error: "Failed to save enquiry. Please try again." }, 500);
  }

  // 2. Background side-effects (emails, calendar, GHL) run after
  // the response is returned via ctx.waitUntil — keeps the customer-facing
  // latency to ~500ms instead of 3s.
  const enquiryTypeLabel = formatEnquiryTypeLabel(enquiry_type);
  ctx.waitUntil(enquirySideEffects({
    env, name, email, phone, message, location,
    enquiry_type, enquiryTypeLabel, grave_number, contact_pref, photo_urls,
    shortlistItems,
    submittedAt, appointment_date: data.appointment_date || null,
    appointment_time: data.appointment_time || null,
    appointment_at_iso: data.appointment_at || null,
    appointment_kind: data.appointment_kind || null,
  }));

  return jsonResponse({ ok: true });
}

// Runs after the response has been returned. Emails + calendar + GHL are all
// independent so they fire in parallel; photo signing is a prerequisite for
// the business email so it's chained inside that branch.
async function enquirySideEffects({
  env, name, email, phone, message, location,
  enquiry_type, enquiryTypeLabel, grave_number, contact_pref, photo_urls, shortlistItems,
  submittedAt, appointment_date, appointment_time, appointment_at_iso, appointment_kind,
}) {
  await Promise.allSettled([
    bg("enquiry business email", async () => {
      let photoSignedUrls = [];
      if (Array.isArray(photo_urls) && photo_urls.length > 0) {
        try { photoSignedUrls = await signEnquiryPhotoUrls(env, photo_urls); }
        catch { console.error(JSON.stringify({ message: "enquiry_photo_sign_failed" })); }
      }
      await sendEmail(env.RESEND_API_KEY, {
        from: `${BUSINESS_NAME} <${FROM_EMAIL}>`,
        to: BUSINESS_EMAIL,
        subject: `New Enquiry — ${enquiryTypeLabel} — ${name}`,
        html: enquiryBusinessEmail({ name, email, phone, message, enquiry_type, grave_number, location, contact_pref, photo_urls, photo_signed_urls: photoSignedUrls, shortlistItems, submittedAt }),
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
        html: enquiryCustomerEmail({ name, email, phone, message, enquiry_type, grave_number, location, contact_pref, photo_urls, shortlistItems, submittedAt }),
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
    bg("ghl enquiry contact+opportunity", async () => {
      const ghlExtraFields = [
        message      ? { key: "customer_message",  field_value: message } : null,
        enquiry_type ? { key: "enquiry_type",      field_value: enquiry_type } : null,
      ].filter(Boolean);
      const contactId = await createGHLContact(env, {
        name, email, phone, type: "enquiry",
        cemetery: location,
        extraFields: ghlExtraFields,
      });
      if (contactId) {
        await createGHLOpportunity(env, {
          contactId,
          name: `${enquiryTypeLabel} — ${name}`,
          monetaryValue: 0,
        });
      }
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
    console.error(JSON.stringify({ message: "appointment_insert_failed" }));
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
// emails + GHL then fire in parallel once the calendar resolves.
async function appointmentSideEffects({
  env, name, email, phone, notes, submittedAt,
  appointment_type, appointment_date, appointment_time,
  typeLabel, dateFormatted, firstName,
}) {
  let calendarLink = null;
  try {
    calendarLink = await createGoogleCalendarEvent(env, { name, email, phone, appointment_type, appointment_date, appointment_time, notes, typeLabel });
  } catch (err) {
    console.error(JSON.stringify({ message: "calendar_event_create_failed" }));
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
    bg("ghl appointment contact+opportunity", async () => {
      const ghlExtraFields = [
        appointment_type ? { key: "appointment_type", field_value: typeLabel } : null,
        appointment_date ? { key: "appointment_date", field_value: dateFormatted } : null,
        appointment_time ? { key: "appointment_time", field_value: appointment_time } : null,
        notes            ? { key: "appointment_notes", field_value: notes } : null,
      ].filter(Boolean);
      const contactId = await createGHLContact(env, {
        name, email, phone, type: "appointment", extraFields: ghlExtraFields,
      });
      if (contactId) {
        await createGHLOpportunity(env, {
          contactId,
          name: `${typeLabel} — ${name}`,
          monetaryValue: 0,
        });
      }
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
    throw new Error(`Google Calendar API returned ${res.status}`);
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
  if (!data.access_token) throw new Error("OAuth token refresh failed");
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
  if (!tokenData.access_token) throw new Error("Service account token failed");
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

// Deep-link back to the product page a submission came from, so both inboxes
// can click straight through to /memorials/<slug>.
//
// The slug arrives in the browser payload and `validateSubmission` only checks
// that `product` is an object — it does not vet the fields inside it. So the
// slug is re-validated here against the same pattern the quote API uses
// (`sanitiseProductConfig` in quotes.js) before it goes anywhere near an href:
// without it a crafted submission could put an arbitrary — or `javascript:` —
// URL into our own inbox. Anything that doesn't match returns "" and every
// caller then renders the plain, unlinked version.
function productPageUrl(product) {
  const slug = typeof product?.slug === "string" ? product.slug.toLowerCase().trim() : "";
  if (!/^[a-z0-9-]{1,120}$/.test(slug)) return "";
  return `${SITE_URL}/memorials/${encodeURIComponent(slug)}`;
}

// Shortlist enquiries carry the saved memorials in `details.items`. They used
// to be stored and then dropped from both emails, so the team had to open the
// CRM to see what the customer had actually saved. Normalise them here (the
// client also sends a `url` per item — ignored, we rebuild it from the slug so
// the href is always ours) and render them as links in both copies.
function normaliseShortlistItems(rawItems) {
  if (!Array.isArray(rawItems)) return [];
  return rawItems.slice(0, 20).map(item => {
    if (!item || typeof item !== "object") return null;
    const name = typeof item.name === "string" ? item.name.trim().slice(0, 160) : "";
    if (!name) return null;
    const price = typeof item.price === "string"
      ? item.price.trim().slice(0, 40)
      : (typeof item.price === "number" ? `£${formatPrice(item.price)}` : "");
    return { name, price, url: productPageUrl(item) };
  }).filter(Boolean);
}

// Renders the shortlist as a full `<tr>` so it drops straight into either
// enquiry email's outer table.
function shortlistItemsBlock(items, { heading }) {
  if (!Array.isArray(items) || items.length === 0) return "";
  const rows = items.map((item, index) => `
          <tr>
            <td width="24" valign="top" style="padding:7px 0;font-family:Arial,sans-serif;font-size:12px;color:#BBBBBB;">${index + 1}.</td>
            <td style="padding:7px 0;font-family:Arial,sans-serif;font-size:13px;color:#1A1A1A;line-height:1.5;">
              ${item.url
                ? `<a href="${item.url}" style="color:#2C2C2C;font-weight:600;text-decoration:none;">${esc(item.name)}</a>`
                : `<strong style="color:#2C2C2C;">${esc(item.name)}</strong>`}${item.price ? `<span style="color:#999999;"> &middot; ${esc(item.price)}</span>` : ""}
              ${item.url ? `<br><a href="${item.url}" style="color:#8B7355;font-size:12px;text-decoration:none;">View memorial &rarr;</a>` : ""}
            </td>
          </tr>`).join("");
  return `
      <tr><td style="padding:14px 28px 0;">
        <p style="font-size:10px;letter-spacing:0.08em;text-transform:uppercase;color:#8B7355;font-weight:700;margin:0 0 6px 0;font-family:Arial,sans-serif;">${esc(heading)} (${items.length})</p>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${rows}
        </table>
      </td></tr>`;
}

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

  // Product image: must be a full absolute URL for email clients
  const rawImage = product.image && product.image.trim() ? product.image.trim() : "";
  const imageUrl = rawImage.startsWith('http') || rawImage.startsWith('data:') ? rawImage : rawImage ? `${SITE_URL}${rawImage.startsWith('/') ? '' : '/'}${rawImage}` : "";
  const productUrl = productPageUrl(product);
  // `border="0"` + `border:0` stop Outlook drawing a blue frame around a linked
  // image, and the wrapping anchor sets its own colour so that when the client
  // blocks images the alt text falls back to brand brown rather than default
  // link blue.
  const productImg = `<img src="${imageUrl}" alt="${esc(product.name || "Memorial")}" width="360" border="0" style="display:block;width:100%;max-width:360px;height:auto;border:0;outline:none;text-decoration:none;" />`;

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

                  <!-- Product name + link back to the live product page -->
                  <p style="font-family:Georgia,Times New Roman,serif;font-size:20px;color:#2C2C2C;margin:0 0 ${productUrl ? "5px" : "14px"} 0;">${
                    productUrl
                      ? `<a href="${productUrl}" style="color:#2C2C2C;text-decoration:none;">${esc(product.name || "—")}</a>`
                      : esc(product.name || "—")
                  }</p>
                  ${productUrl ? `<p style="margin:0 0 14px 0;font-family:Arial,sans-serif;font-size:12px;line-height:1.4;">
                    <a href="${productUrl}" style="color:#8B7355;font-weight:600;text-decoration:none;">View product page &rarr;</a>
                  </p>` : ""}

                  ${imageUrl ? `<!-- Product image (also links through to the product page) -->
                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:16px;">
                    <tr>
                      <td align="center" style="background-color:#F5F3F0;border:1px solid #E0DCD5;border-radius:6px;padding:12px;">
                        ${productUrl ? `<a href="${productUrl}" style="display:block;color:#8B7355;font-family:Arial,sans-serif;font-size:13px;text-decoration:none;">${productImg}</a>` : productImg}
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
              <tr>
                <td style="padding:5px 0;color:#999999;vertical-align:top;">Cemetery</td>
                <td style="padding:5px 0;color:#1A1A1A;">${esc(location || "Not provided")}</td>
              </tr>
            </table>
          </td>
        </tr>

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

function quoteCustomerEmail({ firstName, product, stoneHex, location, editToken, email }) {
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
  const imageUrl = rawImage.startsWith('http') ? rawImage : rawImage ? `${SITE_URL}${rawImage.startsWith('/') ? '' : '/'}${rawImage}` : "";
  const productUrl = productPageUrl(product);
  // `border="0"` + `border:0` stop Outlook drawing a blue frame around a linked
  // image, and the wrapping anchor sets its own colour so that when the client
  // blocks images the alt text falls back to brand brown rather than default
  // link blue.
  const productImg = `<img src="${imageUrl}" alt="${esc(product.name || "Memorial")}" width="360" border="0" style="display:block;width:100%;max-width:360px;height:auto;border:0;outline:none;text-decoration:none;" />`;

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
            <p style="color:#555555;font-size:15px;line-height:1.7;margin:0 0 22px 0;font-family:Arial,sans-serif;">We've received your quote request for <strong style="color:#2C2C2C;">${esc(product.name || "your memorial")}</strong> and our team will be in touch within 24 hours.</p>
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
                  <p style="font-family:Georgia,Times New Roman,serif;font-size:18px;color:#2C2C2C;margin:0 0 ${productUrl ? "5px" : "14px"} 0;">${
                    productUrl
                      ? `<a href="${productUrl}" style="color:#2C2C2C;text-decoration:none;">${esc(product.name || "—")}</a>`
                      : esc(product.name || "—")
                  }</p>
                  ${productUrl ? `<p style="margin:0 0 14px 0;font-family:Arial,sans-serif;font-size:12px;line-height:1.4;">
                    <a href="${productUrl}" style="color:#8B7355;font-weight:600;text-decoration:none;">View this memorial on our website &rarr;</a>
                  </p>` : ""}

                  ${imageUrl ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:16px;">
                    <tr>
                      <td align="center" style="background-color:#ffffff;border:1px solid #E0DCD5;border-radius:6px;padding:12px;">
                        ${productUrl ? `<a href="${productUrl}" style="display:block;color:#8B7355;font-family:Arial,sans-serif;font-size:13px;text-decoration:none;">${productImg}</a>` : productImg}
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
                    ${location ? `<tr>
                      <td style="color:#999999;padding:3px 0;vertical-align:top;">Cemetery</td>
                      <td style="color:#2C2C2C;">${esc(location)}</td>
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

        <!-- Reassurance -->
        <tr>
          <td style="padding:0 28px 16px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#FAF8F5;border-radius:6px;border-left:3px solid #8B7355;">
              <tr>
                <td style="padding:12px 14px;font-family:Arial,sans-serif;font-size:13px;color:#555555;line-height:1.6;">
                  <strong style="color:#2C2C2C;">What happens next?</strong> There's nothing more you need to do right now — our team will be in touch within 24 hours to talk through your memorial. If you'd like to reach us sooner, just reply to this email or give us a call.
                </td>
              </tr>
            </table>
          </td>
        </tr>

        ${editToken ? `<!-- Edit quote link -->
        <tr>
          <td style="padding:0 28px 20px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#F5F3F0;border-radius:8px;">
              <tr>
                <td style="padding:14px 18px;font-family:Arial,sans-serif;">
                  <p style="font-size:13px;color:#555555;margin:0 0 8px;line-height:1.5;">Changed your mind about colour, size, or extras? You can update your quote at any time:</p>
                  <a href="https://searsmelvin.co.uk/quote#token=${editToken}" style="color:#8B7355;font-size:13px;font-weight:600;text-decoration:none;">Edit Your Quote &rarr;</a>
                </td>
              </tr>
            </table>
          </td>
        </tr>` : ""}

        <!-- Track quotes link -->
        <tr>
          <td style="padding:0 28px 16px;">
            <p style="font-family:Arial,sans-serif;font-size:12px;color:#999999;margin:0;text-align:center;">
              ${email ? `<a href="https://searsmelvin.co.uk/quote" style="color:#8B7355;text-decoration:none;">Access your quotes securely</a> &middot; Quote reference available in your account` : ""}
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

function enquiryBusinessEmail({ name, email, phone, message, enquiry_type, grave_number, location, contact_pref, photo_urls, photo_signed_urls, shortlistItems, submittedAt }) {
  const hasPhotos = Array.isArray(photo_signed_urls) && photo_signed_urls.length > 0;
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
      ${shortlistItemsBlock(shortlistItems, { heading: "Memorials shortlisted" })}
      ${message ? `<tr><td style="padding:12px 28px ${hasPhotos ? '4px' : '28px'};">
        <p style="font-size:10px;letter-spacing:0.08em;text-transform:uppercase;color:#8B7355;font-weight:700;margin:0 0 10px 0;font-family:Arial,sans-serif;">Message</p>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr><td style="background-color:#F5F3F0;border-radius:6px;padding:14px 16px;font-size:13px;color:#1A1A1A;line-height:1.7;font-family:Arial,sans-serif;">${esc(message).replace(/\n/g,"<br>")}</td></tr>
        </table>
      </td></tr>` : `<tr><td style="padding:0 28px ${hasPhotos ? '4px' : '20px'};font-size:0;line-height:0;">&nbsp;</td></tr>`}
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
function enquiryCustomerEmail({ name, email, phone, message, enquiry_type, grave_number, location, contact_pref, photo_urls, shortlistItems, submittedAt }) {
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
      ${shortlistItemsBlock(shortlistItems, { heading: "Memorials you shortlisted" })}
      ${message ? `<tr><td style="padding:14px 28px 8px;">
        <p style="font-size:10px;letter-spacing:0.08em;text-transform:uppercase;color:#8B7355;font-weight:700;margin:0 0 10px 0;font-family:Arial,sans-serif;">Your message</p>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr><td style="background-color:#F5F3F0;border-radius:6px;padding:14px 16px;font-size:13px;color:#1A1A1A;line-height:1.7;font-family:Arial,sans-serif;">${esc(message).replace(/\n/g,"<br>")}</td></tr>
        </table>
      </td></tr>` : ""}
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

// A few slugs already carry the word "enquiry", which the generic prettifier
// below then reads back as "Shortlist Enquiry enquiry" in the email heading.
// Override those to the bare noun so every use site — subject, badge, heading —
// reads cleanly.
const ENQUIRY_TYPE_LABELS = {
  "shortlist-enquiry": "Shortlist",
};

// Pretty-print enquiry type slugs ("new-memorial" → "New Memorial").
// Used in subject lines and email bodies so renovation submissions don't all
// read as "New Memorial" (the first option in the picker).
function formatEnquiryTypeLabel(slug) {
  if (!slug) return "General";
  if (ENQUIRY_TYPE_LABELS[slug]) return ENQUIRY_TYPE_LABELS[slug];
  return String(slug).replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

// Storage bucket where the contact form's renovation photos live. Kept in
// sync with /api/upload-photo's BUCKET constant.
const ENQUIRY_PHOTO_BUCKET = "enquiry-photos";
// Email is easy to forward. Keep embedded photo capabilities short-lived;
// authorised staff can regenerate one-hour links from the admin viewer.
const ENQUIRY_PHOTO_SIGN_TTL_S = 60 * 60 * 24 * 7;

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
    console.error(JSON.stringify({ message: "storage_batch_sign_failed", status: res.status }));
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
  if (!existingRes.ok) throw new Error(`Supabase people lookup returned ${existingRes.status}`);
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
      if (!patchRes.ok) throw new Error(`Supabase people update returned ${patchRes.status}`);
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

// Persist a non-quote submission: always a `people` row (deduped by email) plus
// an `enquiries` row. Quotes go through the atomic create_quote RPC instead
// (see handleQuoteRequest); this path covers contact, appointment and shortlist.
async function createEnquiry(env, payload) {
  // Person upsert and the best-effort cemetery lookup are independent; run them
  // concurrently. Cemetery lookup is best-effort (free-text submissions still
  // save with cemetery_id=null).
  const cemeteryNeeded = !payload.cemetery_id && payload.location;
  const [person, lookedUpCemeteryId] = await Promise.all([
    upsertPerson(env, { name: payload.name, email: payload.email, phone: payload.phone }),
    cemeteryNeeded
      ? lookupCemeteryIdByName(env, payload.location).catch(err => {
          console.error(JSON.stringify({ message: "cemetery_lookup_failed" }));
          return null;
        })
      : Promise.resolve(null),
  ]);
  if (!person) throw new Error("Person upsert returned no id");
  const resolvedCemeteryId = payload.cemetery_id ?? lookedUpCemeteryId ?? null;

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
    details: payload.details ?? null,
    order_id: null,
  };
  const enqRes = await fetch(`${env.SUPABASE_URL}/rest/v1/enquiries`, {
    method: "POST",
    headers: supabaseHeaders(env),
    body: JSON.stringify(enqBody),
  });
  if (!enqRes.ok) throw new Error(`Supabase enquiries returned ${enqRes.status}`);
  return { personId: person.id };
}

// ═══════════════════════════════════════════════════════════════════
// GOHIGHLEVEL INTEGRATION
// ═══════════════════════════════════════════════════════════════════
async function createGHLContact(env, { name, email, phone, type, product, cemetery, extraFields }) {
  if (!env.GHL_API_KEY || !env.GHL_LOCATION_ID) return null;
  const parts = name.trim().split(" ");
  const tags = ["website-lead", type === "quote" ? "quote-request" : type];
  if (product?.type) tags.push(product.type.toLowerCase().replace(/\s+/g, "-"));
  const cemeteryFieldId = env.GHL_CEMETERY_FIELD_ID || GHL_CEMETERY_FIELD_ID_DEFAULT;
  const customFields = [
    { key: "lead_type", field_value: type },
    product?.name ? { key: "memorial_product", field_value: product.name } : null,
    product?.colour ? { key: "stone_colour", field_value: product.colour } : null,
    product?.size ? { key: "memorial_size", field_value: product.size } : null,
    product?.price ? { key: "guide_price", field_value: `£${formatPrice(product.price)}` } : null,
    // Addressed by id — this field exists in GHL and is the strongest qualifier
    // on a memorial job, but nothing has ever written to it.
    cemetery && cemeteryFieldId ? { id: cemeteryFieldId, field_value: String(cemetery).trim() } : null,
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
  if (!res.ok) throw new Error(`GHL returned ${res.status}`);
  const body = await res.json();
  return body.contact?.id || null;
}

/**
 * Find this contact's existing open opportunity, if any.
 * Returns { id, pipelineStageId } or null. Fails open (returns null) on any
 * error: a duplicate opportunity is recoverable, a silently dropped lead is not.
 */
async function findOpenGHLOpportunity(env, contactId) {
  const params = new URLSearchParams({
    location_id: env.GHL_LOCATION_ID,
    contact_id: contactId,
    status: "open",
    limit: "1",
  });
  try {
    const res = await fetch(`https://services.leadconnectorhq.com/opportunities/search?${params}`, {
      headers: { "Authorization": `Bearer ${env.GHL_API_KEY}`, "Version": "2021-07-28" },
    });
    if (!res.ok) return null;
    const found = (await res.json())?.opportunities?.[0];
    return found ? { id: found.id, pipelineStageId: found.pipelineStageId } : null;
  } catch {
    return null;
  }
}

/**
 * Upsert, not create. One contact submitting four quote configurations in a day
 * (which happens — see Annette McDonald, 28–29 Jul 2026) must produce ONE
 * opportunity, not four. On update the existing stage is preserved: a deal
 * already moved to Quoted or Invoiced must not be dragged back by a new
 * submission.
 */
async function createGHLOpportunity(env, { contactId, name, monetaryValue }) {
  if (!env.GHL_API_KEY || !env.GHL_LOCATION_ID || !contactId) return;
  const pipelineId = env.GHL_PIPELINE_ID || GHL_PIPELINE_ID_DEFAULT;
  const defaultStageId = env.GHL_PIPELINE_STAGE_ID || GHL_PIPELINE_STAGE_ID_DEFAULT;
  const headers = {
    "Authorization": `Bearer ${env.GHL_API_KEY}`,
    "Version": "2021-07-28",
    "Content-Type": "application/json",
  };

  const existing = await findOpenGHLOpportunity(env, contactId);

  if (existing) {
    const res = await fetch(`https://services.leadconnectorhq.com/opportunities/${existing.id}`, {
      method: "PUT",
      headers,
      body: JSON.stringify({
        pipelineId,
        pipelineStageId: existing.pipelineStageId || defaultStageId,
        name,
        monetaryValue: monetaryValue || 0,
        status: "open",
      }),
    });
    if (!res.ok) throw new Error(`GHL Opportunity update returned ${res.status}`);
    return;
  }

  const res = await fetch("https://services.leadconnectorhq.com/opportunities/", {
    method: "POST",
    headers,
    body: JSON.stringify({
      pipelineId,
      pipelineStageId: defaultStageId,
      locationId: env.GHL_LOCATION_ID,
      contactId, name,
      monetaryValue: monetaryValue || 0,
      source: "Website",
      status: "open",
    }),
  });
  if (!res.ok) throw new Error(`GHL Opportunity returned ${res.status}`);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function validateSubmission(input, organizationId) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, error: "Invalid submission" };
  }
  const data = { ...input };
  const channel = String(data.channel || data.type || "").trim().toLowerCase();
  if (!["quote", "appointment", "call", "contact", "shortlist"].includes(channel)) {
    return { ok: false, error: "Invalid enquiry type" };
  }
  data.channel = channel;
  if (typeof data.name !== "string" || !data.name.trim() || data.name.length > 120) {
    return { ok: false, error: "A valid name is required" };
  }
  data.name = data.name.trim();
  if (data.email !== undefined && data.email !== null && data.email !== "") {
    if (typeof data.email !== "string") return { ok: false, error: "Invalid email address" };
    data.email = data.email.trim().toLowerCase();
    if (data.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) {
      return { ok: false, error: "Invalid email address" };
    }
  } else {
    data.email = "";
  }
  if (data.phone !== undefined && data.phone !== null && data.phone !== "") {
    if (typeof data.phone !== "string" || data.phone.length > 40) {
      return { ok: false, error: "Invalid phone number" };
    }
    data.phone = data.phone.trim();
  } else {
    data.phone = "";
  }
  const boundedText = [
    ["message", 5000],
    ["sub_type", 120],
    ["enquiry_type", 120],
    ["source_page", 300],
    ["location", 250],
    ["cemetery", 250],
    ["grave_number", 120],
  ];
  for (const [key, max] of boundedText) {
    if (data[key] === undefined || data[key] === null) continue;
    if (typeof data[key] !== "string" || data[key].length > max) {
      return { ok: false, error: `${key.replace(/_/g, " ")} is too long` };
    }
    data[key] = data[key].trim();
  }
  if (data.photo_urls !== undefined && data.photo_urls !== null) {
    if (!Array.isArray(data.photo_urls) || data.photo_urls.length > 10) {
      return { ok: false, error: "Too many photo attachments" };
    }
    const safeOrganizationId = String(organizationId).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const photoPathPattern = new RegExp(
      "^" + safeOrganizationId + "/\\d{4}/(?:0[1-9]|1[0-2])/[0-9a-f-]{36}-[A-Za-z0-9_.-]{1,80}$",
    );
    if (!data.photo_urls.every(path =>
      typeof path === "string"
      && path.length <= 300
      && photoPathPattern.test(path)
    )) {
      return { ok: false, error: "Invalid photo attachment" };
    }
    if (!Array.isArray(data.photo_tokens)
        || data.photo_tokens.length !== data.photo_urls.length
        || !data.photo_tokens.every(token => typeof token === "string" && /^[0-9a-f]{64}$/.test(token))) {
      return { ok: false, error: "Invalid photo attachment capability" };
    }
  } else if (data.photo_tokens !== undefined && data.photo_tokens !== null) {
    return { ok: false, error: "Invalid photo attachment capability" };
  }
  if (data.product !== undefined && (
    !data.product || typeof data.product !== "object" || Array.isArray(data.product)
  )) {
    return { ok: false, error: "Invalid product configuration" };
  }
  return { ok: true, data };
}

async function verifyPhotoSubmissionCapabilities(env, paths, tokens) {
  if (!Array.isArray(paths) || paths.length === 0) return true;
  if (!Array.isArray(tokens) || tokens.length !== paths.length) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(env.SUPABASE_SERVICE_KEY),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  for (let index = 0; index < paths.length; index++) {
    const signature = await crypto.subtle.sign(
      "HMAC",
      key,
      new TextEncoder().encode(`enquiry-photo-submit:${paths[index]}`),
    );
    const expected = Array.from(new Uint8Array(signature), byte => byte.toString(16).padStart(2, "0")).join("");
    if (!timingSafeEqual(expected, tokens[index])) return false;
  }
  return true;
}

function timingSafeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let index = 0; index < a.length; index++) diff |= a.charCodeAt(index) ^ b.charCodeAt(index);
  return diff === 0;
}

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
    console.error(JSON.stringify({ message: "resend_request_failed", status: res.status }));
    throw new Error(`Resend request failed with status ${res.status}`);
  }
}

function jsonResponse(data, status = 200) {
  return hardenedJson(data, status);
}
