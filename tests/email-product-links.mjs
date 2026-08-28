// Product deep-links in the transactional emails.
//
// Covers the two things that are easy to regress: that a quote email actually
// carries a /memorials/<slug> link back to the product page, and that a slug
// supplied by the browser can never become an arbitrary href in our own inbox.
// Also pins the shortlist enquiry, whose saved memorials used to be dropped
// from both emails entirely.
import assert from "node:assert/strict";

import { onRequestPost } from "../functions/api/submit.js";

const env = {
  RESEND_API_KEY: "test-resend-key",
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SERVICE_KEY: "test-service-role-key",
  SM_ORG_ID: "00000000-0000-4000-8000-000000000001",
  // GHL_* deliberately unset so the CRM hand-off short-circuits.
};

const originalFetch = globalThis.fetch;
let sentEmails = [];

globalThis.fetch = async (input, init = {}) => {
  const url = String(input);
  if (url.includes("/rpc/check_portal_rate_limit")) {
    return Response.json([{ allowed: true, retry_after_seconds: 0 }]);
  }
  if (url.includes("/rpc/create_quote")) return Response.json({ ok: true });
  if (url.includes("/rest/v1/people?email=eq.")) return Response.json([{ id: 7, is_customer: false }]);
  if (url.includes("/rest/v1/people?id=eq.")) return new Response(null, { status: 204 });
  if (url.includes("/rest/v1/cemeteries")) return Response.json([]);
  if (url.includes("/rest/v1/enquiries")) return new Response(null, { status: 201 });
  if (url === "https://api.resend.com/emails") {
    sentEmails.push(JSON.parse(init.body));
    return Response.json({ id: "email_test" });
  }
  throw new Error(`Unexpected fetch in test: ${url}`);
};

// Collects the ctx.waitUntil background work so the assertions can await the
// emails, which are sent after the response is returned.
async function submit(body) {
  sentEmails = [];
  const pending = [];
  const response = await onRequestPost({
    env,
    waitUntil: promise => pending.push(promise),
    request: new Request("https://searsmelvin.co.uk/api/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json", "CF-Connecting-IP": "203.0.113.10" },
      body: JSON.stringify(body),
    }),
  });
  await Promise.allSettled(pending);
  return { response, payload: await response.json() };
}

const quoteBody = slug => ({
  channel: "quote",
  name: "Evans Todd",
  email: "evanstodd1995@icloud.com",
  phone: "07507777724",
  product: {
    name: "The Keswick Heart",
    slug,
    type: "Cremation Memorials",
    colour: "Black",
    price: "1750",
    image: "/images/keswick.jpg",
  },
});

// 1. A real slug links both copies back to the live product page.
{
  const { payload } = await submit(quoteBody("the-keswick-heart"));
  assert.equal(payload.ok, true);
  assert.equal(sentEmails.length, 2, "expected a business and a customer email");
  const productUrl = "https://searsmelvin.co.uk/memorials/the-keswick-heart";
  for (const email of sentEmails) {
    assert.ok(email.html.includes(`href="${productUrl}"`), `${email.to} email is missing the product link`);
  }
  const business = sentEmails.find(email => email.to === "info@searsmelvin.co.uk");
  assert.ok(business.html.includes("View product page &rarr;"));
  const customer = sentEmails.find(email => email.to !== "info@searsmelvin.co.uk");
  assert.ok(customer.html.includes("View this memorial on our website &rarr;"));
  // The product image is wrapped in the same link, with the Outlook border off.
  assert.ok(business.html.includes(`<img src="https://searsmelvin.co.uk/images/keswick.jpg"`));
  assert.ok(business.html.includes(`border="0"`));
}

// 2. A slug the browser made up can never reach an href.
for (const hostileSlug of ["javascript:alert(1)", '" onmouseover="x', "../../admin", "//evil.example"]) {
  const { payload } = await submit(quoteBody(hostileSlug));
  assert.equal(payload.ok, true);
  for (const email of sentEmails) {
    assert.ok(!email.html.includes("/memorials/"), `hostile slug ${hostileSlug} produced a link`);
    assert.ok(!email.html.includes("javascript:"), `hostile slug ${hostileSlug} produced a javascript: href`);
    assert.ok(!email.html.includes("onmouseover"), `hostile slug ${hostileSlug} escaped into an attribute`);
  }
}

// 3. A shortlist enquiry with no note is valid, and both copies list the saved
//    memorials as links.
{
  const { payload } = await submit({
    channel: "shortlist",
    name: "Evans Todd",
    email: "evanstodd1995@icloud.com",
    enquiry_type: "shortlist-enquiry",
    sub_type: "shortlist-enquiry",
    message: null,
    details: {
      items: [
        { name: "The Keswick Heart", price: "£1,500", slug: "the-keswick-heart", url: "https://evil.example/phish" },
        { name: "The Grasmere Kerb Set", price: "£2,400", slug: "the-grasmere-kerb-set" },
      ],
    },
  });
  assert.equal(payload.ok, true, "a shortlist with items and no note must be accepted");
  assert.equal(sentEmails.length, 2);
  for (const email of sentEmails) {
    assert.ok(email.html.includes("https://searsmelvin.co.uk/memorials/the-keswick-heart"));
    assert.ok(email.html.includes("https://searsmelvin.co.uk/memorials/the-grasmere-kerb-set"));
    // The client also sends a per-item `url`; it is rebuilt from the slug, so a
    // planted one never renders.
    assert.ok(!email.html.includes("evil.example"), "client-supplied item url must be ignored");
    // No empty "Message" panel when the customer left the note blank.
    assert.ok(!email.html.includes(">Message<"));
    assert.ok(!email.html.includes(">Your message<"));
  }
}

// 4. A contact enquiry still requires a message.
{
  const { response, payload } = await submit({
    channel: "contact",
    name: "Evans Todd",
    email: "evanstodd1995@icloud.com",
    enquiry_type: "new-memorial",
  });
  assert.equal(response.status, 400);
  assert.equal(payload.ok, false);
}

globalThis.fetch = originalFetch;
console.log("email product link tests passed");
