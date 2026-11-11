// Cookie choice card: storage values, consent signals, and the page contract.
// GTM must load on every public page whether or not a choice is stored.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import vm from "node:vm";

const read = (path) => readFileSync(path, "utf8");
const context = {};
context.globalThis = context;
vm.createContext(context);
vm.runInContext(read("cookie-consent.js"), context);
const api = context.smCookieConsent;
const plain = (value) => JSON.parse(JSON.stringify(value));
assert.equal(api.KEY, "cookieConsent");

assert.equal(api.readChoice(null), null);
assert.equal(api.readChoice(""), null);
assert.deepEqual(plain(api.readChoice("accepted")), { analytics: true, ads: true });
assert.deepEqual(plain(api.readChoice("declined")), { analytics: false, ads: false });
assert.deepEqual(plain(api.readChoice('{"analytics":true,"ads":false}')), { analytics: true, ads: false });
assert.deepEqual(plain(api.readChoice('{"analytics":false,"ads":true}')), { analytics: false, ads: true });
assert.equal(api.readChoice("nope"), null);
assert.equal(api.readChoice("{"), null);

assert.equal(api.serialise({ analytics: true, ads: false }), '{"analytics":true,"ads":false}');
assert.deepEqual(plain(api.signals({ analytics: true, ads: false })), {
  analytics_storage: "granted",
  ad_storage: "denied",
  ad_user_data: "denied",
  ad_personalization: "denied",
});
assert.deepEqual(plain(api.signals({ analytics: false, ads: true })), {
  analytics_storage: "denied",
  ad_storage: "granted",
  ad_user_data: "granted",
  ad_personalization: "granted",
});
assert.deepEqual(plain(api.signals(api.readChoice("accepted"))), {
  analytics_storage: "granted",
  ad_storage: "granted",
  ad_user_data: "granted",
  ad_personalization: "granted",
});
assert.deepEqual(plain(api.signals(api.readChoice("declined"))), {
  analytics_storage: "denied",
  ad_storage: "denied",
  ad_user_data: "denied",
  ad_personalization: "denied",
});

const css = read("cookie-consent.css");
assert.match(css, /--sm-target-min/);
assert.match(css, /--sm-radius-sm/);
assert.match(css, /--font-body/);
assert.match(css, /--ck-nav, 79px/);
assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/);
assert.match(read("chat-widget.css"), /body:has\(#cookieConsent\[style\*="display: block"\]\) chat-widget/);
assert.match(read("site-upgrades.css"), /#cookieConsent\[style\*="display: block"\]\) \.sm-brochure-fab/);
const upgrades = read("site-upgrades.js");
assert.match(upgrades, /CLICK_KEYS = \['gclid', 'gbraid', 'wbraid'\]/);
const capture = upgrades.slice(upgrades.indexOf("var CLICK_KEYS"), upgrades.indexOf("function initFab"));
assert.doesNotMatch(capture, /cookieConsent/, "click-ID capture must not read the cookie choice");

const skip = new Set(["404.html", "styleguide.html"]);
const pages = readdirSync(".").filter((name) => name.endsWith(".html") && !skip.has(name));
let banners = 0;
for (const name of pages) {
  const html = read(name);
  if (!html.includes('id="cookieConsent"')) continue;
  banners += 1;
  assert.match(html, /href="\/cookie-consent\.css"/, `${name}: cookie stylesheet missing`);
  assert.match(html, /src="\/cookie-consent\.js"/, `${name}: cookie script missing`);
  assert.match(html, /Your cookie choices/, `${name}: desktop heading missing`);
  assert.match(html, /We use cookies for analytics and ads, only if you agree\./, `${name}: phone copy missing`);
  assert.match(html, /id="cookieAccept"/, `${name}: Accept missing`);
  assert.match(html, /id="cookieReject"/, `${name}: Reject missing`);
  assert.match(html, /Manage choices/, `${name}: Manage choices missing`);
  assert.match(html, /Accept all/, `${name}: Accept all missing`);
  assert.match(html, /Reject all/, `${name}: Reject all missing`);
  assert.match(html, /Save choices/, `${name}: Save choices missing`);
  assert.match(html, /class="sm-cookie-settings"/, `${name}: Cookie settings link missing`);
  assert.match(html, /Cookie settings/, `${name}: Cookie settings copy missing`);
  assert.doesNotMatch(html, /function acceptCookies\(/, `${name}: old accept handler still inline`);
  assert.doesNotMatch(html, /id="cookieDecline"|onclick="declineCookies\(\)"/, `${name}: old Decline control still present`);
  if (html.includes("GTM-KRDX4BQ5")) {
    assert.match(html, /gtag\('set', 'ads_data_redaction', true\)/, `${name}: ads_data_redaction missing`);
    assert.match(html, /gtag\('set', 'url_passthrough', true\)/, `${name}: url_passthrough missing`);
    assert.match(html, /smConsentRaw === 'accepted'/);
    assert.match(html, /smConsentRaw === 'declined'/);
    assert.match(html, /smConsentParsed\.analytics/);
    const gtmAt = html.indexOf("googletagmanager.com/gtm.js?id=GTM-KRDX4BQ5");
    const blockStart = html.lastIndexOf("<script>", gtmAt);
    const block = html.slice(blockStart, html.indexOf("</script>", gtmAt));
    assert.doesNotMatch(block, /cookieConsent/, `${name}: GTM loader waits on the cookie choice`);
    assert.ok(html.indexOf("gtag('consent', 'default'") < gtmAt, `${name}: defaults must come before GTM`);
    assert.ok(html.indexOf("ads_data_redaction") < gtmAt, `${name}: redaction must come before GTM`);
  }
}
assert.ok(banners >= 13, `expected the public banners, found ${banners}`);
assert.match(read("privacy.html"), /Google Analytics and Google Ads cookies only if you agree/);
assert.match(read("privacy.html"), /Cookie settings link in the footer/);
assert.doesNotMatch(read("privacy.html"), /do not use cookies for advertising/i);

console.log(`cookie-consent: ok (${banners} banners)`);
