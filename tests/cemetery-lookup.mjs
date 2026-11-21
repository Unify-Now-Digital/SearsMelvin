// Contact-form cemetery lookup calls the shared Mason function.
import assert from "node:assert/strict";
import { lookupCemeteryIdByName } from "../functions/api/submit.js";

const env = {
  SUPABASE_URL: "https://example.test",
  SUPABASE_SERVICE_KEY: "service-key",
  SM_ORG_ID: "sm-org",
};

const originalFetch = globalThis.fetch;

async function withFetch(handler, run) {
  globalThis.fetch = handler;
  try {
    return await run();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

const woodId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
const calls = [];
const matched = await withFetch(async (url, init) => {
  calls.push({ url: String(url), body: init?.body });
  return new Response(JSON.stringify(woodId), { status: 200 });
}, () => lookupCemeteryIdByName(env, "Woodgrange Park Cemetery, London E7"));

assert.equal(matched, woodId);
assert.equal(calls.length, 1);
assert.equal(calls[0].url, "https://example.test/rest/v1/rpc/match_web_enquiry_cemetery");
assert.equal(JSON.parse(calls[0].body).p_text, "Woodgrange Park Cemetery, London E7");
assert.equal(calls[0].url.includes("organization_id"), false);
assert.equal(calls[0].body.includes("sm-org"), false);

const ambiguous = await withFetch(
  async () => new Response("null", { status: 200, headers: { "content-type": "application/json" } }),
  () => lookupCemeteryIdByName(env, "St Helens"),
);
assert.equal(ambiguous, null);

const missing = await withFetch(
  async () => new Response("{}", { status: 404 }),
  () => lookupCemeteryIdByName(env, "Nowhere Cemetery"),
);
assert.equal(missing, null);
assert.equal(await lookupCemeteryIdByName(env, "ab"), null);

console.log("cemetery lookup tests passed");
