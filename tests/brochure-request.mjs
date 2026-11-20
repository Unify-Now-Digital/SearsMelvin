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
  if (url.includes("/rest/v1/products?")) {
    return Response.json([{
      id: "product-1",
      name: "The Castell",
      slug: "the-castell",
      base_price: 1450,
      image_url: "/images/castell.jpg",
      inscription_chars_included: 80,
      inscription_price_per_char: 1.95,
      product_categories: { name: "Lawn Headstones", slug: "lawn-headstones" },
    }]);
  }
  if (url.includes("/rest/v1/stone_colours?")) return Response.json([{ name: "Black", slug: "black", is_premium: false, tier: "standard" }]);
  if (url.includes("/rest/v1/product_addons?")) return Response.json([]);
  if (url.includes("/rest/v1/product_sizes?")) return Response.json([]);
  if (url.includes("/rpc/create_quote")) return Response.json({ ok: true, enquiry_id: "enq-quote" });
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
    { id: "f-page", fieldKey: "contact.source_page" },
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
      brochure_source: "home",
      source_page: "/",
      details: { brochure_source: "home", product_slug: "the-castell", product_name: "The Castell" },
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
assert.equal(enquiry.body.source_page, "/");
assert.equal(enquiry.body.details.brochure_source, "home");
assert.equal(enquiry.body.details.product_slug, "the-castell");
assert.equal(enquiry.body.details.product_name, "The Castell");
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
assert.equal(business.body.subject, "New Enquiry — Brochure request: TEST Brochure");
assert.match(business.body.html, /Brochure sent to test\+brochure@unifydigital\.uk at \d{2}:\d{2} on \d{1,2} [A-Z][a-z]{2} \d{4}/);
assert.match(business.body.text, /^Brochure sent to test\+brochure@unifydigital\.uk at \d{2}:\d{2} on \d{1,2} [A-Z][a-z]{2} \d{4}/);
assert.doesNotMatch(business.body.html.match(/Brochure sent to [^<]+/)[0], /delivered|received|opened/i);
assert.doesNotMatch(business.body.text.split("\n")[0], /delivered|received|opened/i);
assert.match(business.body.html, /Source/);
assert.match(business.body.text, /Source: Home/);
assert.match(business.body.html, /https:\/\/app\.gohighlevel\.com\/v2\/location\/loc-test\/contacts\/detail\/ghl-1/);
const family = emails.find((call) => call.body && call.body.to === "test+brochure@unifydigital.uk");
assert.equal(family.body.subject, "Your Sears Melvin brochure");
assert.match(family.body.html, /sears-melvin-brochure\.pdf\?v=10\.1/);
assert.match(family.body.text, /Download the brochure:/);
assert.equal(family.body.attachments, undefined);
assert.doesNotMatch(family.body.html, /We have received your enquiry/);
assert.ok(calls.findIndex((call) => call.body && call.body.to === "test+brochure@unifydigital.uk") < calls.findIndex((call) => call.body && call.body.to === "info@searsmelvin.co.uk"));
const note = calls.find((call) => call.method === "POST" && call.url.includes("/notes"));
assert.match(note.body.body, /Source: Home/);
assert.match(note.body.body, /Page: \//);
assert.match(note.body.body, /Product: The Castell/);
assert.ok(contact.body.customFields.some((field) => field.id === "f-page" && field.field_value === "/"));
assert.ok(contact.body.customFields.some((field) => field.key === "memorial_product" && field.field_value === "The Castell"));
assert.equal(calls.some((call) => String(call.url).includes("GHL_CM_PIT_TOKEN") || String(call.url).includes("GHL_SM_PIT_TOKEN")), false);
assert.equal(calls.some((call) => call.url.includes("/opportunities")), false, "brochure must not call HighLevel opportunities");

function opportunityCreates() {
  return calls.filter((call) => call.method === "POST" && call.url.includes("/opportunities"));
}

async function post(body) {
  calls.length = 0;
  pending.length = 0;
  const res = await onRequestPost({
    env,
    waitUntil: (promise) => pending.push(promise),
    request: new Request("https://searsmelvin.co.uk/api/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://searsmelvin.co.uk", "CF-Connecting-IP": "203.0.113.11" },
      body: JSON.stringify(body),
    }),
  });
  await Promise.all(pending);
  return res.json();
}

{
  const contactResult = await post({
    channel: "contact",
    enquiry_type: "question",
    name: "TEST Contact",
    email: "test+contact@unifydigital.uk",
    message: "Please call.",
  });
  assert.equal(contactResult.ok, true);
  assert.ok(calls.some((call) => call.method === "POST" && call.url.endsWith("/contacts/")), "contact post creates a HighLevel contact");
  assert.equal(opportunityCreates().length, 1, "contact post still creates an opportunity");
}

{
  const quoteResult = await post({
    channel: "quote",
    name: "TEST Quote",
    email: "test+quote@unifydigital.uk",
    product: { name: "The Castell", slug: "the-castell", colour: "Black", price: "1450" },
  });
  assert.equal(quoteResult.ok, true);
  assert.ok(calls.some((call) => call.method === "POST" && call.url.endsWith("/contacts/")), "quote post creates a HighLevel contact");
  assert.equal(opportunityCreates().length, 1, "quote post still creates an opportunity");
}

console.log("brochure-request: ok");
