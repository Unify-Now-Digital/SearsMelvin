// Brochure v5: config matches the real PDF, tracking payloads, and /api/brochure.
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import { pdfMeta } from "../scripts/brochure-meta.mjs";
import { onRequestPost, downloadRow, cleanGclid, cleanSource, brochureLink, SM_GHL_LOCATION_ID } from "../functions/api/brochure.js";

const require = createRequire(import.meta.url);
const up = require("../site-upgrades.js");

// ---- site-config.js points at real files and the meta matches the PDF.
const ctx = { window: {} };
vm.runInNewContext(readFileSync("site-config.js", "utf8"), ctx);
const cfg = ctx.window.SM_SITE_CONFIG;
for (const k of ["brochurePdfUrl", "brochureThumbUrl"]) {
  assert.match(cfg[k], /^\/assets\//, `${k} lives under /assets/`);
  assert.ok(existsSync("." + cfg[k].split("?")[0]), `${cfg[k]} exists`);
}
const meta = pdfMeta("." + cfg.brochurePdfUrl.split("?")[0]);
assert.equal(cfg.brochurePages, meta.pages, "brochurePages must match the PDF (run node scripts/brochure-meta.mjs)");
assert.equal(cfg.brochureBytes, meta.bytes, "brochureBytes must match the PDF (run node scripts/brochure-meta.mjs)");
assert.ok(meta.bytes < 3 * 1024 * 1024, "brochure stays under 3 MB");
assert.equal(up.brochureMetaLabel(21, 2357623), "21 pages · 2.2 MB");
assert.equal(up.brochureMetaLabel(1, 500000), "1 page · 0.5 MB");
assert.equal(up.brochureMetaLabel(null, 10), "");
assert.match(up.brochureMetaHtml(cfg), /sears-melvin-brochure-cover\.jpg/);

// No invented Google IDs: Ads stays unset until Arin supplies real values.
assert.equal(cfg.googleAds.conversionId, null);
assert.equal(cfg.googleAds.brochureConversionLabel, null);
assert.equal(up.adsConversionTarget(cfg.googleAds), null);
assert.equal(up.adsConversionTarget({ conversionId: "AW-123456789", brochureConversionLabel: "AbC-dEf1" }), "AW-123456789/AbC-dEf1");
assert.equal(up.adsConversionTarget({ conversionId: "G-XXXX", brochureConversionLabel: "x" }), null);

// Event payloads + sources.
for (const s of ["header", "home", "product", "listing", "brochure_page"]) {
  const ev = up.brochureEvents(cfg, s, false);
  assert.deepEqual(ev.dataLayer, [{ event: "brochure_download", source: s, email_given: false }]);
  assert.equal(ev.adsSendTo, null);
}
assert.equal(up.normaliseSource("<script>"), "brochure_page");
const adsEv = up.brochureEvents({ googleAds: { conversionId: "AW-123456789", brochureConversionLabel: "Label_1" } }, "home", true);
assert.equal(adsEv.adsSendTo, "AW-123456789/Label_1");
assert.equal(adsEv.dataLayer[0].email_given, true);
assert.deepEqual(up.readUtm("?utm_source=google&utm_medium=cpc&x=1&utm_campaign=a%20b"), { utm_source: "google", utm_medium: "cpc", utm_campaign: "a b" });
const upgradesSource = readFileSync("site-upgrades.js", "utf8");
assert.match(upgradesSource, /attribution\s*=\s*api\.getAttribution\(\)/, "download beacon reads stored attribution");
assert.match(upgradesSource, /gclid:\s*attribution\.gclid\s*\|\|\s*null/, "download beacon includes stored gclid");

// Buttons are tagged with their source; /brochure has the optional email form + "Just download".
for (const [page, src] of [["index.html", "home"], ["memorials.html", "listing"]]) {
  assert.ok(readFileSync(page, "utf8").includes(`data-brochure-source="${src}"`), `${page} tags source=${src}`);
}
const brochure = readFileSync("brochure.html", "utf8");
assert.ok(brochure.includes("data-brochure-email-form"));
assert.ok(brochure.includes("Just download"));
assert.match(brochure, /<input type="email"[^>]*>/);

// ---- /api/brochure
const env = {
  RESEND_API_KEY: "test-resend-key",
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SERVICE_KEY: "test-service-role-key",
  SM_ORG_ID: "00000000-0000-4000-8000-000000000001",
  GHL_API_KEY: "test-ghl-wrong-account",
  GHL_LOCATION_ID: "loc-other",
  SM_GHL_PIT_CALL_TRANSCRIPTS: "test-sm-pit",
};
let ghlFail = false;
let calls = [];
let allow = true;
let brochureInsertStatuses = [];
globalThis.fetch = async (input, init = {}) => {
  const url = String(input);
  calls.push({ url, body: init.body ? JSON.parse(init.body) : null });
  if (url.includes("/rpc/check_portal_rate_limit")) return Response.json([{ allowed: allow, retry_after_seconds: allow ? 0 : 60 }]);
  if (url.endsWith("/rest/v1/brochure_downloads")) return new Response(null, { status: brochureInsertStatuses.shift() || 201 });
  if (url === "https://api.resend.com/emails") return Response.json({ id: "e1" });
  if (url.startsWith("https://services.leadconnectorhq.com/")) {
    calls[calls.length - 1].auth = init.headers?.Authorization;
    if (ghlFail) return new Response("boom", { status: 500 });
    if (url.endsWith("/contacts/upsert")) return Response.json({ contact: { id: "c1" } });
    return Response.json({ ok: true });
  }
  throw new Error(`Unexpected fetch: ${url}`);
};
async function post(body, headers = {}) {
  calls = [];
  const pending = [];
  const res = await onRequestPost({
    request: new Request("https://searsmelvin.co.uk/api/brochure", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://searsmelvin.co.uk", "User-Agent": "Brochure Test Agent", ...headers },
      body: JSON.stringify(body),
    }),
    env,
    waitUntil: (p) => pending.push(p),
  });
  await Promise.all(pending);
  return { res, json: await res.json() };
}

// Download beacon logs one SM-scoped row and never stores an email.
let r = await post({ action: "download", source: "listing", utm: { utm_source: "google", evil: "x" }, gclid: "safe_GCLID-1.~", page: "/memorials", email: "x@y.com" });
assert.equal(r.res.status, 200);
let log = calls.find((c) => c.url.endsWith("/brochure_downloads"));
assert.ok(log, "download logged");
assert.equal(log.body.organization_id, env.SM_ORG_ID);
assert.equal(log.body.source, "listing");
assert.equal(log.body.utm_source, "google");
assert.equal(log.body.email_given, false);
assert.equal(log.body.gclid, "safe_GCLID-1.~");
assert.match(log.body.ua_hash, /^[a-f0-9]{64}$/);
const expectedUaHash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode("Brochure Test Agent"))), (byte) => byte.toString(16).padStart(2, "0")).join("");
assert.equal(log.body.ua_hash, expectedUaHash, "user agent is SHA-256 hashed server-side");
assert.ok(!JSON.stringify(log.body).includes("x@y.com"), "no email stored in the log");

// Bad source collapses to brochure_page.
assert.equal((await downloadRow(env, { source: "nope" })).source, "brochure_page");
assert.equal(cleanSource("HOME"), "home");
assert.equal(cleanGclid("abc_DEF-1.~"), "abc_DEF-1.~");
for (const bad of ["", "has space", "<script>", "x".repeat(201), 123]) assert.equal(cleanGclid(bad), null);
const attributedRow = await downloadRow(env, {
  source: "home", utm: { utm_source: "stored-wins" },
  attribution: { gclid: "g1", gbraid: "gb1", wbraid: "wb1", utm_source: "fallback", utm_medium: "cpc" },
});
assert.equal(attributedRow.gclid, "g1");
assert.equal(attributedRow.gbraid, "gb1");
assert.equal(attributedRow.wbraid, "wb1");
assert.equal(attributedRow.utm_source, "stored-wins");
assert.equal(attributedRow.utm_medium, "cpc");

// Until the additive migration is applied, a PostgREST 400 retries once with
// the legacy columns only.
brochureInsertStatuses = [400, 400, 201];
r = await post({ action: "download", source: "home", gclid: "retry-me" });
const fallbackLogs = calls.filter((c) => c.url.endsWith("/brochure_downloads"));
assert.equal(fallbackLogs.length, 3);
assert.equal(fallbackLogs[0].body.gclid, "retry-me");
assert.match(fallbackLogs[0].body.ua_hash, /^[a-f0-9]{64}$/);
// First retry drops only gbraid/wbraid, keeping gclid.
assert.equal(fallbackLogs[1].body.gclid, "retry-me");
assert.ok(!("gbraid" in fallbackLogs[1].body));
assert.ok(!("gclid" in fallbackLogs[2].body));
assert.ok(!("gbraid" in fallbackLogs[2].body));
assert.ok(!("wbraid" in fallbackLogs[2].body));
assert.ok(!("ua_hash" in fallbackLogs[2].body));

// Email path: Resend + GHL upsert tagged Brochure + log with email_given.
r = await post({ action: "email", email: " Jane@Example.com ", source: "brochure_page", utm: {} });
assert.equal(r.res.status, 200);
assert.equal(r.json.ok, true);
const mail = calls.find((c) => c.url === "https://api.resend.com/emails");
assert.equal(mail.body.to, "jane@example.com");
assert.match(mail.body.from, /info@searsmelvin\.co\.uk/);
assert.ok(mail.body.html.includes(brochureLink("brochure_page").replace(/&/g, "&")));
assert.match(mail.body.html, /\/assets\/sears-melvin-brochure\.pdf/);
const ghl = calls.find((c) => c.url.endsWith("/contacts/upsert"));
assert.equal(ghl.body.locationId, SM_GHL_LOCATION_ID, "SM location only");
assert.equal(ghl.auth, "Bearer test-sm-pit", "SM PIT only");
assert.equal(ghl.body.email, "jane@example.com");
assert.ok(ghl.body.tags.includes("brochure-download"));
const note = calls.find((c) => c.url.endsWith("/contacts/c1/notes"));
assert.match(note.body.body, /^Downloaded brochure on \d{4}-\d{2}-\d{2} via website/);
const oppCreate = calls.find((c) => c.url.endsWith("/opportunities/"));
assert.ok(oppCreate, "brochure email opens a New Lead opportunity");
assert.equal(oppCreate.body.pipelineId, "ty7z50OQyVGXMS1NARrK");
assert.equal(oppCreate.body.name, "Brochure – jane@example.com");
assert.equal(oppCreate.auth, "Bearer test-sm-pit", "SM PIT only");
assert.match(mail.body.html, /sm-logo\.png/);
assert.match(mail.body.html, /RQMF Registered · No\. 2263/);
assert.ok(!/namm/i.test(mail.body.html));
log = calls.find((c) => c.url.endsWith("/brochure_downloads"));
assert.equal(log.body.email_given, true);

// GHL failure never blocks the email.
ghlFail = true;
r = await post({ action: "email", email: "soft@fail.co", source: "home" });
assert.equal(r.res.status, 200);
assert.ok(calls.some((c) => c.url === "https://api.resend.com/emails"));
ghlFail = false;
// Missing SM token: email still sent, GHL skipped.
{ const t = env.SM_GHL_PIT_CALL_TRANSCRIPTS; delete env.SM_GHL_PIT_CALL_TRANSCRIPTS;
  r = await post({ action: "email", email: "no@token.co" });
  assert.equal(r.res.status, 200);
  assert.ok(!calls.some((c) => c.url.includes("leadconnectorhq")));
  env.SM_GHL_PIT_CALL_TRANSCRIPTS = t; }

// Invalid email → 400, nothing sent.
r = await post({ action: "email", email: "not-an-email" });
assert.equal(r.res.status, 400);
assert.ok(!calls.some((c) => c.url.includes("resend")));

// Rate-limited email → 429, nothing sent.
allow = false;
r = await post({ action: "email", email: "a@b.co" });
assert.equal(r.res.status, 429);
assert.ok(!calls.some((c) => c.url.includes("resend")));
allow = true;

// Cross-origin → 403.
r = await post({ action: "download" }, { Origin: "https://evil.example" });
assert.equal(r.res.status, 403);

// Log failure (table not migrated yet) never breaks the download response.
globalThis.fetch = async (input) => {
  const url = String(input);
  if (url.includes("/rpc/check_portal_rate_limit")) return Response.json([{ allowed: true }]);
  return new Response("relation does not exist", { status: 404 });
};
const origErr = console.error; console.error = () => {};
r = await post({ action: "download", source: "home" });
console.error = origErr;
assert.equal(r.res.status, 200);

// Migration exists and says it is not applied.
const mig = readFileSync("migrations/2026-10-11-add-brochure-downloads.sql", "utf8");
assert.match(mig, /NOT YET APPLIED/);
assert.match(mig, /create table if not exists public\.brochure_downloads/);
const attrMig = readFileSync("migrations/2026-10-21-brochure-downloads-gclid-ua-hash.sql", "utf8");
assert.match(attrMig, /NOT YET APPLIED \(apply after 2026-10-11 file\)/);
assert.match(attrMig, /add column if not exists gclid text/);
assert.match(attrMig, /security_invoker = true/g);
assert.match(attrMig, /with_gclid/);
assert.match(attrMig, /public\.brochure_download_daily/);
assert.match(attrMig, /3770972d-1bbd-417b-b413-297e844db285/);

console.log("brochure: ok");

// 2026-10-22: a 400 for missing gbraid/wbraid columns must keep gclid on the retry.
{
  const { logDownload } = await import("../functions/api/brochure.js");
  const bodies = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (_u, o) => { bodies.push(JSON.parse(o.body)); return { ok: bodies.length > 1, status: bodies.length > 1 ? 201 : 400 }; };
  const ok = await logDownload({ SUPABASE_URL: "https://x.supabase.co", SUPABASE_SERVICE_KEY: "k", SM_ORG_ID: "org" }, { organization_id: "org", source: "header", gclid: "G1", gbraid: "B1", wbraid: null, ua_hash: "h" });
  globalThis.fetch = realFetch;
  if (!ok || bodies.length !== 2 || bodies[1].gclid !== "G1" || "gbraid" in bodies[1]) throw new Error("gbraid retry dropped gclid");
  console.log("brochure gbraid-retry keeps gclid ok");
}
