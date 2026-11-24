// Quote-email product images. Apple Mail cannot render WebP or AVIF, and the
// catalogue stores Supabase public WebP URLs. Those are rewritten to the
// Storage render endpoint, which returns JPEG when format=origin is set.
import assert from "node:assert/strict";

import { emailSafeImageUrl, onRequestPost } from "../functions/api/submit.js";

const webp = "https://bfwohzcugtwbhhxdqgme.supabase.co/storage/v1/object/public/product-images/the-tewkesbury.webp";
const rewritten = "https://bfwohzcugtwbhhxdqgme.supabase.co/storage/v1/render/image/public/product-images/the-tewkesbury.webp?width=800&quality=70&resize=contain&format=origin";

assert.equal(emailSafeImageUrl(webp), rewritten);
assert.equal(
  emailSafeImageUrl(webp.replace(".webp", ".avif")),
  rewritten.replace(".webp", ".avif"),
);

// The extension is read from the path. An existing query is replaced, so the
// result never contains two question marks or the old parameters.
assert.equal(emailSafeImageUrl(`${webp}?download=1&name=the-tewkesbury.webp`), rewritten);
assert.equal(emailSafeImageUrl(`${webp}?width=100#preview`), rewritten);
assert.equal(
  emailSafeImageUrl("https://bfwohzcugtwbhhxdqgme.supabase.co/storage/v1/object/public/product-images/photo.jpg?format=webp"),
  "https://bfwohzcugtwbhhxdqgme.supabase.co/storage/v1/object/public/product-images/photo.jpg?format=webp",
);

for (const url of [
  webp.replace(/\.webp$/, ".png"),
  webp.replace(/\.webp$/, ".jpg"),
  webp.replace(/\.webp$/, ".jpeg"),
  "https://searsmelvin.co.uk/images/the-tewkesbury.webp",
  "https://cdn.example.com/storage/v1/object/public/product-images/the-tewkesbury.webp",
  "https://searsmelvin.co.uk/images/keswick.jpg",
  "/images/keswick.jpg",
  "data:image/webp;base64,AAAA",
]) {
  assert.equal(emailSafeImageUrl(url), url, url);
}

assert.equal(emailSafeImageUrl(""), "");
assert.equal(emailSafeImageUrl("   "), "");
assert.equal(emailSafeImageUrl(null), "");
assert.equal(emailSafeImageUrl(undefined), "");

// Both quote emails use the helper. The catalogue image is a WebP object URL
// with a query string; the img src in each copy is the JPEG render URL, and
// the existing width and alt attributes stay.
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
  if (url.includes("/rpc/check_portal_rate_limit")) {
    return Response.json([{ allowed: true, retry_after_seconds: 0 }]);
  }
  if (url.includes("/rest/v1/products?")) return Response.json([{
    id: "product-1",
    name: "The Tewkesbury",
    slug: "the-tewkesbury",
    base_price: 1750,
    image_url: `${webp}?download=1`,
    inscription_chars_included: 80,
    inscription_price_per_char: 1.95,
    product_categories: { name: "Cremation Memorials", slug: "cremation-memorials" },
  }]);
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

const pending = [];
const response = await onRequestPost({
  env,
  waitUntil: promise => pending.push(promise),
  request: new Request("https://searsmelvin.co.uk/api/submit", {
    method: "POST",
    headers: { "Content-Type": "application/json", "CF-Connecting-IP": "203.0.113.10" },
    body: JSON.stringify({
      channel: "quote",
      name: "Evans Todd",
      email: "evanstodd1995@icloud.com",
      phone: "07507777724",
      product: {
        name: "The Tewkesbury",
        slug: "the-tewkesbury",
        type: "Cremation Memorials",
        colour: "Black",
        price: "1750",
        image: webp,
      },
    }),
  }),
});
await Promise.allSettled(pending);
globalThis.fetch = originalFetch;

assert.equal(response.status, 200);
assert.equal(sentEmails.length, 2);
const img = `<img src="${rewritten}" alt="The Tewkesbury" width="360"`;
for (const email of sentEmails) {
  assert.ok(email.html.includes(img), `${email.to} is missing the JPEG product image`);
  assert.ok(!email.html.includes("/storage/v1/object/public/"), `${email.to} still points at the WebP object`);
}

console.log("email safe image tests passed");
