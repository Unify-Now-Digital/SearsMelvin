// url_passthrough (docs/TRACKING.md rule 6, page-level consent mode) decorates internal links with the
// SAME click IDs as the landing URL. A decorated internal page load must not
// look like a new ad click to any of sm_attr / sm_attr_last / sm_lp.
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const up = createRequire(import.meta.url)("../site-upgrades.js");
const t0 = 1_700_000_000_000;

// ---- isNewClick truth table ----------------------------------------------
assert.equal(up.isNewClick(null, {}), false, "no fresh click id at all");
assert.equal(up.isNewClick(null, { utm_source: "google" }), false, "utm only is never a new click");
assert.equal(up.isNewClick(null, { gclid: "A" }), true, "stored missing + fresh click = new");
assert.equal(up.isNewClick({ ts: t0 }, { gclid: "A" }), true, "stored has no click id at all = new");
assert.equal(up.isNewClick({ ts: t0, gclid: "A" }, { gclid: "A" }), false, "same click id = not new (url_passthrough decoration)");
assert.equal(up.isNewClick({ ts: t0, gclid: "A" }, { gclid: "B" }), true, "different click id = new");
assert.equal(up.isNewClick({ ts: t0, gclid: "A" }, { gbraid: "C" }), true, "a different click key with no matching stored value = new");
assert.equal(up.isNewClick({ ts: t0, gclid: "A" }, {}), false, "no fresh click id, even with a stored one = not new");

// ---- mergeAttribution: same-click revisit keeps first touch + ts ----------
const first = up.mergeAttribution(null, { gclid: "A", utm_source: "google", utm_campaign: "spring" }, t0);
assert.deepEqual(up.attributionFields(first), { gclid: "A", utm_source: "google", utm_campaign: "spring" });

// url_passthrough decorates an internal click with the SAME gclid: UTMs survive, ts unchanged.
const decorated = up.mergeAttribution(first, { gclid: "A" }, t0 + 60000);
assert.equal(decorated, first, "same-click revisit returns the stored record unchanged");
assert.equal(decorated.ts, t0);
assert.deepEqual(up.attributionFields(decorated), { gclid: "A", utm_source: "google", utm_campaign: "spring" });

// Same-click revisit still fills in a genuinely missing UTM, like a plain UTM-only revisit.
const filled = up.mergeAttribution(first, { gclid: "A", utm_term: "granite" }, t0 + 60000);
assert.notEqual(filled, first);
assert.equal(filled.ts, t0, "fill keeps first-touch ts");
assert.deepEqual(up.attributionFields(filled), { gclid: "A", utm_source: "google", utm_campaign: "spring", utm_term: "granite" });

// A different gclid is a real new click: wholesale replace, ts restarts.
const replaced = up.mergeAttribution(first, { gclid: "B", utm_source: "bing" }, t0 + 60000);
assert.deepEqual(up.attributionFields(replaced), { gclid: "B", utm_source: "bing" });
assert.equal(replaced.ts, t0 + 60000);

// Expired record: even the same gclid starts a fresh 90-day window (expired = no stored record).
const expired = up.mergeAttribution(first, { gclid: "A" }, t0 + up.ATTR_TTL_MS);
assert.deepEqual(up.attributionFields(expired), { gclid: "A" });
assert.equal(expired.ts, t0 + up.ATTR_TTL_MS);

// ---- mergeLastAttribution: same-click revisit keeps last-touch UTMs -------
const lastFirst = up.mergeLastAttribution(null, { gclid: "A", utm_source: "google" }, t0);
assert.deepEqual(lastFirst, { ts: t0, gclid: "A", utm_source: "google" });
const lastDecorated = up.mergeLastAttribution(lastFirst, { gclid: "A" }, t0 + 60000);
assert.equal(lastDecorated, lastFirst, "same-click, no-UTM revisit keeps stored last touch");
const lastNewClick = up.mergeLastAttribution(lastFirst, { gclid: "B" }, t0 + 60000);
assert.deepEqual(lastNewClick, { ts: t0 + 60000, gclid: "B" }, "a new click still replaces last touch");
const lastNewUtm = up.mergeLastAttribution(lastFirst, { gclid: "A", utm_source: "bing" }, t0 + 60000);
assert.deepEqual(lastNewUtm, { ts: t0 + 60000, gclid: "A", utm_source: "bing" }, "new UTMs still replace last touch even for the same click");

// ---- mergeLanding: not restarted by a same-click (decorated) revisit ------
// storedAttribution() computes mergeLanding's hasClick as isNewClick(storedSmAttr, fresh),
// not "fresh has any click id" — mirror that composition directly here.
const lp0 = up.mergeLanding(null, "/memorials", "www.google.com", up.isNewClick(null, { gclid: "A" }), t0);
assert.deepEqual(lp0, { ts: t0, landing_page: "/memorials", referrer: "www.google.com" });
// Visitor clicks through to a product; url_passthrough decorates /memorials/the-castell?gclid=A.
// Against the stored sm_attr ({gclid:"A"}), this is NOT a new click, so landing_page + referrer survive.
const lp1 = up.mergeLanding(lp0, "/memorials/the-castell", "", up.isNewClick({ gclid: "A" }, { gclid: "A" }), t0 + 1000);
assert.equal(lp1, lp0, "decorated internal click does not restart the landing page / referrer");
// A genuinely new click (different gclid) does restart it.
const lp2 = up.mergeLanding(lp0, "/quote", "", up.isNewClick({ gclid: "A" }, { gclid: "B" }), t0 + 1000);
assert.equal(lp2.landing_page, "/quote");

// ---- Brochure form: missing UTMs filled from the session store ------------
assert.deepEqual(up.fillMissingUtm({ gclid: "A", utm_source: "google" }, { utm_source: "bing", utm_medium: "cpc" }), { gclid: "A", utm_source: "google", utm_medium: "cpc" }, "existing utm_source is never overwritten");
assert.deepEqual(up.fillMissingUtm({ gclid: "A" }, { utm_source: "bing" }), { gclid: "A", utm_source: "bing" });
assert.deepEqual(up.fillMissingUtm({}, {}), {});
assert.deepEqual(up.fillMissingUtm(null, { utm_source: "bing" }), { utm_source: "bing" });

console.log("url-passthrough-attribution: ok");
