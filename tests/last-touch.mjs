import assert from "node:assert/strict";
import {
  LAST_ATTRIBUTION_KEYS,
  cleanAttribution,
  cleanLastAttribution,
  createEnquiry,
  createGHLContact,
  saveEnquiryAttribution,
  validateSubmission,
} from "../functions/api/submit.js";
import { upsertBrochureContact } from "../functions/api/brochure.js";

assert.deepEqual(LAST_ATTRIBUTION_KEYS, ["last_gclid", "last_gbraid", "last_wbraid", "last_utm_source", "last_utm_medium", "last_utm_campaign", "last_utm_term", "last_utm_content"]);
assert.deepEqual(cleanLastAttribution({ last_gclid: " G-1 ", last_gbraid: "bad id", last_utm_campaign: " x ", gclid: "first" }), { last_gclid: "G-1", last_utm_campaign: "x" });
assert.deepEqual(cleanAttribution({ gclid: "first", last_gclid: "last" }), { gclid: "first" }, "first-touch cleaner stays unchanged");
const validated = validateSubmission({ channel: "contact", name: "Test Person", email: "t@example.com", attribution: { gclid: "first", last_gclid: "last", last_utm_source: "bing" } }, "org");
assert.equal(validated.data.attribution.gclid, "first");
assert.equal(validated.data.attribution.last_gclid, "last");

const env = { SUPABASE_URL: "https://db.example", SUPABASE_SERVICE_KEY: "key", SM_ORG_ID: "org" };
const realFetch = globalThis.fetch;
try {
  const calls = [];
  let enquiryAttempt = 0;
  globalThis.fetch = async (url, init = {}) => {
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ url: String(url), method: init.method || "GET", body });
    if (String(url).includes("/people?")) return Response.json([{ id: "person-1", is_customer: false }]);
    if (String(url).includes("/people?id=")) return new Response(null, { status: 204 });
    if (String(url).endsWith("/enquiries")) {
      enquiryAttempt += 1;
      return enquiryAttempt === 1
        ? new Response(JSON.stringify({ code: "PGRST204", message: "last_gclid column missing" }), { status: 400 })
        : new Response(null, { status: 201 });
    }
    throw new Error(`Unexpected fetch ${url}`);
  };
  await createEnquiry(env, { name: "Test Person", email: "t@example.com", phone: "", channel: "contact", attribution: { gclid: "first", last_gclid: "last", last_utm_source: "bing", lead_source: "Google Ads", lead_channel: "Contact form" } });
  const inserts = calls.filter((call) => call.url.endsWith("/enquiries"));
  assert.equal(inserts[0].body.last_gclid, "last");
  assert.equal(inserts[0].body.last_utm_source, "bing");
  assert.ok(!("last_gclid" in inserts[1].body), "schema-lag retry removes last-touch columns");
  assert.equal(inserts[1].body.gclid, "first", "schema-lag retry retains first touch");

  const patches = [];
  globalThis.fetch = async (url, init = {}) => {
    patches.push({ url: String(url), body: JSON.parse(init.body) });
    return new Response(null, { status: patches.length === 2 ? 400 : 204 });
  };
  const errors = [];
  const realError = console.error;
  console.error = (...args) => errors.push(args.join(" "));
  await saveEnquiryAttribution(env, "enquiry-1", { gclid: "first", last_gclid: "last" });
  console.error = realError;
  assert.deepEqual(patches.map((p) => p.body), [{ gclid: "first" }, { last_gclid: "last" }], "quote fallback patches last touch separately");
  assert.match(errors.join(" "), /enquiry_last_touch_columns_missing/);

  const ghlCalls = [];
  globalThis.fetch = async (url, init = {}) => {
    const body = init.body ? JSON.parse(init.body) : null;
    ghlCalls.push({ url: String(url), method: init.method || "GET", body });
    if (String(url).includes("/customFields")) return Response.json({ customFields: [{ id: "last-id", fieldKey: "contact.contactlast_gclid" }] });
    if (String(url).endsWith("/contacts/")) return new Response(JSON.stringify({ message: "duplicate contact", meta: { contactId: "c1" } }), { status: 400 });
    if (String(url).endsWith("/contacts/c1") && !init.method) return Response.json({ contact: { customFields: [{ id: "first-id", field_value: "existing-first" }, { id: "last-id", field_value: "existing-last" }] } });
    return Response.json({ ok: true });
  };
  await createGHLContact({ GHL_API_KEY: "token", GHL_LOCATION_ID: "last-touch-test" }, {
    name: "Test Person", email: "t@example.com", type: "enquiry",
    attributionFields: [{ id: "first-id", field_value: "new-first" }],
    lead: { last_gclid: "new-last" },
  });
  const put = ghlCalls.find((call) => call.method === "PUT");
  assert.deepEqual(put.body.customFields, [{ id: "last-id", field_value: "new-last" }], "last touch overwrites while first touch remains fill-only");

  const brochureCalls = [];
  const brochureFetch = async (url, init = {}) => {
    const body = init.body ? JSON.parse(init.body) : null;
    brochureCalls.push({ url: String(url), body });
    if (String(url).includes("/customFields")) return Response.json({ customFields: [{ id: "last-brochure", fieldKey: "contact.contactlast_gclid" }] });
    if (String(url).includes("/contacts/search/duplicate")) return Response.json({ contact: { customFields: [{ id: "last-brochure", field_value: "old" }] } });
    if (String(url).endsWith("/contacts/upsert")) return Response.json({ contact: { id: "bc1" } });
    if (String(url).includes("/opportunities/search")) return Response.json({ opportunities: [{ id: "o1", pipelineId: "ty7z50OQyVGXMS1NARrK", status: "open" }] });
    return Response.json({ ok: true });
  };
  await upsertBrochureContact({ SM_GHL_PIT_CALL_TRANSCRIPTS: "pit" }, "brochure@example.com", { attribution: { last_gclid: "new-brochure" } }, brochureFetch);
  const brochureUpsert = brochureCalls.find((call) => call.url.endsWith("/contacts/upsert"));
  assert.deepEqual(brochureUpsert.body.customFields, [{ id: "last-brochure", field_value: "new-brochure" }]);
} finally {
  globalThis.fetch = realFetch;
}

console.log("last-touch: ok");
