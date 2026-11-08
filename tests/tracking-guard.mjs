// Tracking guard (docs/TRACKING.md). Fails CI if any public page loses the GTM
// loader, consent-mode defaults, the gclid/attribution script, or if a
// conversion push / gclid capture disappears. Complements tracking-contract.mjs.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";

const read = (f) => readFileSync(f, "utf8");
// styleguide.html is a noindex reference. It must not load GTM.
const skip = new Set(["404.html", "admin.html", "admin-products.html", "styleguide.html"]);
const pages = execSync("git ls-files '*.html'").toString().split("\n").filter((f) => f && !skip.has(f));
assert.ok(pages.length >= 13, "expected the public pages to be found"); // 13 after the 6 area pages were removed (Oct 2026)

for (const f of pages) {
  const s = read(f);
  assert.ok(/googletagmanager\.com\/gtm\.js\?id=|googletagmanager\.com\/gtm\.js'/.test(s), `${f}: GTM loader script missing`);
  assert.ok(s.includes("GTM-KRDX4BQ5"), `${f}: GTM-KRDX4BQ5 missing`);
  assert.ok(/ns\.html\?id=GTM-KRDX4BQ5/.test(s), `${f}: GTM noscript missing`);
  assert.ok(/<script[^>]+src="\/site-upgrades\.js[^"]*"/.test(s), `${f}: site-upgrades.js (gclid/attribution capture) missing`);
  assert.ok(/gtag\('consent', 'default', \{[\s\S]*?ad_storage:\s*'denied'[\s\S]*?analytics_storage:\s*'denied'[\s\S]*?ad_user_data:\s*'denied'[\s\S]*?ad_personalization:\s*'denied'/.test(s),
    `${f}: consent mode defaults changed or missing`);
  // GTM loads at page start (not on first scroll/tap/idle), and only after the
  // consent defaults; the chat-hook flag is claimed before gtm.js can run.
  const iConsent = s.indexOf("gtag('consent', 'default'");
  const iGtm = s.indexOf("googletagmanager.com/gtm.js?id=GTM-KRDX4BQ5");
  assert.ok(iConsent > -1 && iGtm > iConsent, `${f}: consent defaults must come before the GTM loader`);
  const head = s.slice(0, s.indexOf("</head>"));
  assert.ok(iGtm > -1 && iGtm < head.length, `${f}: GTM loader must be in <head>`);
  const gtmBlock = s.slice(s.lastIndexOf("<script>", iGtm), s.indexOf("</script>", iGtm));
  assert.doesNotMatch(gtmBlock, /requestIdleCallback|addEventListener|setTimeout/, `${f}: GTM loader must not be deferred`);
  assert.ok(gtmBlock.indexOf("window.__smChatHook = true") > -1 && gtmBlock.indexOf("window.__smChatHook = true") < gtmBlock.indexOf("gtm.js?id="), `${f}: __smChatHook must be set before gtm.js is injected`);
  // LeadConnector chat stays deferred (interaction or 10s), never loaded at parse time.
  const iLc = s.indexOf("widgets.leadconnectorhq.com/loader.js");
  assert.ok(iLc > -1, `${f}: LeadConnector loader missing`);
  const lcBlock = s.slice(s.lastIndexOf("<script>", iLc), s.indexOf("</script>", iLc));
  assert.match(lcBlock, /function load\(\)\{\s*if \(loaded\) return; loaded = true;[\s\S]*widgets\.leadconnectorhq\.com\/loader\.js/, `${f}: LeadConnector chat must stay behind the deferred load()`);
  assert.match(lcBlock, /setTimeout\(load, 10000\)/, `${f}: LeadConnector 10s fallback missing`);
  assert.doesNotMatch(lcBlock, /'scroll'/, `${f}: LeadConnector must not load on scroll`);
}

// gclid / gbraid / wbraid capture and attribution on submit.
const up = read("site-upgrades.js");
assert.match(up, /CLICK_KEYS = \['gclid', 'gbraid', 'wbraid'\]/, "site-upgrades.js: click-ID capture missing");
assert.match(up, /sm_attr/, "site-upgrades.js: sm_attr store missing");
assert.match(up, /getAttribution/, "site-upgrades.js: getAttribution missing");
assert.match(up, /event: 'brochure_download'/, "site-upgrades.js: brochure_download push missing");
for (const f of ["contact.html", "memorial.html"]) assert.match(read(f), /attribution:\s*.*getAttribution\(\)/, `${f}: attribution not sent with the form`);

// Conversion pushes.
assert.match(read("contact.html"), /event: 'sm_lead_submit'/, "contact.html: sm_lead_submit missing");
assert.match(read("memorial.html"), /event: 'sm_quote_submit'/, "memorial.html: sm_quote_submit missing");

// Server-rendered product pages must not strip the tracking from memorial.html.
const slugFn = read("functions/memorials/[slug].js");
assert.doesNotMatch(slugFn, /\.on\(\s*["'](script|noscript|head)["'][^)]*\)\s*[,.][\s\S]{0,80}remove\(\)/, "[slug].js must not remove scripts");

console.log(`tracking-guard OK: ${pages.length} pages`);
