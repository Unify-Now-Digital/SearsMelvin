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
assert.ok(listing.includes("Installed guide price · cemetery fees extra"));

// /about and /brochure exist, are linked, and /about is in the sitemap.
assert.ok(existsSync("about.html") && existsSync("brochure.html"));
for (const page of ["index.html", "memorials.html", "memorial.html", "contact.html"]) {
  const html = readFileSync(page, "utf8");
  assert.ok(html.includes('href="/about"'), `${page} links /about`);
  assert.ok(html.includes('href="/brochure"'), `${page} links /brochure`);
  assert.ok(html.includes('class="nav-cta-dark">Quote'), `${page} keeps Quote as the primary nav CTA`);
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
// First touch kept: a later UTM-only (or bare) visit does not overwrite it.
assert.equal(up.mergeAttribution(rec, { utm_source: "facebook" }, t0 + 10), rec);
// A new click ID refreshes the record and restarts the 90 days.
const rec2 = up.mergeAttribution(rec, { wbraid: "w2", utm_source: "google" }, t0 + 20);
assert.deepEqual(up.attributionFields(rec2), { wbraid: "w2", utm_source: "google" });
assert.equal(rec2.ts, t0 + 20);
// Expired first touch is replaced by any fresh UTMs.
assert.deepEqual(up.attributionFields(up.mergeAttribution(rec, { utm_source: "bing" }, t0 + up.ATTR_TTL_MS)), { utm_source: "bing" });
// Every public form sends the stored attribution.
for (const f of ["contact.html", "memorial.html", "memorials.html", "index.html"]) {
  assert.match(readFileSync(f, "utf8"), /attribution: \(window\.SMUpgrades && window\.SMUpgrades\.getAttribution\)/, `${f} sends attribution`);
}
assert.match(readFileSync("site-upgrades.js", "utf8"), /action: 'email'[^\n]*attribution: storedAttribution\(\)/);

// Floating brochure button
assert.equal(up.fabAllowed("/"), true);
assert.equal(up.fabAllowed("/about"), true);
assert.equal(up.fabAllowed("/brochure"), false);
assert.equal(up.fabAllowed("/brochure/"), false);
assert.equal(up.fabAllowed("/brochure.html"), false);
assert.match(up.fabHtml(), /aria-label="View our brochure"/);
assert.match(up.fabHtml(), /href="\/brochure\?from=fab"/);
assert.equal(up.normaliseSource("fab"), "fab");
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
console.log("chat + internal utm: ok");
