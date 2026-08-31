// Business notification subject lines.
//
// Convention: <Type phrase> — <Customer name> — <Product or detail>
//
// The leading type phrase is load-bearing: the team's Gmail filters key on it
// (the /RAQ label on quote requests, for one). These tests pin each phrase
// verbatim so a future reword cannot silently break the labelling, and pin the
// name-then-detail order that follows it.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { formatNameForSubject, onRequestPost } from "../functions/api/submit.js";

// ── The name formatter ──────────────────────────────────────────────────────
// Only an all-lowercase name is capitalised — that is a form-filling artefact.
assert.equal(formatNameForSubject("evans"), "Evans");
assert.equal(formatNameForSubject("evans todd"), "Evans Todd");
assert.equal(formatNameForSubject("  evans   todd  "), "Evans Todd");
assert.equal(formatNameForSubject("mary-jane o'brien"), "Mary-Jane O'Brien");

// Anything already carrying capitals is left exactly as entered, so real names
// are never mangled by naive title-casing.
assert.equal(formatNameForSubject("Ian McDonald"), "Ian McDonald");
assert.equal(formatNameForSubject("Pieter van der Berg"), "Pieter van der Berg");
assert.equal(formatNameForSubject("J. R. Hartley"), "J. R. Hartley");
assert.equal(formatNameForSubject("EVANS"), "EVANS");

assert.equal(formatNameForSubject(""), "");
assert.equal(formatNameForSubject(null), "");
assert.equal(formatNameForSubject(undefined), "");

// ── The type phrases must survive verbatim ──────────────────────────────────
const submitSource = readFileSync(new URL("../functions/api/submit.js", import.meta.url), "utf8");
for (const phrase of ["New Quote Request — ", "New Enquiry — ", "New Appointment Request — "]) {
  assert.ok(submitSource.includes(`subject: \`${phrase}`), `subject phrase changed: ${phrase}`);
}

// ── End-to-end: a real submission produces the expected subject ─────────────
const env = {
  RESEND_API_KEY: "test-resend-key",
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SERVICE_KEY: "test-service-role-key",
  SM_ORG_ID: "00000000-0000-4000-8000-000000000001",
};

const originalFetch = globalThis.fetch;
let sentEmails = [];

globalThis.fetch = async (input, init = {}) => {
  const url = String(input);
  if (url.includes("/rpc/check_portal_rate_limit")) return Response.json([{ allowed: true, retry_after_seconds: 0 }]);
  // Quote submissions now rebuild the product from the live catalogue (#151).
  if (url.includes("/rest/v1/products?")) {
    const nameless = url.includes("slug=eq.nameless-memorial");
    return Response.json([{
      id: nameless ? "product-unnamed" : "product-1",
      name: nameless ? "" : "The Keswick Heart",
      slug: nameless ? "nameless-memorial" : "the-keswick-heart",
      base_price: nameless ? 1200 : 1750,
      image_url: "/images/keswick.jpg",
      inscription_chars_included: 80,
      inscription_price_per_char: 1.95,
      product_categories: { name: "Cremation Memorials", slug: "cremation-memorials" },
    }]);
  }
  if (url.includes("/rest/v1/stone_colours?")) return Response.json([
    { name: "Black", slug: "black", is_premium: false, tier: "standard" },
  ]);
  if (url.includes("/rest/v1/product_addons?")) return Response.json([]);
  if (url.includes("/rest/v1/product_sizes?")) return Response.json([]);
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

async function submit(body) {
  sentEmails = [];
  const pending = [];
  await onRequestPost({
    env,
    waitUntil: promise => pending.push(promise),
    request: new Request("https://searsmelvin.co.uk/api/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json", "CF-Connecting-IP": "203.0.113.10" },
      body: JSON.stringify(body),
    }),
  });
  await Promise.allSettled(pending);
  return sentEmails.find(email => email.to === "info@searsmelvin.co.uk");
}

{
  const business = await submit({
    channel: "quote",
    name: "evans todd",
    email: "evanstodd1995@icloud.com",
    product: { name: "The Keswick Heart", slug: "the-keswick-heart", colour: "Black", price: "1750" },
  });
  assert.equal(business.subject, "New Quote Request — Evans Todd — The Keswick Heart");
}

{
  const business = await submit({
    channel: "contact",
    name: "evans todd",
    email: "evanstodd1995@icloud.com",
    enquiry_type: "new-memorial",
    message: "Please call me.",
  });
  assert.equal(business.subject, "New Enquiry — Evans Todd — New Memorial");
}

// A product with no name still produces a sane subject rather than "undefined".
{
  const business = await submit({
    channel: "quote",
    name: "Ian McDonald",
    email: "ian@example.com",
    product: { slug: "nameless-memorial", colour: "Black", price: "1200" },
  });
  assert.equal(business.subject, "New Quote Request — Ian McDonald — Memorial");
}

globalThis.fetch = originalFetch;
console.log("email subject tests passed");
