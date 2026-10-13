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
assert.match(up.fabHtml(), /href="\/brochure\?utm_source=website/);
console.log("fab: ok");
