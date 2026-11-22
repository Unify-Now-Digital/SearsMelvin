import assert from "node:assert/strict";
import { cleanAttribution, attributionColumns, attributionCustomFields, createEnquiry, saveEnquiryAttribution } from "../functions/api/submit.js";
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

// Referrer (migration not applied yet): createEnquiry sends it, and drops it
// — like the existing last_touch / lead_channel schema-lag columns — on a
// PGRST204 'referrer' error, so the lead is never lost.
{
  const env = { SUPABASE_URL: "https://db.example", SUPABASE_SERVICE_KEY: "key", SM_ORG_ID: "org" };
  const realFetch = globalThis.fetch;
  try {
    const inserts = [];
    let attempt = 0;
    globalThis.fetch = async (url, init = {}) => {
      const body = init.body ? JSON.parse(init.body) : null;
      if (String(url).includes("/people?")) return Response.json([{ id: "person-referrer", is_customer: false }]);
      if (String(url).endsWith("/enquiries")) {
        inserts.push(body);
        attempt += 1;
        return attempt === 1
          ? new Response(JSON.stringify({ code: "PGRST204", message: "column enquiries.referrer does not exist" }), { status: 400 })
          : Response.json([{ id: "enquiry-referrer-1" }], { status: 201 });
      }
      throw new Error(`Unexpected fetch ${url}`);
    };
    await createEnquiry(env, {
      name: "Referrer Test", email: "r@example.com", phone: "", channel: "contact",
      attribution: { landing_page: "/memorials", referrer: "www.google.com" },
    });
    assert.equal(inserts[0].referrer, "www.google.com", "first attempt sends referrer");
    assert.ok(!("referrer" in inserts[1]), "schema-lag retry drops referrer");
    assert.equal(inserts[1].landing_page, "/memorials", "retry keeps the rest of the attribution");
  } finally {
    globalThis.fetch = realFetch;
  }
}

// saveEnquiryAttribution (quote fallback): referrer is patched separately from
// the main attribution patch, so a missing referrer column can never block it.
{
  const env = { SUPABASE_URL: "https://db.example", SUPABASE_SERVICE_KEY: "key", SM_ORG_ID: "org" };
  const realFetch = globalThis.fetch;
  const realError = console.error;
  try {
    const patches = [];
    globalThis.fetch = async (url, init = {}) => {
      patches.push(JSON.parse(init.body));
      return new Response(null, { status: 204 });
    };
    const errors = [];
    console.error = (...args) => errors.push(args.join(" "));
    await saveEnquiryAttribution(env, "enquiry-referrer-1", { gclid: "G1", landing_page: "/memorials", referrer: "www.google.com" });
    assert.deepEqual(patches, [{ gclid: "G1", landing_page: "/memorials" }, { referrer: "www.google.com" }], "referrer patched separately from the main attribution patch");
    assert.equal(errors.length, 0);
  } finally {
    globalThis.fetch = realFetch;
    console.error = realError;
  }
}

// A missing `referrer` column (PostgREST names it) must drop ONLY referrer:
// last-touch and lead_channel still land on the retry.
{
  const env = { SUPABASE_URL: "https://db.example", SUPABASE_SERVICE_KEY: "key", SM_ORG_ID: "org" };
  const realFetch = globalThis.fetch;
  try {
    const inserts = [];
    globalThis.fetch = async (url, init = {}) => {
      const body = init.body ? JSON.parse(init.body) : null;
      if (String(url).includes("/people?")) return Response.json([{ id: "person-referrer-2", is_customer: false }]);
      if (String(url).endsWith("/enquiries")) {
        inserts.push(body);
        return "referrer" in body
          ? new Response(JSON.stringify({ code: "PGRST204", message: "Could not find the 'referrer' column of 'enquiries' in the schema cache" }), { status: 400 })
          : Response.json([{ id: "enquiry-referrer-2" }], { status: 201 });
      }
      throw new Error(`Unexpected fetch ${url}`);
    };
    const out = await createEnquiry(env, {
      name: "Referrer Test", email: "r2@example.com", phone: "", channel: "contact",
      attribution: { gclid: "G9", last_gclid: "G9", lead_channel: "Contact form", landing_page: "/memorials", referrer: "www.bing.com" },
    });
    assert.equal(inserts.length, 2);
    assert.ok(!("referrer" in inserts[1]));
    assert.equal(inserts[1].last_gclid, "G9", "last-touch kept when only referrer is missing");
    assert.equal(inserts[1].lead_channel, "Contact form", "lead_channel kept when only referrer is missing");
    assert.equal(out.enquiryId, "enquiry-referrer-2");
  } finally {
    globalThis.fetch = realFetch;
  }
}
console.log("enquiry-attribution: ok");
