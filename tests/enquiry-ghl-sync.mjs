import assert from "node:assert/strict";
import {
  attributionCustomFields,
  createEnquiry,
  createGHLContact,
  saveEnquiryGhlContactId,
  shouldReplaceGhlSource,
  websiteGhlLabels,
} from "../functions/api/submit.js";

// ── Labels ──────────────────────────────────────────────────────────
assert.deepEqual(websiteGhlLabels("quote"), {
  source: "Website quote",
  tags: ["website-quote", "website-lead", "quote-request"],
});
assert.equal(websiteGhlLabels("enquiry").source, "Website enquiry");
assert.equal(websiteGhlLabels("appointment").source, "Website appointment");
assert.equal(shouldReplaceGhlSource("chat widget", "Website quote"), true);
assert.equal(shouldReplaceGhlSource("", "Website quote"), true);
assert.equal(shouldReplaceGhlSource("Website enquiry", "Website quote"), true);
assert.equal(shouldReplaceGhlSource("YOPA", "Website quote"), false);
assert.equal(shouldReplaceGhlSource("Website quote", "Website quote"), false);

// ── 1) Click IDs + UTMs + landing page → GHL custom fields (create) ──
{
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ url: String(url), method: init.method || "GET", body });
    if (String(url).includes("/customFields")) {
      return Response.json({ customFields: [
        { id: "f-gclid", fieldKey: "contact.contactgclid" },
        { id: "f-utm", fieldKey: "contact.contactutm_source" },
        { id: "f-utm-med", fieldKey: "contact.contactutm_medium" },
        { id: "f-lp", fieldKey: "contact.landing_page" },
        { id: "f-ls", fieldKey: "contact.lead_source" },
        { id: "f-lc", fieldKey: "contact.lead_channel" },
        { id: "f-ad", fieldKey: "contact.ad_source" },
      ] });
    }
    if (String(url).endsWith("/contacts/")) {
      return Response.json({ contact: { id: "new-c1" } }, { status: 201 });
    }
    return Response.json({ ok: true });
  };
  const lead = {
    gclid: "GCLICK", utm_source: "google", utm_medium: "cpc",
    landing_page: "/memorials", lead_source: "Google Ads", lead_channel: "RAQ",
  };
  const attributionFields = await attributionCustomFields(
    { GHL_API_KEY: "t", GHL_LOCATION_ID: "loc" },
    lead,
    { fetchImpl },
  );
  assert.deepEqual(attributionFields, [
    { id: "f-gclid", field_value: "GCLICK" },
    { id: "f-utm", field_value: "google" },
    { id: "f-utm-med", field_value: "cpc" },
  ]);
  const id = await createGHLContact(
    { GHL_API_KEY: "t", GHL_LOCATION_ID: "loc" },
    { name: "Emily N", email: "e@example.com", type: "quote", attributionFields, lead, fetchImpl },
  );
  assert.equal(id, "new-c1");
  const create = calls.find((c) => c.method === "POST" && c.url.endsWith("/contacts/"));
  assert.equal(create.body.source, "Website quote");
  assert.ok(create.body.tags.includes("website-quote"));
  assert.ok(!create.body.tags.includes("chat-lead"));
  const ids = create.body.customFields.map((f) => f.id);
  assert.ok(ids.includes("f-gclid"), "gclid custom field");
  assert.ok(ids.includes("f-utm"), "utm_source custom field");
  assert.ok(ids.includes("f-lp"), "landing_page custom field");
  assert.ok(ids.includes("f-ls"), "lead_source custom field");
  assert.ok(ids.includes("f-ad"), "ad_source custom field");
}

// ── 1b) Duplicate chat-widget contact: fill-blank first-touch + relabel ──
{
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ url: String(url), method: init.method || "GET", body });
    if (String(url).includes("/customFields")) {
      return Response.json({ customFields: [
        { id: "f-gclid", fieldKey: "contact.contactgclid" },
        { id: "f-last", fieldKey: "contact.last_gclid" },
        { id: "f-lp", fieldKey: "contact.landing_page" },
      ] });
    }
    if (String(url).endsWith("/contacts/")) {
      return new Response(JSON.stringify({
        message: "This location does not allow duplicated contacts.",
        meta: { contactId: "chat-c1" },
      }), { status: 400 });
    }
    if (String(url).endsWith("/contacts/chat-c1") && !init.method) {
      return Response.json({ contact: {
        source: "chat widget",
        firstName: "Emily", lastName: "N", phone: "+447700",
        customFields: [{ id: "f-gclid", field_value: "" }],
      } });
    }
    return Response.json({ ok: true });
  };
  const lead = { gclid: "NEWG", last_gclid: "LASTG", landing_page: "/memorials", lead_source: "Google Ads", lead_channel: "RAQ" };
  const attributionFields = await attributionCustomFields(
    { GHL_API_KEY: "t", GHL_LOCATION_ID: "loc2" }, lead, { fetchImpl },
  );
  const id = await createGHLContact(
    { GHL_API_KEY: "t", GHL_LOCATION_ID: "loc2" },
    { name: "Emily N", email: "e@example.com", phone: "+447700", type: "quote", attributionFields, lead, fetchImpl },
  );
  assert.equal(id, "chat-c1");
  const put = calls.find((c) => c.method === "PUT");
  assert.equal(put.body.source, "Website quote", "chat widget source replaced");
  const fieldIds = (put.body.customFields || []).map((f) => f.id);
  assert.ok(fieldIds.includes("f-gclid"), "blank first-touch gclid filled");
  assert.ok(fieldIds.includes("f-last"), "last-touch always written");
  const tags = calls.find((c) => c.url.endsWith("/tags"));
  assert.ok(tags.body.tags.includes("website-quote"));
  assert.ok(tags.body.tags.includes("returning-enquiry"));
}

// ── 2) ghl_contact_id write-back after create/match ──────────────────
{
  const patches = [];
  const env = { SUPABASE_URL: "https://db.example", SUPABASE_SERVICE_KEY: "k", SM_ORG_ID: "org" };
  globalThis.fetch = async (url, init = {}) => {
    patches.push({ url: String(url), method: init.method || "GET", body: init.body ? JSON.parse(init.body) : null, headers: init.headers });
    return new Response(null, { status: 204 });
  };
  await saveEnquiryGhlContactId(env, "enq-99", "ghl-abc");
  assert.equal(patches.length, 1);
  assert.match(patches[0].url, /enquiries\?id=eq\.enq-99/);
  assert.equal(patches[0].method, "PATCH");
  assert.deepEqual(patches[0].body, { ghl_contact_id: "ghl-abc" });
  patches.length = 0;
  await saveEnquiryGhlContactId(env, null, "ghl-abc");
  await saveEnquiryGhlContactId(env, "enq-99", null);
  assert.equal(patches.length, 0, "no write without both ids");
}

// createEnquiry returns enquiryId from Prefer return=representation
{
  const env = { SUPABASE_URL: "https://db.example", SUPABASE_SERVICE_KEY: "k", SM_ORG_ID: "org" };
  globalThis.fetch = async (url, init = {}) => {
    if (String(url).includes("/people?")) return Response.json([{ id: "p1", is_customer: false }]);
    if (String(url).includes("/people?id=")) return new Response(null, { status: 204 });
    if (String(url).endsWith("/enquiries")) {
      assert.equal(init.headers.Prefer, "return=representation");
      return Response.json([{ id: "enq-from-insert" }], { status: 201 });
    }
    throw new Error(`unexpected ${url}`);
  };
  const saved = await createEnquiry(env, {
    name: "T", email: "t@example.com", phone: "", channel: "contact",
    attribution: { gclid: "G1", lead_source: "Google Ads", lead_channel: "Contact form" },
  });
  assert.equal(saved.enquiryId, "enq-from-insert");
  assert.equal(saved.personId, "p1");
}

console.log("enquiry-ghl-sync: ok");
