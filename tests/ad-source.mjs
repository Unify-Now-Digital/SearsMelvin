import assert from "node:assert/strict";
import { adSourceCustomField, createGHLContact, deriveLeadSource, isGoogleAdsLead } from "../functions/api/submit.js";
import { upsertBrochureContact } from "../functions/api/brochure.js";

for (const attribution of [{ gclid: "g" }, { gbraid: "b" }, { wbraid: "w" }, { utm_source: "GoOgLe", utm_medium: "CPC-search" }, { utm_source: "google" }]) {
  assert.equal(isGoogleAdsLead(attribution), true);
}
for (const attribution of [{ utm_source: "google", utm_medium: "organic" }, { utm_source: "google", utm_medium: "referral" }, { utm_source: "bing", utm_medium: "cpc" }, {}]) {
  assert.equal(isGoogleAdsLead(attribution), false);
}
assert.equal(deriveLeadSource({ utm_source: "google" }), "Google Ads");

const response = (status, body = {}) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const baseEnv = { GHL_API_KEY: "test", GHL_LOCATION_ID: "ad-source-tests", GHL_AD_SOURCE_FIELD_ID: "ad-source-id" };
const contactArgs = { name: "Ads Lead", email: "ads@example.com", type: "enquiry", lead: { gclid: "click" } };

{
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    return response(200, { contact: { id: "created" } });
  };
  assert.equal(await createGHLContact(baseEnv, { ...contactArgs, fetchImpl }), "created");
  const body = JSON.parse(calls[0].init.body);
  assert.ok(body.customFields.some((f) => f.id === "ad-source-id" && f.field_value === "Google Ads"));
  assert.equal(body.tags.filter((t) => t === "source-google-ads").length, 1);
}

{
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    return response(200, { contact: { id: "not-ads" } });
  };
  await createGHLContact(baseEnv, { ...contactArgs, lead: { utm_source: "google", utm_medium: "organic" }, fetchImpl });
  const body = JSON.parse(calls[0].init.body);
  assert.ok(!body.customFields.some((f) => f.id === "ad-source-id"));
  assert.ok(!body.tags.includes("source-google-ads"));
}

{
  const env = { GHL_API_KEY: "test", GHL_LOCATION_ID: "missing-ad-source-tests" };
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if (String(url).includes("/customFields")) return response(200, { customFields: [] });
    return response(200, { contact: { id: "missing-field" } });
  };
  await createGHLContact(env, { ...contactArgs, fetchImpl });
  const create = calls.find((c) => c.url.endsWith("/contacts/"));
  const body = JSON.parse(create.init.body);
  assert.ok(!body.customFields.some((f) => f.field_value === "Google Ads"));
  assert.ok(body.tags.includes("source-google-ads"));
  assert.deepEqual(await adSourceCustomField(env, {}, { fetchImpl }), []);
}

for (const [existingValue, expectPut] of [["Referral", false], ["", true]]) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if (calls.length === 1) return response(409, { message: "duplicate contact", meta: { contactId: `duplicate-${expectPut}` } });
    if ((init.method || "GET") === "GET") return response(200, { contact: { customFields: [{ id: "ad-source-id", field_value: existingValue }] } });
    return response(200);
  };
  await createGHLContact(baseEnv, { ...contactArgs, fetchImpl });
  const put = calls.find((c) => c.init.method === "PUT");
  assert.equal(Boolean(put), expectPut);
  if (put) assert.deepEqual(JSON.parse(put.init.body), { customFields: [{ id: "ad-source-id", field_value: "Google Ads" }] });
}

{
  const calls = [];
  const env = { SM_GHL_PIT_CALL_TRANSCRIPTS: "pit", GHL_AD_SOURCE_FIELD_ID: "brochure-ad-source" };
  const fetchImpl = async (url, init = {}) => {
    const call = { url: String(url), init };
    calls.push(call);
    if (call.url.includes("/contacts/search/duplicate")) return response(404);
    if (call.url.endsWith("/contacts/upsert")) return response(200, { contact: { id: "brochure-contact" } });
    if (call.url.includes("/opportunities/search")) return response(200, { opportunities: [{ id: "existing", pipelineId: "ty7z50OQyVGXMS1NARrK", status: "open" }] });
    return response(200);
  };
  await upsertBrochureContact(env, "brochure@example.com", { attribution: { wbraid: "braid" } }, fetchImpl);
  const upsert = JSON.parse(calls.find((c) => c.url.endsWith("/contacts/upsert")).init.body);
  assert.ok(upsert.customFields.some((f) => f.id === "brochure-ad-source" && f.field_value === "Google Ads"));
  assert.ok(upsert.tags.includes("source-google-ads"));
  const tags = JSON.parse(calls.find((c) => c.url.endsWith("/tags")).init.body).tags;
  assert.ok(tags.includes("source-google-ads"));
}

console.log("ad source tests passed");
