import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const up = require("../site-upgrades.js");

// Reviews: nothing renders until real figures are configured.
assert.equal(up.reviewsHtml({ rating: null, count: null }), "");
assert.equal(up.reviewsHtml(undefined), "");
assert.equal(up.reviewsHtml({ rating: 4.9, count: 0 }), "");
assert.equal(up.reviewsHtml({ rating: 7, count: 10 }), "");
const r = up.reviewsHtml({ rating: 4.8, count: 12, url: "javascript:alert(1)" });
assert.match(r, /4\.8 on Google · 12 reviews/);
assert.doesNotMatch(r, /javascript:/);

// Shipped config must not carry invented review numbers.
const ctx = { window: {} };
vm.runInNewContext(readFileSync("site-config.js", "utf8"), ctx);
assert.equal(up.reviewsConfigured(ctx.window.SM_SITE_CONFIG.googleReviews), false, "review figures must stay unset until Arin supplies them");

// Team: placeholders never show on the production host.
const teamCtx = { window: {} };
vm.runInNewContext(readFileSync("data/team.js", "utf8"), teamCtx);
const team = teamCtx.window.SM_TEAM;
assert.ok(team.length >= 2 && team.length <= 4);
assert.equal(up.visibleTeam(team, "searsmelvin.co.uk").length, team.filter((m) => !m.placeholder).length);
assert.equal(up.visibleTeam(team, "www.searsmelvin.co.uk").filter((m) => m.placeholder).length, 0);
assert.equal(up.visibleTeam(team, "preview.workers.dev").length, team.length);
assert.match(up.teamHtml([{ name: "<b>x</b>", role: "r", line: "l" }]), /&lt;b&gt;/);

// Listing cards carry the price honesty line.
const listing = readFileSync("memorials.html", "utf8");
assert.ok(listing.includes("Cemetery permit fees are extra and vary by cemetery."));

// /about and /brochure exist, and the main public navigation stays consistent.
assert.ok(existsSync("about.html") && existsSync("brochure.html"));
for (const page of ["index.html", "memorials.html", "memorial.html", "contact.html"]) {
  const html = readFileSync(page, "utf8");
  assert.ok(html.includes('href="/about"'), `${page} links /about`);
  assert.ok(html.includes('class="nav-cta'), `${page} keeps the quote CTA`);
  assert.ok(html.includes('>Get a quote</a>'), `${page} labels the quote CTA consistently`);
  assert.ok(html.includes('<a href="tel:+442038352548">020 3835 2548</a>'), `${page} keeps the tracked phone link`);
}
assert.match(readFileSync("functions/sitemap.xml.js", "utf8"), /path: "\/about"/);

// Quote popup shows product preview; no WhatsApp anywhere new.
const memorial = readFileSync("memorial.html", "utf8");
assert.ok(memorial.includes('id="quoteProductPreview"'));
for (const f of ["about.html", "brochure.html", "site-upgrades.js", "site-config.js"]) {
  assert.doesNotMatch(readFileSync(f, "utf8"), /whatsapp/i);
}
console.log("site-upgrades: ok");

// Ads attribution: click IDs + UTMs captured, kept 90 days.
const fa = up.readAttribution("?gclid=Cj0_abc-1&utm_source=google&wbraid=bad%20id&foo=1");
assert.deepEqual(fa, { gclid: "Cj0_abc-1", utm_source: "google" });
const t0 = 1_000_000;
const rec = up.mergeAttribution(null, fa, t0);
assert.equal(up.mergeAttribution(rec, {}, t0 + up.ATTR_TTL_MS - 1), rec);
assert.equal(up.mergeAttribution(rec, {}, t0 + up.ATTR_TTL_MS), null);
assert.deepEqual(up.attributionFields(up.mergeAttribution(rec, { gbraid: "x1" }, t0 + 5)), { gbraid: "x1" });
// First touch kept: a later UTM-only visit fills gaps but never overwrites it.
assert.equal(up.mergeAttribution(rec, { utm_source: "facebook" }, t0 + 10), rec);
const filled = up.mergeAttribution(rec, { utm_source: "facebook", utm_medium: "cpc" }, t0 + 10);
assert.deepEqual(up.attributionFields(filled), { gclid: "Cj0_abc-1", utm_source: "google", utm_medium: "cpc" });
assert.equal(filled.ts, t0);
assert.deepEqual(up.mergeLastAttribution(null, { gclid: "first", utm_source: "google" }, t0), { ts: t0, gclid: "first", utm_source: "google" });
assert.deepEqual(up.mergeLastAttribution({ ts: t0, gclid: "first" }, { utm_campaign: "later" }, t0 + 1), { ts: t0 + 1, utm_campaign: "later" });
// A new click ID refreshes the record and restarts the 90 days.
const rec2 = up.mergeAttribution(rec, { wbraid: "w2", utm_source: "google" }, t0 + 20);
assert.deepEqual(up.attributionFields(rec2), { wbraid: "w2", utm_source: "google" });
assert.equal(rec2.ts, t0 + 20);
const upgradesSource = readFileSync("site-upgrades.js", "utf8");
assert.match(upgradesSource, /\['gclid', 'gbraid', 'wbraid', 'utm_source'/, "stored attribution exposes every last-touch click ID");
assert.match(upgradesSource, /sendBeacon\('\/api\/click-intent', json\)/, "click intent beacon uses a plain string body");
assert.doesNotMatch(upgradesSource, /sendBeacon\('\/api\/click-intent', new Blob/);
// Expired first touch is replaced by any fresh UTMs.
assert.deepEqual(up.attributionFields(up.mergeAttribution(rec, { utm_source: "bing" }, t0 + up.ATTR_TTL_MS)), { utm_source: "bing" });
// Every public form sends the stored attribution.
for (const f of ["contact.html", "memorial.html", "memorials.html", "index.html"]) {
  assert.match(readFileSync(f, "utf8"), /attribution: \(window\.SMUpgrades && window\.SMUpgrades\.getAttribution\)/, `${f} sends attribution`);
}
assert.match(readFileSync("site-upgrades.js", "utf8"), /action: 'email'[^\n]*attribution: attribution/);

// Floating brochure button
assert.equal(up.fabAllowed("/"), true);
assert.equal(up.fabAllowed("/index.html"), true);
for (const p of ["/about", "/memorials", "/memorials/the-castell", "/quote", "/contact", "/memorial.html"]) assert.equal(up.fabAllowed(p), false, p);
assert.equal(up.fabAllowed("/brochure"), false);
assert.equal(up.fabAllowed("/brochure/"), false);
assert.equal(up.fabAllowed("/brochure.html"), false);
assert.match(up.fabHtml(), /aria-label="View our brochure"/);
assert.match(up.fabHtml(), /href="\/brochure"/);
console.log("fab: ok");

// Call tracking: Google's forwarding-number swap only matches "020 3835 2548",
// so every visible/clickable number on the site uses that format.
import { execSync } from "node:child_process";
for (const f of execSync("git ls-files '*.html'").toString().split("\n").filter(Boolean)) {
  const html = readFileSync(f, "utf8");
  assert.doesNotMatch(html, /\+44 20 3835 2548/, `${f}: use 020 3835 2548`);
  for (const m of html.matchAll(/<a[^>]*href="tel:[^"]+"[^>]*>([\s\S]*?)<\/a>/g)) {
    assert.match(m[1].replace(/<[^>]+>/g, ""), /020 3835 2548/, `${f}: tel link without visible number`);
  }
}
console.log("call-tracking numbers: ok");

// Chat tracking: every page with the LeadConnector loader hooks beforeSubmit
// and pushes sm_chat_submit (GTM trigger) + ghl_chat_submission, with no PII.
for (const f of execSync("git grep -l 'LeadConnector chat' -- '*.html'").toString().split("\n").filter(Boolean)) {
  const html = readFileSync(f, "utf8");
  assert.match(html, /registerBeforeSubmit\(chatSubmitted\)/, `${f} hooks chat submit`);
  assert.match(html, /window\.__smChatHook = true;/, `${f} disables the GTM fetch hook`);
  const push = html.slice(html.indexOf("function chatSubmitted"), html.indexOf("function hookChat"));
  assert.doesNotMatch(push, /email|phone|name|message/i, `${f}: no PII in chat push`);
}
// No internal links carry UTMs (UTMs are for inbound campaigns only).
const internalUtm = execSync("git grep -n -E \"href=[\\\"'](/|https?://(www\\.)?searsmelvin\\.co\\.uk)[^\\\"']*utm_\" -- '*.html' '*.js' ':!functions/api/brochure.js' || true").toString().trim();
assert.equal(internalUtm, "", `internal UTM links:\n${internalUtm}`);
// Lead/quote pushes must exist too (full contract: tests/tracking-contract.mjs).
assert.match(readFileSync("contact.html", "utf8"), /event: 'sm_lead_submit'/);
assert.match(readFileSync("memorial.html", "utf8"), /event: 'sm_quote_submit'/);
console.log("chat + internal utm: ok");

// Lead/quote events: pushed first on the confirmed submit response, no PII.
{
  const c = readFileSync("contact.html", "utf8");
  const ok = c.slice(c.indexOf("if (result.ok) {"));
  assert.ok(ok.indexOf("event: 'sm_lead_submit'") < ok.indexOf("contactForm').style.display = 'none'"), "contact pushes before hiding the form");
  const m = readFileSync("memorial.html", "utf8");
  const q = m.slice(m.indexOf("if (result.ok) {", m.indexOf("channel:  'quote'")));
  const push = q.slice(0, q.indexOf("quoteForm').style.display = 'none'"));
  assert.match(push, /event: 'sm_quote_submit'/, "quote pushes sm_quote_submit before hiding the form");
  assert.doesNotMatch(push.replace(/form_id: 'quoteForm'/, ""), /email|phone|name\b/i, "no PII in quote push");
  assert.match(q, /qBox\.scrollTop \+=/, "quote success scrolled inside the modal only");
  assert.doesNotMatch(q.slice(0, q.indexOf("} else {")), /scrollIntoView/, "no page-level scrollIntoView");
}
console.log("lead/quote events: ok");
