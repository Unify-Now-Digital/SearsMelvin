// Lead source + channel + landing page + ad-visitor phone (docs/TRACKING.md).
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { deriveLeadSource, deriveLeadChannel, leadMeta, leadColumns, leadTags, cleanLanding, LEAD_SOURCES, LEAD_CHANNELS } from "../functions/api/submit.js";
import { adsPhone } from "../functions/api/config.js";
const up = createRequire(import.meta.url)("../site-upgrades.js");

// Vocab matches Mason (shared/lib/leadSource.ts + migration 20261015120000).
assert.deepEqual(LEAD_SOURCES, ["Google Ads", "Organic", "Funeral director", "Referral", "Repeat", "Unknown"]);
assert.deepEqual(LEAD_CHANNELS, ["Contact form", "RAQ", "Brochure", "Web chat", "Call", "Email"]);

// Source
assert.equal(deriveLeadSource({ gclid: "Cj0KCQ" }), "Google Ads");
assert.equal(deriveLeadSource({ wbraid: "abc" }), "Google Ads");
assert.equal(deriveLeadSource({ utm_source: "google", utm_medium: "cpc" }), "Google Ads");
assert.equal(deriveLeadSource({ utm_source: "facebook", utm_medium: "paid_social" }), "Unknown");
assert.equal(deriveLeadSource({ referrer: "www.google.co.uk" }), "Organic");
assert.equal(deriveLeadSource({ referrer: "www.bing.com" }), "Organic");
assert.equal(deriveLeadSource({ referrer: "www.facebook.com" }), "Unknown");
assert.equal(deriveLeadSource({}), "Unknown");
assert.equal(deriveLeadSource(null), "Unknown");
assert.equal(deriveLeadSource({ gclid: "<script>" }), "Unknown"); // unsafe click id dropped

// Channel
assert.equal(deriveLeadChannel("quote"), "RAQ");
assert.equal(deriveLeadChannel("contact", "new-memorial"), "Contact form");
assert.equal(deriveLeadChannel("appointment"), "Contact form");
assert.equal(deriveLeadChannel("brochure"), "Brochure");

// Landing page: path only, never the query; junk dropped.
assert.deepEqual(cleanLanding({ landing_page: "/memorials/kerb-sets?gclid=x#top", referrer: "www.google.com" }), { landing_page: "/memorials/kerb-sets", referrer: "www.google.com" });
assert.deepEqual(cleanLanding({ landing_page: "javascript:alert(1)", referrer: "<x>" }), {});
const m = leadMeta({ gclid: "abc", landing_page: "/lawn-headstones" }, "quote");
assert.deepEqual(m, { landing_page: "/lawn-headstones", lead_source: "Google Ads", lead_channel: "RAQ" });
assert.deepEqual(leadColumns(m), { lead_source: "Google Ads", landing_page: "/lawn-headstones" });
assert.deepEqual(leadColumns(m, { withChannel: true }), { lead_source: "Google Ads", landing_page: "/lawn-headstones", lead_channel: "RAQ" });
assert.deepEqual(leadColumns({ lead_source: "Web form", lead_channel: "Fax" }, { withChannel: true }), {});
assert.deepEqual(leadTags(m), ["source-google-ads", "channel-raq"]);

// Client: first-touch landing page (90 days), a new click restarts it.
const now = 1_760_000_000_000;
const first = up.mergeLanding(null, "/memorials", "www.google.com", false, now);
assert.deepEqual(first, { ts: now, landing_page: "/memorials", referrer: "www.google.com" });
assert.equal(up.mergeLanding(first, "/contact", "", false, now + 1000), first);
assert.equal(up.mergeLanding(first, "/quote", "", true, now + 1000).landing_page, "/quote");
assert.equal(up.mergeLanding(first, "/contact", "", false, now + up.ATTR_TTL_MS + 1).landing_page, "/contact");
assert.equal(up.referrerHost("https://www.searsmelvin.co.uk/memorials", "searsmelvin.co.uk"), "");
assert.equal(up.referrerHost("https://www.google.co.uk/", "searsmelvin.co.uk"), "www.google.co.uk");

// Ad visitor + phone
assert.equal(up.isAdVisit({ gclid: "x" }), true);
assert.equal(up.isAdVisit({ utm_medium: "cpc" }), true);
assert.equal(up.isAdVisit({ utm_medium: "email" }), false);
assert.equal(up.phoneFor(true, ""), "02038352548");            // no Ads number bought yet → main number
assert.equal(up.phoneFor(true, "PLACEHOLDER"), "02038352548");
assert.equal(up.phoneFor(false, "02079460018"), "02038352548"); // organic visitor
assert.equal(up.phoneFor(true, "+44 20 7946 0018"), "02079460018");
assert.equal(up.displayPhone("02079460018"), "020 7946 0018");
assert.equal(adsPhone(undefined), "");
assert.equal(adsPhone("PLACEHOLDER"), "");
assert.equal(adsPhone("020 3835 2548"), "");
assert.equal(adsPhone("+442079460018"), "02079460018");
console.log("lead-source ok");
