// /api/brochure — brochure download log + "Email me a copy".
//
//   POST { action: "download", source, utm, email_given, page }
//     Logged by the browser (sendBeacon) on every brochure download click.
//     Writes one row to public.brochure_downloads. Fails open: a missing table
//     (migration not applied yet) or Supabase hiccup never breaks the download.
//
//   POST { action: "email", email, source, utm, attribution, page }
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
import { adSourceCustomField, attributionCustomFields, cleanLastAttribution, deriveLeadSource, fillOnlyCustomFields, isGoogleAdsLead, lastTouchCustomFields, leadTags } from "./submit.js";
import { familyBrochureEmail } from "./_email-brand.js";
import { isTestSubmission } from "./_test-flags.js";

const SITE = "https://searsmelvin.co.uk";
const PDF_PATH = "/assets/sears-melvin-brochure.pdf?v=10.1";
const FROM = "Sears Melvin Memorials <info@searsmelvin.co.uk>";
export const SOURCES = ["header", "home", "product", "listing", "brochure_page"];
const UTM_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const GCLID_RE = /^[\w\-.~]{1,200}$/;

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

export function cleanGclid(value) {
  return typeof value === "string" && GCLID_RE.test(value) ? value : null;
}

export async function hashUserAgent(request) {
  const ua = request?.headers?.get("User-Agent") || "";
  if (!ua) return null;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(ua));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function downloadRow(env, { source, utm, emailGiven, page, gclid, gbraid, wbraid, attribution }, request) {
  const fallback = cleanUtm(attribution);
  const supplied = cleanUtm(utm);
  const u = { ...fallback, ...supplied };
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
    gclid: cleanGclid(gclid) || cleanGclid(attribution?.gclid),
    gbraid: cleanGclid(gbraid) || cleanGclid(attribution?.gbraid),
    wbraid: cleanGclid(wbraid) || cleanGclid(attribution?.wbraid),
    lead_source: deriveLeadSource({ ...(attribution || {}), ...u }),
    ...cleanLastAttribution(attribution),
    ua_hash: await hashUserAgent(request),
  };
}

export async function logDownload(env, row) {
  // Structured log line too, so Workers observability can count downloads even
  // before the migration is applied.
  console.log(JSON.stringify({ message: "brochure_download", source: row.source, email_given: row.email_given, utm_campaign: row.utm_campaign }));
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY || !env.SM_ORG_ID) return false;
  try {
    const url = `${env.SUPABASE_URL}/rest/v1/brochure_downloads`;
    const options = {
      method: "POST",
      headers: { ...supabaseHeaders(env), Prefer: "return=minimal" },
      body: JSON.stringify(row),
    };
    let res = await fetch(url, options);
    // The additive migration may lag the Worker deploy. PostgREST reports
    // unknown click-ID/ua_hash columns as 400, so retry the legacy row once.
    // Step 1: deploy safely before the last-touch/lead-source migration lands.
    if (res.status === 400) {
      const noLastTouch = Object.fromEntries(Object.entries(row).filter(([key]) => key !== "lead_source" && !key.startsWith("last_")));
      res = await fetch(url, { ...options, body: JSON.stringify(noLastTouch) });
    }
    // Step 2: drop only gbraid/wbraid so gclid still lands.
    if (res.status === 400 && ("gbraid" in row || "wbraid" in row)) {
      const { gbraid: _gbraid, wbraid: _wbraid, ...noBraid } = row;
      const compatible = Object.fromEntries(Object.entries(noBraid).filter(([key]) => key !== "lead_source" && !key.startsWith("last_")));
      res = await fetch(url, { ...options, body: JSON.stringify(compatible) });
    }
    // Step 3: legacy table without gclid/ua_hash either.
    if (res.status === 400) {
      const { gclid: _gclid, gbraid: _gbraid, wbraid: _wbraid, ua_hash: _uaHash, ...legacyRow } = row;
      const compatible = Object.fromEntries(Object.entries(legacyRow).filter(([key]) => key !== "lead_source" && !key.startsWith("last_")));
      res = await fetch(url, { ...options, body: JSON.stringify(compatible) });
    }
    if (!res.ok) console.error(JSON.stringify({ message: "brochure_download_log_failed", status: res.status }));
    return res.ok;
  } catch {
    console.error(JSON.stringify({ message: "brochure_download_log_failed" }));
    return false;
  }
}

export function brochureLink(source) {
  return `${SITE}${PDF_PATH}&utm_source=brochure_email&utm_medium=email&utm_campaign=brochure_v10&utm_content=${cleanSource(source)}`;
}

export function brochureEmailHtml(source) {
  return familyBrochureEmail({ source: cleanSource(source) }).html;
}

function isLiveSiteRequest(request) {
  try {
    const host = new URL(request.url).hostname.toLowerCase().replace(/\.$/, "");
    return host === "searsmelvin.co.uk" || host === "www.searsmelvin.co.uk";
  } catch {
    return false;
  }
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

// Brochure requests open a New Lead card in the SM Memorial Pipeline, mirroring
// createGHLOpportunity in submit.js, but never touch an existing open card:
// if the contact already has one in this pipeline we skip (no rename, no stage move).
export const SM_PIPELINE_ID = "ty7z50OQyVGXMS1NARrK";             // SM Memorial Pipeline
export const SM_NEW_LEAD_STAGE_ID = "3c1dd6af-1ccd-4acd-bf0e-96a8cb478d08"; // New Lead

export function brochureOppName(name, email) {
  const n = typeof name === "string" ? name.trim() : "";
  return `Brochure – ${n || email}`;
}

export function contactDisplayName(c) {
  if (!c || typeof c !== "object") return "";
  const parts = [c.firstName, c.lastName].filter((x) => typeof x === "string" && x.trim()).map((x) => x.trim());
  return parts.join(" ") || (typeof c.name === "string" ? c.name.trim() : "") || (typeof c.contactName === "string" ? c.contactName.trim() : "");
}

export async function createBrochureOpportunity(env, { contactId, name, email }, fetchImpl = fetch) {
  const token = env.SM_GHL_PIT_CALL_TRANSCRIPTS;
  if (!token || !contactId) return { skipped: "no_token_or_contact" };
  const headers = { Authorization: `Bearer ${token}`, Version: "2021-07-28", "Content-Type": "application/json", Accept: "application/json" };
  const params = new URLSearchParams({ location_id: SM_GHL_LOCATION_ID, contact_id: contactId, pipeline_id: SM_PIPELINE_ID, status: "open", limit: "20" });
  const found = await fetchImpl(`${GHL_BASE}/opportunities/search?${params}`, { headers });
  if (!found.ok) throw new Error(`GHL opportunity search returned ${found.status}`);
  const list = (await found.json().catch(() => ({})))?.opportunities || [];
  const open = list.find((o) => o && o.pipelineId === SM_PIPELINE_ID && o.status === "open");
  if (open) return { skipped: "open_exists", id: open.id };
  const res = await fetchImpl(`${GHL_BASE}/opportunities/`, {
    method: "POST", headers,
    body: JSON.stringify({ pipelineId: SM_PIPELINE_ID, pipelineStageId: SM_NEW_LEAD_STAGE_ID, locationId: SM_GHL_LOCATION_ID, contactId, name: brochureOppName(name, email), status: "open", monetaryValue: 0, source: "Website brochure" }),
  });
  if (!res.ok) throw new Error(`GHL opportunity create returned ${res.status}`);
  const body = await res.json().catch(() => ({}));
  return { created: true, id: body.opportunity?.id || body.id || null };
}

export async function upsertBrochureContact(env, email, meta = {}, fetchImpl = fetch) {
  const token = env.SM_GHL_PIT_CALL_TRANSCRIPTS;
  if (!token) { console.error(JSON.stringify({ message: "sm_ghl_token_missing" })); return null; }
  const headers = { Authorization: `Bearer ${token}`, Version: "2021-07-28", "Content-Type": "application/json", Accept: "application/json" };
  // gclid/gbraid/wbraid + utm_* into the SM contact attribution fields (only
  // when the browser sent any, so a plain request makes no extra GHL call).
  let customFields = await attributionCustomFields(env, meta.attribution, { token, locationId: SM_GHL_LOCATION_ID, fetchImpl });
  const lastTouchFields = await lastTouchCustomFields(env, meta.attribution, { token, locationId: SM_GHL_LOCATION_ID, fetchImpl });
  customFields.push(...await adSourceCustomField(env, meta.attribution, { token, locationId: SM_GHL_LOCATION_ID, fetchImpl }));
  const duplicate = !customFields.length ? { ok: false } : await fetchImpl(`${GHL_BASE}/contacts/search/duplicate?locationId=${encodeURIComponent(SM_GHL_LOCATION_ID)}&email=${encodeURIComponent(email)}`, { headers });
  if (duplicate.ok) {
    const foundBody = await duplicate.json().catch(() => ({}));
    const found = foundBody.contact || foundBody.contacts?.[0];
    if (found) customFields = fillOnlyCustomFields(found.customFields, customFields);
  }
  customFields.push(...lastTouchFields);
  // GHL API v2's attributionSource is read-only and is set only by GHL tracking.
  const googleAdsTags = isGoogleAdsLead(meta.attribution) ? ["source-google-ads"] : [];
  const testTags = isTestSubmission({ email, ...(meta.attribution || {}) }).is_test ? ["test-lead"] : [];
  const tags = [...new Set(["brochure-download", ...leadTags({ lead_source: deriveLeadSource(meta.attribution), lead_channel: "Brochure" }), ...googleAdsTags, ...testTags])];
  const res = await fetchImpl(`${GHL_BASE}/contacts/upsert`, {
    method: "POST", headers,
    body: JSON.stringify({ locationId: SM_GHL_LOCATION_ID, email, source: "Website brochure", tags, ...(customFields.length ? { customFields } : {}) }),
  });
  if (!res.ok) throw new Error(`GHL upsert returned ${res.status}`);
  const body = await res.json().catch(() => ({}));
  const id = body.contact?.id;
  if (!id) return null;
  // Upsert replaces tags on some API versions; add the tag explicitly too.
  await fetchImpl(`${GHL_BASE}/contacts/${encodeURIComponent(id)}/tags`, { method: "POST", headers, body: JSON.stringify({ tags: ["brochure-download", ...googleAdsTags, ...testTags] }) }).catch(() => null);
  const note = await fetchImpl(`${GHL_BASE}/contacts/${encodeURIComponent(id)}/notes`, { method: "POST", headers, body: JSON.stringify({ body: brochureNote(new Date(), meta) }) });
  if (!note.ok) console.error(JSON.stringify({ message: "sm_ghl_note_failed", status: note.status }));
  // Fail soft: an opportunity error is logged and never affects the email or contact.
  try {
    const opp = await createBrochureOpportunity(env, { contactId: id, name: contactDisplayName(body.contact), email }, fetchImpl);
    console.log(JSON.stringify({ message: "sm_ghl_brochure_opp", ...opp }));
  } catch (e) {
    console.error(JSON.stringify({ message: "sm_ghl_brochure_opp_failed", error: String(e?.message || e) }));
  }
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
      bg(context, "brochure_download_log", async () => logDownload(env, await downloadRow(env, { source: data.source, utm: data.utm, emailGiven: data.email_given === true, page: data.page, gclid: data.gclid, gbraid: data.gbraid, wbraid: data.wbraid, attribution: data.attribution }, request)));
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
    if (!isLiveSiteRequest(request)) return hardenedJson({ ok: true });
    const mail = familyBrochureEmail({ source: data.source });
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: FROM, to: email, subject: mail.subject, html: mail.html, text: mail.text }),
    });
    if (!res.ok) {
      console.error(JSON.stringify({ message: "resend_request_failed", status: res.status }));
      return hardenedJson({ ok: false, error: "Sorry, we couldn’t send that just now. Please use Just download." }, 502);
    }
    // Fail soft: runs after the email is accepted, errors are only logged.
    bg(context, "brochure_ghl_contact", () => upsertBrochureContact(env, email, { source: data.source, page: data.page, utm: data.utm, attribution: data.attribution }));
    bg(context, "brochure_download_log", async () => logDownload(env, await downloadRow(env, { source: data.source, utm: data.utm, emailGiven: true, page: data.page, gclid: data.gclid, gbraid: data.gbraid, wbraid: data.wbraid, attribution: data.attribution }, request)));
    return hardenedJson({ ok: true });
  }

  return hardenedJson({ ok: false, error: "Unknown action" }, 400);
}
