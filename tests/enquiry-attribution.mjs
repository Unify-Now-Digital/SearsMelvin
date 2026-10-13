import assert from "node:assert/strict";
import { cleanAttribution, attributionColumns, attributionCustomFields } from "../functions/api/submit.js";
import { upsertBrochureContact } from "../functions/api/brochure.js";

// Cleaning: known keys only, click IDs safe charset only.
assert.deepEqual(cleanAttribution({ gclid: "TEST_abc-1", gbraid: "bad id", utm_campaign: " Brand ", evil: "x" }), { gclid: "TEST_abc-1", utm_campaign: "Brand" });
assert.deepEqual(cleanAttribution(null), {});
assert.deepEqual(cleanAttribution(["gclid"]), {});
// Supabase columns mirror the cleaned keys (empty -> nothing sent).
assert.deepEqual(attributionColumns({ gclid: "G1", wbraid: "W1", utm_source: "google" }), { gclid: "G1", wbraid: "W1", utm_source: "google" });
assert.deepEqual(attributionColumns(undefined), {});

// GHL field ids resolved with the caller's token + location (SM PIT for brochure).
const calls = [];
const fakeFetch = async (url, init = {}) => {
  calls.push({ url: String(url), init });
  if (String(url).includes("/customFields")) return new Response(JSON.stringify({ customFields: [
    { id: "f-gclid", fieldKey: "contact.contactgclid" }, { id: "f-src", fieldKey: "contact.utm_source" },
  ] }), { status: 200 });
  if (String(url).endsWith("/contacts/upsert")) return new Response(JSON.stringify({ contact: { id: "c1", firstName: "T" } }), { status: 200 });
  if (String(url).includes("/opportunities/search")) return new Response(JSON.stringify({ opportunities: [{ id: "o1", status: "open" }] }), { status: 200 });
  return new Response("{}", { status: 200 });
};
const cf = await attributionCustomFields({}, { gclid: "G1", utm_source: "google", wbraid: "W" }, { token: "tok", locationId: "LOCX", fetchImpl: fakeFetch });
assert.deepEqual(cf, [{ id: "f-gclid", field_value: "G1" }, { id: "f-src", field_value: "google" }]);
assert.match(calls[0].url, /locations\/LOCX\/customFields/);
assert.equal(calls[0].init.headers.Authorization, "Bearer tok");
// No attribution -> no GHL call at all.
calls.length = 0;
assert.deepEqual(await attributionCustomFields({}, {}, { token: "tok", locationId: "LOCX", fetchImpl: fakeFetch }), []);
assert.equal(calls.length, 0);

// Brochure upsert carries the attribution custom fields.
calls.length = 0;
await upsertBrochureContact({ SM_GHL_PIT_CALL_TRANSCRIPTS: "pit" }, "t@example.com", { attribution: { gclid: "G2" } }, fakeFetch);
const up = calls.find((c) => c.url.endsWith("/contacts/upsert"));
assert.deepEqual(JSON.parse(up.init.body).customFields, [{ id: "f-gclid", field_value: "G2" }]);
console.log("enquiry-attribution: ok");
