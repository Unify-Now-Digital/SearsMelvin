import assert from "node:assert/strict";
import { createRequire } from "node:module";
import {
  cleanConsent,
  consentCustomFields,
  createEnquiry,
} from "../functions/api/submit.js";
import { downloadRow, logDownload } from "../functions/api/brochure.js";

const require = createRequire(import.meta.url);
const upgrades = require("../site-upgrades.js");
const now = Date.parse("2026-10-22T12:00:00.000Z");

assert.deepEqual(upgrades.consentFields("accepted", now), {
  consent_ad_user_data: "granted",
  consent_ad_personalization: "granted",
  consent_captured_at: "2026-10-22T12:00:00.000Z",
});
assert.equal(upgrades.consentFields("declined", now).consent_ad_user_data, "denied");
assert.equal(upgrades.consentFields(null, now).consent_ad_personalization, "unknown");

assert.deepEqual(cleanConsent({
  consent_ad_user_data: "granted",
  consent_ad_personalization: "denied",
  consent_captured_at: "2026-10-22T11:00:00Z",
}, now), {
  consent_ad_user_data: "granted",
  consent_ad_personalization: "denied",
  consent_captured_at: "2026-10-22T11:00:00.000Z",
});
assert.deepEqual(cleanConsent({
  consent_ad_user_data: "yes",
  consent_ad_personalization: "DENIED",
  consent_captured_at: "2026-10-20T11:00:00.000Z",
}, now), {});

const env = { SUPABASE_URL: "https://db.example", SUPABASE_SERVICE_KEY: "key", SM_ORG_ID: "org" };
const consent = {
  consent_ad_user_data: "granted",
  consent_ad_personalization: "granted",
  consent_captured_at: new Date().toISOString(),
};
const realFetch = globalThis.fetch;
try {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ url: String(url), body });
    if (String(url).includes("/people?")) return Response.json([{ id: "person-1", is_customer: false }]);
    if (String(url).endsWith("/enquiries")) {
      return calls.filter((call) => call.url.endsWith("/enquiries")).length === 1
        ? new Response(JSON.stringify({ code: "PGRST204", message: "consent_ad_user_data column missing" }), { status: 400 })
        : new Response(null, { status: 201 });
    }
    throw new Error(`Unexpected fetch ${url}`);
  };
  await createEnquiry(env, { name: "Consent Test", email: "consent@example.com", phone: "", channel: "contact", attribution: consent });
  const inserts = calls.filter((call) => call.url.endsWith("/enquiries"));
  assert.equal(inserts[0].body.consent_ad_user_data, "granted");
  assert.ok(!("consent_ad_user_data" in inserts[1].body));

  const skipped = await consentCustomFields(
    { GHL_API_KEY: "token", GHL_LOCATION_ID: "consent-location" },
    consent,
    { fetchImpl: async () => Response.json({ customFields: [{ id: "other", fieldKey: "contact.unrelated" }] }) },
  );
  assert.deepEqual(skipped, [], "unresolved GHL consent fields are silently skipped");

  const brochureCalls = [];
  globalThis.fetch = async (url, init = {}) => {
    brochureCalls.push(JSON.parse(init.body));
    return brochureCalls.length === 1
      ? new Response(JSON.stringify({ code: "PGRST204", message: "consent_ad_user_data column missing" }), { status: 400 })
      : new Response(null, { status: 201 });
  };
  const row = await downloadRow(env, { source: "home", attribution: consent });
  assert.equal(row.consent_ad_personalization, "granted");
  assert.equal(await logDownload(env, row), true);
  assert.equal(brochureCalls[0].consent_ad_user_data, "granted");
  assert.ok(!("consent_ad_user_data" in brochureCalls[1]));
} finally {
  globalThis.fetch = realFetch;
}

console.log("consent-capture: ok");
