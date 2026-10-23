import assert from "node:assert/strict";
import { isTestSubmission } from "../functions/api/_test-flags.js";
import { upsertBrochureContact } from "../functions/api/brochure.js";

for (const input of [
  { name: "TEST Ads" }, { firstName: "Test" }, { lastName: "qa-test" },
  { email: "person+qa@gmail.com" }, { email: "person+test@gmail.com" },
  { email: "test+ads@gmail.com" }, { email: "test@gmail.com" },
  { email: "person@example.com" }, { email: "person@test.com" },
  { email: "admin@unifynow.digital" }, { email: "info+qa@searsmelvin.co.uk" },
  { gclid: "TEST-QA" }, { gbraid: "test123" }, { utm_campaign: "qa" }, { utm_source: "test" },
]) assert.equal(isTestSubmission(input).is_test, true, JSON.stringify(input));

for (const input of [
  { name: "Celeste" }, { name: "Testa" }, { email: "real.person@gmail.com" },
  { utm_source: "google", utm_campaign: "real-sale", gclid: "real-click" },
]) assert.deepEqual(isTestSubmission(input), { is_test: false, reasons: [] }, JSON.stringify(input));

{
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if (String(url).endsWith("/contacts/upsert")) return Response.json({ contact: { id: "test-contact" } });
    if (String(url).includes("/opportunities/search")) return Response.json({ opportunities: [{ id: "existing", pipelineId: "ty7z50OQyVGXMS1NARrK", status: "open" }] });
    return Response.json({});
  };
  await upsertBrochureContact({ SM_GHL_PIT_CALL_TRANSCRIPTS: "token" }, "person+qa@gmail.com", {}, fetchImpl);
  const create = JSON.parse(calls.find((call) => call.url.endsWith("/contacts/upsert")).init.body);
  assert.ok(create.tags.includes("test-lead"));
}

console.log("test flag tests passed");
