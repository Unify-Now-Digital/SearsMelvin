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
// Public pages that deliberately ship without the LeadConnector chat.
// Product detail pages, and the contact page. The catalogue (memorials.html)
// and every other public page keep the chat.
const NO_CHAT_PAGES = new Set(["memorial.html", "contact.html"]);
assert.ok(pages.includes("memorial.html") && pages.includes("memorials.html"), "product and catalogue pages must both be guarded");
let chatPages = 0;

for (const f of pages) {
  const s = read(f);
  assert.ok(/googletagmanager\.com\/gtm\.js\?id=|googletagmanager\.com\/gtm\.js'/.test(s), `${f}: GTM loader script missing`);
  assert.ok(s.includes("GTM-KRDX4BQ5"), `${f}: GTM-KRDX4BQ5 missing`);
  assert.ok(/ns\.html\?id=GTM-KRDX4BQ5/.test(s), `${f}: GTM noscript missing`);
  assert.ok(/<script[^>]+src="\/site-upgrades\.js[^"]*"/.test(s), `${f}: site-upgrades.js (gclid/attribution capture) missing`);
  assert.ok(/gtag\('consent', 'default', \{[\s\S]*?ad_storage:\s*'denied'[\s\S]*?analytics_storage:\s*'denied'[\s\S]*?ad_user_data:\s*'denied'[\s\S]*?ad_personalization:\s*'denied'/.test(s),
    `${f}: consent mode defaults changed or missing`);
  // Consent defaults come first. gtm.js waits for LCP, idle, or the first
  // interaction, with a 3.5s cap. The chat-hook flag is set before the URL.
  const iConsent = s.indexOf("gtag('consent', 'default'");
  const iGtm = s.indexOf("googletagmanager.com/gtm.js?id=GTM-KRDX4BQ5");
  assert.ok(iConsent > -1 && iGtm > iConsent, `${f}: consent defaults must come before the GTM loader`);
  const head = s.slice(0, s.indexOf("</head>"));
  assert.ok(iGtm > -1 && iGtm < head.length, `${f}: GTM loader must be in <head>`);
  const gtmBlock = s.slice(s.lastIndexOf("<script>", iGtm), s.indexOf("</script>", iGtm));
  assert.match(gtmBlock, /function loadGtm\(\)/, `${f}: GTM insert must stay inside loadGtm`);
  assert.match(gtmBlock, /var GTM_WAIT_MS = 3500;/, `${f}: GTM hard timeout is 3.5s`);
  assert.match(gtmBlock, /requestIdleCallback\(start, \{ timeout: GTM_WAIT_MS \}\)/, `${f}: GTM must load on idle with that cap`);
  const clickIdAt = gtmBlock.search(/\/\[\?&\]\(\?:gclid\|gbraid\|wbraid\)=\/i\.test\(location\.search/);
  const idleAt = gtmBlock.indexOf("requestIdleCallback(start");
  assert.ok(clickIdAt > -1 && clickIdAt < idleAt, `${f}: a gclid/gbraid/wbraid landing must call loadGtm before the idle timer`);
  assert.ok(gtmBlock.indexOf("loadGtm();", clickIdAt) > clickIdAt && gtmBlock.indexOf("loadGtm();", clickIdAt) < idleAt, `${f}: click-id landing must call loadGtm immediately`);
  assert.doesNotMatch(gtmBlock, /_gcl_aw\s*=/, `${f}: the page must not write _gcl_aw`);
  assert.match(gtmBlock, /largest-contentful-paint/, `${f}: GTM must also load after LCP`);
  assert.match(gtmBlock, /pointerdown/, `${f}: GTM must load on pointerdown`);
  assert.match(gtmBlock, /keydown/, `${f}: GTM must load on keydown`);
  assert.match(gtmBlock, /'scroll'/, `${f}: GTM must load on scroll`);
  assert.match(gtmBlock, /touchstart/, `${f}: GTM must load on touchstart`);
  assert.match(gtmBlock, /event: 'gtm\.linkClick'/, `${f}: early tel tap must queue gtm.linkClick`);
  assert.match(gtmBlock, /event: 'gtm\.formSubmit'/, `${f}: early form submit must queue gtm.formSubmit`);
  assert.match(gtmBlock, /eventTimeout: HOLD_MS/, `${f}: tel/form navigation must wait on eventTimeout`);
  assert.match(gtmBlock, /var HOLD_MS = 300;/, `${f}: hold before navigation is 300ms`);
  assert.doesNotMatch(gtmBlock, /cookieConsent/, `${f}: GTM loader must not wait for a cookie choice`);
  assert.ok(gtmBlock.indexOf("window.__smChatHook = true") > -1 && gtmBlock.indexOf("window.__smChatHook = true") < gtmBlock.indexOf("gtm.js?id="), `${f}: __smChatHook must be set before gtm.js is injected`);
  assert.ok(gtmBlock.indexOf("window.dataLayer = window.dataLayer || []") < gtmBlock.indexOf("function loadGtm"), `${f}: dataLayer must exist before gtm.js is inserted`);
  // Product detail pages (memorial.html, also served as /memorials/<slug>)
  // do not load the LeadConnector chat: the bubble covered the price above the
  // sticky bottom bar. /contact does not load it either: the launcher covered
  // the Phone field and Send Message. GTM, consent and __smChatHook above
  // still apply.
  if (NO_CHAT_PAGES.has(f)) {
    assert.ok(!s.includes("widgets.leadconnectorhq.com/loader.js"), `${f}: this page must not load the LeadConnector chat`);
    assert.doesNotMatch(s, /widgets\.leadconnectorhq\.com|data-widget-id/, `${f}: no LeadConnector widget on this page`);
    continue;
  }
  // LeadConnector chat loads after first paint and idle (3.5s cap), or on the
  // first interaction. It is not loaded at parse time and not after 10 seconds.
  const iLc = s.indexOf("widgets.leadconnectorhq.com/loader.js");
  assert.ok(iLc > -1, `${f}: LeadConnector loader missing`);
  const lcBlock = s.slice(s.lastIndexOf("<script>", iLc), s.indexOf("</script>", iLc));
  assert.match(lcBlock, /function load\(\)\{[\s\S]*widgets\.leadconnectorhq\.com\/loader\.js/, `${f}: LeadConnector chat must stay behind load()`);
  assert.match(lcBlock, /data-widget-id', '69ff236b0d119858db377c07'/, `${f}: chat widget id changed`);
  assert.match(lcBlock, /afterFirstPaint\(function \(\) \{\s*if \(window\.requestIdleCallback\) requestIdleCallback\(load, \{ timeout: 3500 \}\)/, `${f}: chat idle load must follow first paint, with a 3.5s cap`);
  assert.match(lcBlock, /pointerdown/, `${f}: chat must load on pointerdown`);
  assert.match(lcBlock, /keydown/, `${f}: chat must load on keydown`);
  assert.match(lcBlock, /touchstart/, `${f}: chat must load on touchstart`);
  assert.match(lcBlock, /'scroll'/, `${f}: chat must load on scroll`);
  assert.doesNotMatch(lcBlock, /setTimeout\(load, 1000\)/, `${f}: chat must not start at 1 second`);
  assert.doesNotMatch(lcBlock, /setTimeout\(load, 10000\)/, `${f}: LeadConnector 10s wait must stay gone`);
  assert.match(lcBlock, /window\.__smChatHook = true/, `${f}: chat loader must still set __smChatHook before the widget mounts`);
  chatPages++;
}
assert.equal(chatPages, pages.length - NO_CHAT_PAGES.size, "every other public page keeps the LeadConnector chat");

// gclid / gbraid / wbraid capture and attribution on submit.
const up = read("site-upgrades.js");
assert.match(up, /CLICK_KEYS = \['gclid', 'gbraid', 'wbraid'\]/, "site-upgrades.js: click-ID capture missing");
assert.match(up, /sm_attr/, "site-upgrades.js: sm_attr store missing");
assert.match(up, /getAttribution/, "site-upgrades.js: getAttribution missing");
const captureCall = up.indexOf("\n    storedAttribution();\n    api.getAttribution = storedAttribution;");
const initAt = up.indexOf("\n    function init() {");
assert.ok(captureCall > -1 && initAt > captureCall, "gclid capture must run when site-upgrades.js evaluates, before init");
assert.doesNotMatch(up.slice(captureCall, captureCall + 80), /requestIdleCallback|setTimeout/, "gclid capture must not be deferred");
assert.match(up, /event: 'brochure_download'/, "site-upgrades.js: brochure_download push missing");
for (const f of ["contact.html", "memorial.html"]) assert.match(read(f), /attribution:\s*.*getAttribution\(\)/, `${f}: attribution not sent with the form`);

// Conversion pushes.
assert.match(read("contact.html"), /event: 'sm_lead_submit'/, "contact.html: sm_lead_submit missing");
assert.match(read("memorial.html"), /event: 'sm_quote_submit'/, "memorial.html: sm_quote_submit missing");
const memorialsPage = read("memorials.html");
const shortlistFn = memorialsPage.slice(memorialsPage.indexOf("async function submitShortlistEnquiry"));
assert.match(shortlistFn, /if \(result\.ok\) \{[\s\S]*event: 'sm_lead_submit'[\s\S]*form_id: 'shortlist'/, "shortlist sm_lead_submit must follow a successful /api/submit");
assert.doesNotMatch(shortlistFn, /alert\(/, "shortlist errors stay on the page");
const home = read("index.html");
const apptFn = home.slice(home.indexOf("async function submitAppointment"));
assert.match(apptFn, /event: 'sm_lead_submit'/, "home appointment sm_lead_submit missing");
assert.doesNotMatch(apptFn, /alert\(/, "home appointment errors stay on the page");

// Server-rendered product pages must not strip the tracking from memorial.html.
const slugFn = read("functions/memorials/[slug].js");
assert.doesNotMatch(slugFn, /\.on\(\s*["'](script|noscript|head)["'][^)]*\)\s*[,.][\s\S]{0,80}remove\(\)/, "[slug].js must not remove scripts");

console.log(`tracking-guard OK: ${pages.length} pages`);
