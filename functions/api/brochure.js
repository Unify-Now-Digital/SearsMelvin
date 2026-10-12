// /api/brochure — brochure download log + "Email me a copy".
//
//   POST { action: "download", source, utm, email_given, page }
//     Logged by the browser (sendBeacon) on every brochure download click.
//     Writes one row to public.brochure_downloads. Fails open: a missing table
//     (migration not applied yet) or Supabase hiccup never breaks the download.
//
//   POST { action: "email", email, source, utm, page }
//     Emails the brochure link via Resend (same sender as quote emails), then
//     (fail-soft, in the background) upserts the contact by email into SM GHL
//     (location 7JJQ1fkS2z8zv5XIDV0P, secret SM_GHL_PIT_CALL_TRANSCRIPTS), tags it
//     "brochure-download" and adds a dated note; no opportunity. Logs the download
//     with email_given = true. The email address itself is NOT stored in
//     brochure_downloads — only that one was given.
import {
  checkRateLimit,
  getClientAddress,
  hardenedJson,
  isSameOriginRequest,
  rateLimitResponse,
  readBoundedJson,
  RequestValidationError,
  supabaseHeaders,
} from "./_security.js";

const SITE = "https://searsmelvin.co.uk";
const PDF_PATH = "/assets/sears-melvin-brochure.pdf";
const FROM = "Sears Melvin Memorials <info@searsmelvin.co.uk>";
const PHONE = "020 3835 2548";
export const SOURCES = ["header", "home", "product", "listing", "brochure_page"];
const UTM_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function cleanSource(s) {
  s = String(s || "").toLowerCase();
  return SOURCES.includes(s) ? s : "brochure_page";
}

export function cleanUtm(utm) {
  const out = {};
  if (!utm || typeof utm !== "object" || Array.isArray(utm)) return out;
  for (const k of UTM_KEYS) {
    if (typeof utm[k] === "string" && utm[k].trim()) out[k] = utm[k].trim().slice(0, 100);
  }
  return out;
}

export function downloadRow(env, { source, utm, emailGiven, page }) {
  const u = cleanUtm(utm);
  return {
    organization_id: env.SM_ORG_ID || null,
    source: cleanSource(source),
    utm_source: u.utm_source || null,
    utm_medium: u.utm_medium || null,
    utm_campaign: u.utm_campaign || null,
    utm_term: u.utm_term || null,
    utm_content: u.utm_content || null,
    email_given: emailGiven === true,
    page_path: typeof page === "string" && /^\/[\w\-/.]{0,200}$/.test(page) ? page : null,
  };
}

async function logDownload(env, row) {
  // Structured log line too, so Workers observability can count downloads even
  // before the migration is applied.
  console.log(JSON.stringify({ message: "brochure_download", source: row.source, email_given: row.email_given, utm_campaign: row.utm_campaign }));
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY || !env.SM_ORG_ID) return false;
  try {
    const res = await fetch(`${env.SUPABASE_URL}/rest/v1/brochure_downloads`, {
      method: "POST",
      headers: { ...supabaseHeaders(env), Prefer: "return=minimal" },
      body: JSON.stringify(row),
    });
    if (!res.ok) console.error(JSON.stringify({ message: "brochure_download_log_failed", status: res.status }));
    return res.ok;
  } catch {
    console.error(JSON.stringify({ message: "brochure_download_log_failed" }));
    return false;
  }
}

export function brochureLink(source) {
  return `${SITE}${PDF_PATH}?utm_source=brochure_email&utm_medium=email&utm_campaign=brochure_v5&utm_content=${cleanSource(source)}`;
}

const LOGO_URL = "https://bfwohzcugtwbhhxdqgme.supabase.co/storage/v1/object/public/product-images/brand/sm-logo.png";
const COVER_URL = `${SITE}/assets/sears-melvin-brochure-cover.jpg`;

// Gmail-safe: tables, inline styles, no background images, explicit colours on
// every text node so dark-mode inversion keeps contrast.
export function brochureEmailHtml(link) {
  const quote = `${SITE}/quote?utm_source=brochure_email&amp;utm_medium=email&amp;utm_campaign=brochure_v5`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark"><title>Your Sears Melvin brochure</title></head>
<body style="margin:0;padding:0;background:#F3EFE9;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:#F3EFE9">Your copy of the Sears Melvin memorial brochure: designs, guide prices and how ordering works.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#F3EFE9;"><tr><td align="center" style="padding:28px 12px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background:#FFFFFF;border:1px solid #E0DCD5;">
<tr><td align="center" bgcolor="#1A1A1A" style="background:#1A1A1A;padding:26px 24px 22px;">
<img src="${LOGO_URL}" width="64" height="64" alt="Sears Melvin Memorials" style="display:block;border:0;width:64px;height:64px;margin:0 auto 10px;">
<div style="font-family:Georgia,'Times New Roman',serif;font-size:20px;line-height:1.3;color:#FAF8F5;letter-spacing:0.5px;">Sears Melvin <span style="color:#C9A96E;">Memorials</span></div>
</td></tr>
<tr><td style="padding:32px 32px 8px;font-family:Arial,Helvetica,sans-serif;">
<h1 style="margin:0 0 14px;font-family:Georgia,'Times New Roman',serif;font-weight:normal;font-size:26px;line-height:1.3;color:#2C2C2C;">Your brochure is ready</h1>
<p style="margin:0 0 22px;font-size:15px;line-height:1.65;color:#3D3D3D;">Thank you for your interest. Here is your copy of our memorial brochure — designs with guide prices, what’s included and how ordering works. Take all the time you need.</p>
</td></tr>
<tr><td align="center" style="padding:0 32px 8px;">
<a href="${link}" style="text-decoration:none;"><img src="${COVER_URL}" width="200" alt="Sears Melvin memorial brochure cover" style="display:block;border:1px solid #E0DCD5;width:200px;max-width:60%;height:auto;margin:0 auto;"></a>
</td></tr>
<tr><td align="center" style="padding:24px 32px 6px;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" bgcolor="#2C2C2C" style="background:#2C2C2C;border-radius:3px;">
<a href="${link}" style="display:inline-block;padding:16px 34px;font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:bold;letter-spacing:1px;text-transform:uppercase;color:#FFFFFF;text-decoration:none;border-radius:3px;">Download the brochure</a>
</td></tr></table>
<p style="margin:10px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#6B6B6B;">PDF · 21 pages · 2.2 MB</p>
</td></tr>
<tr><td style="padding:26px 32px 4px;font-family:Arial,Helvetica,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-top:1px solid #E0DCD5;"><tr><td style="padding-top:20px;font-size:14px;line-height:1.65;color:#3D3D3D;">
When you’re ready, we’re happy to help — call <a href="tel:+442038352548" style="color:#6B5840;font-weight:bold;text-decoration:none;">${PHONE}</a>, email <a href="mailto:info@searsmelvin.co.uk" style="color:#6B5840;text-decoration:none;">info@searsmelvin.co.uk</a> or <a href="${quote}" style="color:#6B5840;">request a quote</a>.
</td></tr></table>
</td></tr>
<tr><td style="padding:18px 32px 28px;font-family:Arial,Helvetica,sans-serif;">
<p style="margin:0;font-size:12px;line-height:1.5;color:#6B6B6B;">Prices in the brochure are guide “from” prices and may change. Every memorial is bespoke — please ask for a personalised quote.</p>
</td></tr>
<tr><td align="center" bgcolor="#F3EFE9" style="background:#F3EFE9;padding:18px 24px;font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:1.6;color:#6B6B6B;">
Sears Melvin Memorials · North London · <a href="${SITE}" style="color:#6B5840;text-decoration:none;">searsmelvin.co.uk</a><br>RQMF Registered · No. 2263
</td></tr>
</table></td></tr></table></body></html>`;
}

// SM GHL (Sears Melvin location only). Uses the SM private integration token
// from the Pages secret SM_GHL_PIT_CALL_TRANSCRIPTS; location is fixed so a
// wrong token can never write into another sub-account.
export const SM_GHL_LOCATION_ID = "7JJQ1fkS2z8zv5XIDV0P";
const GHL_BASE = "https://services.leadconnectorhq.com";

export function brochureNote(date, { source, page, utm } = {}) {
  const d = (date instanceof Date ? date : new Date()).toISOString().slice(0, 10);
  const lines = [`Downloaded brochure on ${d} via website`];
  lines.push(`Source: ${cleanSource(source)}`);
  if (typeof page === "string" && /^\/[\w\-/.]{0,200}$/.test(page)) lines.push(`Page: ${page}`);
  const u = cleanUtm(utm);
  for (const k of Object.keys(u)) lines.push(`${k}: ${u[k]}`);
  return lines.join("\n");
}

export async function upsertBrochureContact(env, email, meta = {}, fetchImpl = fetch) {
  const token = env.SM_GHL_PIT_CALL_TRANSCRIPTS;
  if (!token) { console.error(JSON.stringify({ message: "sm_ghl_token_missing" })); return null; }
  const headers = { Authorization: `Bearer ${token}`, Version: "2021-07-28", "Content-Type": "application/json", Accept: "application/json" };
  const res = await fetchImpl(`${GHL_BASE}/contacts/upsert`, {
    method: "POST", headers,
    body: JSON.stringify({ locationId: SM_GHL_LOCATION_ID, email, source: "Website brochure", tags: ["brochure-download"] }),
  });
  if (!res.ok) throw new Error(`GHL upsert returned ${res.status}`);
  const body = await res.json().catch(() => ({}));
  const id = body.contact?.id;
  if (!id) return null;
  // Upsert replaces tags on some API versions; add the tag explicitly too.
  await fetchImpl(`${GHL_BASE}/contacts/${encodeURIComponent(id)}/tags`, { method: "POST", headers, body: JSON.stringify({ tags: ["brochure-download"] }) }).catch(() => null);
  const note = await fetchImpl(`${GHL_BASE}/contacts/${encodeURIComponent(id)}/notes`, { method: "POST", headers, body: JSON.stringify({ body: brochureNote(new Date(), meta) }) });
  if (!note.ok) console.error(JSON.stringify({ message: "sm_ghl_note_failed", status: note.status }));
  return id;
}

function bg(context, label, fn) {
  const task = Promise.resolve().then(fn).catch((e) => console.error(JSON.stringify({ message: `${label}_failed`, error: String(e?.message || e) })));
  if (typeof context.waitUntil === "function") context.waitUntil(task);
  return task;
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: { Allow: "POST, OPTIONS" } });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!isSameOriginRequest(request)) return hardenedJson({ ok: false, error: "Forbidden" }, 403);
  let data;
  try { data = await readBoundedJson(request, 4 * 1024); }
  catch (error) {
    const status = error instanceof RequestValidationError ? error.status : 400;
    return hardenedJson({ ok: false, error: "Invalid request" }, status);
  }
  const ip = getClientAddress(request);

  if (data.action === "download") {
    const limit = env.SUPABASE_URL ? await checkRateLimit(env, request, "brochure-log-ip", ip, { maxAttempts: 30, windowSeconds: 3600, blockSeconds: 3600, failClosed: false }) : { allowed: true };
    if (limit.allowed) {
      bg(context, "brochure_download_log", () => logDownload(env, downloadRow(env, { source: data.source, utm: data.utm, emailGiven: data.email_given === true, page: data.page })));
    }
    return hardenedJson({ ok: true });
  }

  if (data.action === "email") {
    const email = typeof data.email === "string" ? data.email.trim().toLowerCase() : "";
    if (!email || email.length > 254 || !EMAIL_RE.test(email)) return hardenedJson({ ok: false, error: "Please enter a valid email address." }, 400);
    if (!env.RESEND_API_KEY) {
      console.error("RESEND_API_KEY is not set");
      return hardenedJson({ ok: false, error: "Email is unavailable right now — please use Just download." }, 503);
    }
    // Rate limiting is mandatory for the email path: without Supabase there is
    // no limiter, so refuse rather than become an open mail relay.
    if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) {
      console.error("brochure email disabled: rate limiter unavailable");
      return hardenedJson({ ok: false, error: "Email is unavailable right now — please use Just download." }, 503);
    }
    const ipLimit = await checkRateLimit(env, request, "brochure-email-ip", ip, { maxAttempts: 5, windowSeconds: 3600, blockSeconds: 3600, failClosed: true });
    if (!ipLimit.allowed) return rateLimitResponse(hardenedJson, ipLimit.retryAfter);
    // Per-recipient cap so rotating IPs cannot mail-bomb one address (or spam GHL).
    const rcptLimit = await checkRateLimit(env, request, "brochure-email-rcpt", email, { maxAttempts: 2, windowSeconds: 86400, blockSeconds: 86400, failClosed: true });
    if (!rcptLimit.allowed) return hardenedJson({ ok: true });
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: FROM, to: email, subject: "Your Sears Melvin brochure", html: brochureEmailHtml(brochureLink(data.source)) }),
    });
    if (!res.ok) {
      console.error(JSON.stringify({ message: "resend_request_failed", status: res.status }));
      return hardenedJson({ ok: false, error: "Sorry, we couldn’t send that just now. Please use Just download." }, 502);
    }
    // Fail soft: runs after the email is accepted, errors are only logged.
    bg(context, "brochure_ghl_contact", () => upsertBrochureContact(env, email, { source: data.source, page: data.page, utm: data.utm }));
    bg(context, "brochure_download_log", () => logDownload(env, downloadRow(env, { source: data.source, utm: data.utm, emailGiven: true, page: data.page })));
    return hardenedJson({ ok: true });
  }

  return hardenedJson({ ok: false, error: "Unknown action" }, 400);
}
