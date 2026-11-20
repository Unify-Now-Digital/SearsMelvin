// Brochure family email, staff alert, and the generic enquiry receipt.
// Fetch is mocked. No email is sent. No HighLevel or enquiry write leaves this process.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

import { onRequestPost as submit } from "../functions/api/submit.js";
import { onRequestPost as brochureApi } from "../functions/api/brochure.js";
import {
  brochureStaffStatusLine,
  internalBrochureTestRecipient,
} from "../functions/api/_email-brand.js";

const require = createRequire(import.meta.url);
const up = require("../site-upgrades.js");

const SENT_AT = new Date("2026-11-20T12:13:00Z");
const sentLine = brochureStaffStatusLine({ accepted: true, email: "alex@example.com", at: SENT_AT });
assert.equal(sentLine, "Brochure sent to alex@example.com at 12:13 on 20 Nov 2026 UK time");
assert.doesNotMatch(sentLine, /delivered|received|opened/i);
assert.equal(
  brochureStaffStatusLine({ accepted: false, email: "alex@example.com", at: SENT_AT }),
  "Brochure email failed: please send it manually",
);
assert.equal(brochureStaffStatusLine({ accepted: true, email: "" }), "Brochure email failed: please send it manually");
assert.equal(internalBrochureTestRecipient("alex@example.com"), "alex@example.com");
assert.equal(internalBrochureTestRecipient("qa@searsmelvin.co.uk"), "qa@searsmelvin.co.uk");
assert.throws(() => internalBrochureTestRecipient("person@gmail.com"), /internal address/);
assert.doesNotMatch(readFileSync(new URL("../functions/api/submit.js", import.meta.url), "utf8"), /BROCHURE_TEST_TO/);
assert.doesNotMatch(readFileSync(new URL("../functions/api/submit.js", import.meta.url), "utf8"), /GHL_CM_PIT_TOKEN|GHL_SM_PIT_TOKEN/);

assert.equal(
  up.brochureQueryTail("/memorials/the-castell", "the-castell", "The Castell"),
  "&page=%2Fmemorials%2Fthe-castell&item=the-castell&name=The%20Castell",
);
assert.equal(up.brochureQueryTail("javascript:alert(1)", "../admin", "<b>"), "");
assert.deepEqual(
  up.readBrochureArrival("?from=product&page=%2Fmemorials%2Fthe-castell&item=the-castell&name=The%20Castell"),
  { source: "product", page: "/memorials/the-castell", slug: "the-castell", name: "The Castell" },
);
const productPayload = up.brochureRequestPayload(
  { name: "Alex Taylor", email: "alex@example.com", phone: "020 7946 0123" },
  null,
  "/brochure",
  up.readBrochureArrival("?from=home&page=%2F"),
);
assert.equal(productPayload.brochure_source, "home");
assert.equal(productPayload.source_page, "/");
assert.equal(productPayload.enquiry_type, "brochure");
assert.equal(up.brochureThanksTitle("Alex Taylor"), "Thank you, Alex.");
assert.equal(up.brochureThanksTitle("!!!"), "Thank you.");
assert.deepEqual(up.brochureEvents({}, "header", false).dataLayer, [{ event: "brochure_download", source: "header", email_given: false }]);
assert.deepEqual(up.brochureRequestEvent("listing"), { event: "brochure_request", source: "listing" });
assert.match(readFileSync("site-upgrades.js", "utf8"), /event: 'brochure_download'/);
assert.match(readFileSync("brochure.html", "utf8"), /A copy is also on its way to your inbox/);
assert.match(readFileSync("brochure.html", "utf8"), /data-brochure-thanks-title/);
assert.match(readFileSync("brochure.html", "utf8"), /data-brochure-link/);
assert.match(readFileSync("brochure.html", "utf8"), /<label for="brochurePhone">Phone<\/label>\s*<input type="tel" id="brochurePhone" name="phone" autocomplete="tel" inputmode="tel" maxlength="40">/);
assert.doesNotMatch(readFileSync("brochure.html", "utf8"), /brochurePhone[^>]*>Phone <span>\(optional\)<\/span>/);
assert.match(readFileSync("site-upgrades.css", "utf8"), /\.sm-brochure-thanks a\[data-brochure-link\]/);
assert.match(readFileSync("site-upgrades.js", "utf8"), /href', '\/brochure\?from=' \+ src/);

const env = {
  RESEND_API_KEY: "test-resend-key",
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SERVICE_KEY: "test-service-role-key",
  SM_ORG_ID: "00000000-0000-4000-8000-000000000001",
  GHL_API_KEY: "test-ghl-key",
  GHL_LOCATION_ID: "loc-test",
  BROCHURE_EMAIL_TIMEOUT_MS: "40",
};

let familyMode = "ok";
const calls = [];
globalThis.fetch = async (input, init = {}) => {
  const url = String(input);
  const body = init.body ? JSON.parse(init.body) : null;
  calls.push({ url, method: init.method || "GET", body, auth: init.headers?.Authorization || init.headers?.authorization || "" });
  if (url.includes("/rpc/check_portal_rate_limit")) return Response.json([{ allowed: true, retry_after_seconds: 0 }]);
  if (url.includes("/rest/v1/people")) return url.includes("id=eq.") ? new Response(null, { status: 204 }) : Response.json([{ id: "person-1", is_customer: false, is_test: false }]);
  if (url.includes("/rest/v1/cemeteries")) return Response.json([]);
  if (url.includes("/rest/v1/enquiries") && (init.method || "GET") === "POST") return Response.json([{ id: "enq-1" }]);
  if (url.includes("/rest/v1/enquiries")) return new Response(null, { status: 204 });
  if (url === "https://api.resend.com/emails") {
    const toStaff = body && body.to === "info@searsmelvin.co.uk";
    if (!toStaff && familyMode === "http") return new Response("no", { status: 502 });
    if (!toStaff && familyMode === "noid") return Response.json({ ok: true });
    if (!toStaff && familyMode === "timeout") {
      return await new Promise((resolve, reject) => {
        const fail = () => {
          const err = new Error("timeout");
          err.name = "TimeoutError";
          reject(err);
        };
        if (init.signal?.aborted) fail();
        else init.signal?.addEventListener("abort", fail, { once: true });
        setTimeout(fail, 80);
      });
    }
    return Response.json({ id: toStaff ? "email-staff" : "email-family" });
  }
  if (url.includes("/customFields")) return Response.json({ customFields: [{ id: "f-page", fieldKey: "contact.source_page" }] });
  if (url.endsWith("/contacts/") && (init.method || "GET") === "POST") return Response.json({ contact: { id: "ghl-1" } });
  if (url.includes("/opportunities/search")) return Response.json({ opportunities: [] });
  if (url.includes("/opportunities")) return Response.json({ opportunity: { id: "opp-1" } });
  if (url.includes("/contacts/")) return Response.json({ ok: true });
  throw new Error(`Unexpected fetch: ${init.method || "GET"} ${url}`);
};

function brochureBody(extra = {}) {
  return {
    channel: "contact",
    enquiry_type: "brochure",
    name: "Alex Taylor",
    email: "alex@example.com",
    phone: "020 7946 0123",
    message: "Brochure request",
    brochure_source: "home",
    source_page: "/",
    details: { brochure_source: "home" },
    attribution: { gclid: "test-gclid", utm_source: "google", utm_medium: "cpc", utm_campaign: "memorials_search" },
    ...extra,
  };
}

async function post(body, url = "https://searsmelvin.co.uk/api/submit") {
  calls.length = 0;
  const pending = [];
  const response = await submit({
    env,
    waitUntil: (promise) => pending.push(promise),
    request: new Request(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: new URL(url).origin, "CF-Connecting-IP": "203.0.113.20" },
      body: JSON.stringify(body),
    }),
  });
  await Promise.all(pending);
  return response.json();
}

function emails() {
  return calls.filter((call) => call.url === "https://api.resend.com/emails");
}
function statusLine(mail) {
  return mail.text.split("\n")[0];
}

{
  familyMode = "ok";
  const result = await post(brochureBody());
  assert.equal(result.ok, true);
  const sent = emails();
  const family = sent.find((call) => call.body.to === "alex@example.com");
  const staff = sent.find((call) => call.body.to === "info@searsmelvin.co.uk");
  assert.equal(family.body.subject, "Your Sears Melvin brochure");
  assert.match(family.body.html, /assets\/sears-melvin-brochure\.pdf\?v=10\.1/);
  assert.match(family.body.text, /Download the brochure:/);
  assert.match(family.body.html, /call us on <span[^>]*>020 3835 2548<\/span>/);
  assert.match(family.body.text, /or call us on 020 3835 2548/);
  assert.doesNotMatch(family.body.html, /tel:/);
  assert.doesNotMatch(family.body.text, /tel:/);
  assert.doesNotMatch(family.body.html, />Call</);
  assert.equal(family.body.attachments, undefined);
  assert.doesNotMatch(family.body.subject, /We have received your enquiry/);
  assert.equal(staff.body.subject, "New Enquiry — Brochure request: Alex Taylor");
  assert.match(statusLine(staff.body), /^Brochure sent to alex@example.com at \d{2}:\d{2} on \d{1,2} [A-Z][a-z]{2} \d{4} UK time$/);
  assert.doesNotMatch(statusLine(staff.body), /delivered|received|opened/i);
  assert.match(staff.body.html, new RegExp(statusLine(staff.body).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.ok(staff.body.html.indexOf(statusLine(staff.body)) < staff.body.html.indexOf("<h1"));
  assert.match(staff.body.text, /Source: Home/);
  assert.match(staff.body.text, /Ad: Google Ads · memorials_search/);
  assert.match(staff.body.text, /UK time/);
  assert.equal(calls.find((call) => call.url.endsWith("/contacts/")).auth, "Bearer test-ghl-key");
  const enquiry = calls.find((call) => call.url.includes("/rest/v1/enquiries") && call.method === "POST");
  assert.equal(enquiry.body.source_page, "/");
  assert.equal(enquiry.body.details.brochure_source, "home");
}

for (const mode of ["http", "noid", "timeout"]) {
  familyMode = mode;
  const result = await post(brochureBody());
  assert.equal(result.ok, true, mode);
  const sent = emails();
  const staff = sent.find((call) => call.body.to === "info@searsmelvin.co.uk");
  assert.ok(staff, `${mode}: staff alert still sent`);
  assert.equal(statusLine(staff.body), "Brochure email failed: please send it manually");
  assert.match(staff.body.html, /Brochure email failed: please send it manually/);
  assert.doesNotMatch(staff.body.html, /Brochure sent to/);
  assert.doesNotMatch(staff.body.text, /Brochure sent to/);
  assert.doesNotMatch(statusLine(staff.body), /delivered|received|opened/i);
}

{
  familyMode = "ok";
  const result = await post({
    channel: "contact",
    enquiry_type: "question",
    name: "Alex Taylor",
    email: "alex@example.com",
    phone: "020 7946 0123",
    message: "I would like advice on a lawn memorial.",
    source_page: "/contact",
  });
  assert.equal(result.ok, true);
  const sent = emails();
  const family = sent.find((call) => call.body.to === "alex@example.com");
  const staff = sent.find((call) => call.body.to === "info@searsmelvin.co.uk");
  assert.equal(family.body.subject, "We have received your enquiry — Sears Melvin Memorials");
  assert.match(family.body.html, /within one working day/);
  assert.match(family.body.html, /call <span[^>]*>020 3835 2548<\/span>/);
  assert.match(family.body.text, /If you need us sooner, call 020 3835 2548/);
  assert.doesNotMatch(family.body.html, /tel:/);
  assert.doesNotMatch(family.body.text, /tel:/);
  assert.doesNotMatch(family.body.html, />Call</);
  assert.match(family.body.text, /within one working day/);
  assert.match(staff.body.html, />Call</);
  assert.doesNotMatch(family.body.html, /sears-melvin-brochure\.pdf/);
  assert.equal(staff.body.subject, "New Enquiry — Alex Taylor — Question");
  assert.doesNotMatch(staff.body.html, /Brochure sent to/);
  assert.doesNotMatch(staff.body.text, /Brochure email failed/);
}

{
  familyMode = "ok";
  const result = await post(brochureBody(), "https://preview.sears-melvin-memorials.pages.dev/api/submit");
  assert.equal(result.ok, true);
  assert.equal(emails().length, 0, "preview sends no email");
  assert.equal(calls.some((call) => call.url.includes("/rest/v1/enquiries")), false, "preview writes no enquiry");
  assert.equal(calls.some((call) => call.url.includes("leadconnectorhq")), false, "preview writes no HighLevel contact");
}

{
  const pending = [];
  calls.length = 0;
  const response = await brochureApi({
    env,
    waitUntil: (promise) => pending.push(promise),
    request: new Request("https://preview.sears-melvin-memorials.pages.dev/api/brochure", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://preview.sears-melvin-memorials.pages.dev", "CF-Connecting-IP": "203.0.113.21" },
      body: JSON.stringify({ action: "email", email: "alex@example.com", source: "home" }),
    }),
  });
  await Promise.all(pending);
  assert.equal((await response.json()).ok, true);
  assert.equal(emails().length, 0, "preview brochure action sends no email");
  assert.equal(calls.some((call) => call.url.includes("leadconnectorhq")), false);
}

console.log("brochure-emails: ok");
