// Brochure email → SM GHL opportunity (New Lead), skip when an open card exists, fail soft.
import assert from "node:assert/strict";
import { contactDisplayName, upsertBrochureContact, createBrochureOpportunity, brochureOppName, SM_PIPELINE_ID, SM_NEW_LEAD_STAGE_ID } from "../functions/api/brochure.js";

const env = { SM_GHL_PIT_CALL_TRANSCRIPTS: "x" };
const ok = (b) => ({ ok: true, status: 200, json: async () => b });
function mock(openOpps, { failSearch = false, failCreate = false } = {}) {
  const calls = [];
  const f = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method || "GET", body: init.body ? JSON.parse(init.body) : null });
    if (url.includes("/contacts/upsert")) return ok({ contact: { id: "c1", firstName: "Jo", lastName: "Bloggs" } });
    if (url.includes("/opportunities/search")) return failSearch ? { ok: false, status: 500, json: async () => ({}) } : ok({ opportunities: openOpps });
    if (url.endsWith("/opportunities/")) return failCreate ? { ok: false, status: 422, json: async () => ({}) } : ok({ opportunity: { id: "o1" } });
    return ok({});
  };
  return { f, calls };
}

assert.equal(brochureOppName("", "a@b.co"), "Brochure – a@b.co");
assert.equal(brochureOppName(" Jo Bloggs ", "a@b.co"), "Brochure – Jo Bloggs");

{ // creates at New Lead
  const { f, calls } = mock([]);
  const r = await createBrochureOpportunity(env, { contactId: "c1", name: "", email: "a@b.co" }, f);
  assert.deepEqual(r, { created: true, id: "o1" });
  const s = calls.find((c) => c.url.includes("/opportunities/search"));
  assert.match(s.url, /pipeline_id=ty7z50OQyVGXMS1NARrK/); assert.match(s.url, /location_id=7JJQ1fkS2z8zv5XIDV0P/);
  const c = calls.find((c) => c.method === "POST" && c.url.endsWith("/opportunities/"));
  assert.equal(c.body.pipelineId, SM_PIPELINE_ID); assert.equal(c.body.pipelineStageId, SM_NEW_LEAD_STAGE_ID);
  assert.equal(c.body.name, "Brochure – a@b.co"); assert.equal(c.body.contactId, "c1");
}
{ // skips when open opp exists in pipeline
  const { f, calls } = mock([{ id: "old", pipelineId: SM_PIPELINE_ID, status: "open" }]);
  const r = await createBrochureOpportunity(env, { contactId: "c1", email: "a@b.co" }, f);
  assert.deepEqual(r, { skipped: "open_exists", id: "old" });
  assert.ok(!calls.some((c) => c.method === "POST" && c.url.endsWith("/opportunities/")));
}
{ // open opp in another pipeline does not block
  const { f } = mock([{ id: "x", pipelineId: "other", status: "open" }]);
  assert.equal((await createBrochureOpportunity(env, { contactId: "c1", email: "a@b.co" }, f)).created, true);
}
{ // full upsert uses contact name; failures never throw
  const { f, calls } = mock([]);
  assert.equal(await upsertBrochureContact(env, "a@b.co", {}, f), "c1");
  assert.equal(calls.find((c) => c.url.endsWith("/opportunities/")).body.name, "Brochure – Jo Bloggs");
  for (const opt of [{ failSearch: true }, { failCreate: true }]) {
    const m = mock([], opt);
    assert.equal(await upsertBrochureContact(env, "a@b.co", {}, m.f), "c1");
  }
  const thrower = async (u, i) => (String(u).includes("/opportunities") ? Promise.reject(new Error("net")) : mock([]).f(u, i));
  assert.equal(await upsertBrochureContact(env, "a@b.co", {}, thrower), "c1");
}
assert.deepEqual(await createBrochureOpportunity({}, { contactId: "c1" }, mock([]).f), { skipped: "no_token_or_contact" });
assert.equal(contactDisplayName({ lastName: "Smith" }), "Smith");
assert.equal(contactDisplayName({ name: "Ann Lee" }), "Ann Lee");
assert.equal(contactDisplayName({ firstName: "Jo", lastName: "B" }), "Jo B");
assert.equal(contactDisplayName({}), "");

{ // existing contact attribution fields are fill-only before upsert
  const calls = [];
  const f = async (url, init = {}) => {
    const call = { url: String(url), method: init.method || "GET", body: init.body ? JSON.parse(init.body) : null };
    calls.push(call);
    if (call.url.includes("/customFields")) return ok({ customFields: [
      { id: "source-id", fieldKey: "contact.utm_source" },
      { id: "medium-id", fieldKey: "contact.utm_medium" },
    ] });
    if (call.url.includes("/contacts/search/duplicate")) return ok({ contact: { id: "existing", customFields: [{ id: "source-id", field_value: "original" }] } });
    if (call.url.endsWith("/contacts/upsert")) return ok({ contact: { id: "existing" } });
    if (call.url.includes("/opportunities/search")) return ok({ opportunities: [{ id: "old", pipelineId: SM_PIPELINE_ID, status: "open" }] });
    return ok({});
  };
  await upsertBrochureContact(env, "existing@example.com", { attribution: { utm_source: "new", utm_medium: "cpc" } }, f);
  const body = calls.find((c) => c.url.endsWith("/contacts/upsert")).body;
  assert.deepEqual(body.customFields, [{ id: "medium-id", field_value: "cpc" }]);
  assert.equal(body.locationId, "7JJQ1fkS2z8zv5XIDV0P");
}
console.log("brochure-opp tests passed");
