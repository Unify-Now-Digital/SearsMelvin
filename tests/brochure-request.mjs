// Brochure form uses /api/submit. Mason enquiry + GHL contact tag "brochure".
import assert from "node:assert/strict";
import { onRequestPost, websiteGhlLabels } from "../functions/api/submit.js";

assert.ok(websiteGhlLabels("brochure").tags.includes("brochure"));

const env = {
  RESEND_API_KEY: "test-resend-key",
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SERVICE_KEY: "test-service-role-key",
  SM_ORG_ID: "00000000-0000-4000-8000-000000000001",
  GHL_API_KEY: "test-ghl-key",
  GHL_LOCATION_ID: "loc-test",
};

const calls = [];
globalThis.fetch = async (input, init = {}) => {
  const url = String(input);
  const body = init.body ? JSON.parse(init.body) : null;
  calls.push({ url, method: init.method || "GET", body });
  if (url.includes("/rpc/check_portal_rate_limit")) return Response.json([{ allowed: true, retry_after_seconds: 0 }]);
  if (url.includes("/rest/v1/people?email=eq.")) return Response.json([{ id: "person-1", is_customer: false, is_test: false }]);
  if (url.includes("/rest/v1/people?id=eq.")) return new Response(null, { status: 204 });
  if (url.includes("/rest/v1/cemeteries")) return Response.json([]);
  if (url.includes("/rest/v1/enquiries") && (init.method || "GET") === "POST") {
    return Response.json([{ id: "enq-1" }]);
  }
  if (url.includes("/rest/v1/enquiries")) return new Response(null, { status: 204 });
  if (url === "https://api.resend.com/emails") return Response.json({ id: "email-1" });
  if (url.includes("/customFields")) return Response.json({ customFields: [
    { id: "f-gclid", fieldKey: "contact.gclid" },
    { id: "f-gbraid", fieldKey: "contact.gbraid" },
    { id: "f-wbraid", fieldKey: "contact.wbraid" },
    { id: "f-utm", fieldKey: "contact.utm_source" },
    { id: "f-lc", fieldKey: "contact.lead_channel" },
  ] });
  if (url.endsWith("/contacts/") && (init.method || "GET") === "POST") return Response.json({ contact: { id: "ghl-1" } });
  if (url.includes("/opportunities/search")) return Response.json({ opportunities: [] });
  if (url.includes("/opportunities")) return Response.json({ opportunity: { id: "opp-1" } });
  if (url.includes("/contacts/")) return Response.json({ ok: true });
  throw new Error(`Unexpected fetch: ${init.method || "GET"} ${url}`);
};

const pending = [];
const response = await onRequestPost({
  env,
  waitUntil: (promise) => pending.push(promise),
  request: new Request("https://searsmelvin.co.uk/api/submit", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "https://searsmelvin.co.uk", "CF-Connecting-IP": "203.0.113.10" },
    body: JSON.stringify({
      channel: "contact",
      enquiry_type: "brochure",
      name: "TEST Brochure",
      email: "test+brochure@unifydigital.uk",
      phone: "07000 000000",
      message: "Brochure request",
      source_page: "/brochure",
      attribution: {
        gclid: "test-gclid",
        gbraid: "test-gbraid",
        wbraid: "test-wbraid",
        utm_source: "google",
        utm_medium: "cpc",
        utm_campaign: "brochure",
      },
    }),
  }),
});
await Promise.all(pending);
const result = await response.json();
assert.equal(result.ok, true);

const enquiry = calls.find((call) => call.url.includes("/rest/v1/enquiries") && call.method === "POST");
assert.ok(enquiry, "Mason enquiry insert");
assert.equal(enquiry.body.sub_type, "brochure");
assert.equal(enquiry.body.channel, "contact");
assert.equal(enquiry.body.lead_channel, "Brochure");
assert.equal(enquiry.body.gclid, "test-gclid");
assert.equal(enquiry.body.gbraid, "test-gbraid");
assert.equal(enquiry.body.wbraid, "test-wbraid");
assert.equal(enquiry.body.utm_source, "google");
const personPatch = calls.find((call) => call.url.includes("/rest/v1/people?id=eq.") && call.method === "PATCH");
assert.equal(personPatch.body.is_test, true);

const contact = calls.find((call) => call.url.endsWith("/contacts/") && call.method === "POST");
assert.ok(contact, "HighLevel contact create");
assert.equal(contact.body.source, "Website brochure");
assert.ok(contact.body.tags.includes("brochure"));
assert.ok(contact.body.tags.includes("test-lead"));
assert.ok(contact.body.tags.includes("channel-brochure"));

const emails = calls.filter((call) => call.url.includes("resend"));
const business = emails.find((call) => call.body && call.body.to === "info@searsmelvin.co.uk");
assert.ok(business, JSON.stringify(emails.map((call) => call.body && { to: call.body.to, subject: call.body.subject })));
assert.equal(business.body.subject, "New Enquiry — TEST Brochure — Brochure");

console.log("brochure-request: ok");
