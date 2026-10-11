// /api/brochure — brochure download log + "Email me a copy".
//
//   POST { action: "download", source, utm, email_given, page }
//     Logged by the browser (sendBeacon) on every brochure download click.
//     Writes one row to public.brochure_downloads. Fails open: a missing table
//     (migration not applied yet) or Supabase hiccup never breaks the download.
//
//   POST { action: "email", email, source, utm, page }
//     Emails the brochure link via Resend (same sender as quote emails), upserts
//     a Sears Melvin GHL contact tagged "Brochure" (same GHL_API_KEY /
//     GHL_LOCATION_ID integration the quote form uses) and logs the download
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

export function brochureEmailHtml(link) {
  return `<!doctype html><html><body style="margin:0;background:#FAF8F5;font-family:Arial,Helvetica,sans-serif;color:#2C2C2C">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #E0DCD5">
<tr><td style="background:#2C2C2C;padding:20px 28px;color:#C9A96E;font-size:14px;letter-spacing:2px;font-weight:bold">SEARS MELVIN MEMORIALS</td></tr>
<tr><td style="padding:28px">
<p style="font-size:18px;margin:0 0 16px">Your Sears Melvin brochure</p>
<p style="font-size:15px;line-height:1.6;margin:0 0 20px">Thank you for your interest. Here is your copy of our memorial brochure — designs with guide prices, what’s included and how ordering works. Take all the time you need.</p>
<p style="margin:0 0 24px"><a href="${link}" style="display:inline-block;background:#8B7355;color:#ffffff;text-decoration:none;padding:12px 22px;font-size:15px;border-radius:3px">Download the brochure (PDF)</a></p>
<p style="font-size:14px;line-height:1.6;margin:0 0 8px">When you’re ready, we’re happy to help — call <a href="tel:+442038352548" style="color:#6B5840">${PHONE}</a> or <a href="${SITE}/quote?utm_source=brochure_email&amp;utm_medium=email&amp;utm_campaign=brochure_v5" style="color:#6B5840">request a quote</a>.</p>
<p style="font-size:12px;color:#595959;line-height:1.5;margin:20px 0 0">Prices in the brochure are guide “from” prices and may change. Every memorial is bespoke — please ask for a personalised quote.</p>
</td></tr></table></td></tr></table></body></html>`;
}

async function upsertBrochureContact(env, email) {
  if (!env.GHL_API_KEY || !env.GHL_LOCATION_ID) return null;
  const res = await fetch("https://services.leadconnectorhq.com/contacts/upsert", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.GHL_API_KEY}`, Version: "2021-07-28", "Content-Type": "application/json" },
    body: JSON.stringify({ locationId: env.GHL_LOCATION_ID, email, source: "Website", tags: ["website-lead", "Brochure"] }),
  });
  if (!res.ok) throw new Error(`GHL returned ${res.status}`);
  const body = await res.json().catch(() => ({}));
  return body.contact?.id || null;
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
    bg(context, "brochure_ghl_contact", () => upsertBrochureContact(env, email));
    bg(context, "brochure_download_log", () => logDownload(env, downloadRow(env, { source: data.source, utm: data.utm, emailGiven: true, page: data.page })));
    return hardenedJson({ ok: true });
  }

  return hardenedJson({ ok: false, error: "Unknown action" }, 400);
}
