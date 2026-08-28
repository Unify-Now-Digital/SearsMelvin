import assert from "node:assert/strict";

import { onRequest } from "../functions/api/quotes.js";

const env = {
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SERVICE_KEY: "test-service-key",
  SM_ORG_ID: "00000000-0000-4000-8000-000000000001",
};
const token = "a".repeat(32);
let orderPatch = null;
const originalFetch = globalThis.fetch;

globalThis.fetch = async (input, init = {}) => {
  const url = String(input);
  if (url.includes("/rpc/check_portal_rate_limit")) {
    return Response.json([{ allowed: true, retry_after_seconds: 0 }]);
  }
  if (url.includes("/quote_access_tokens?")) return Response.json([{ order_id: "order-1" }]);
  if (url.includes("/rest/v1/orders?") && (init.method || "GET") === "GET") return Response.json([{
    id: "order-1",
    location: "Test Cemetery",
    product_config: {
      name: "The Castell",
      slug: "the-castell",
      colour: "Black",
      addons: [],
      price: 1,
    },
    value: 1,
    notes: "",
    status: "pending",
    created_at: "2026-08-01T12:00:00Z",
    sku: "the-castell",
    color: "Black",
    inscription_text: "",
    people: { first_name: "Test", last_name: "Customer", email: "test@example.com", phone: "" },
  }]);
  if (url.includes("/rest/v1/products?")) return Response.json([{
    id: "product-1",
    name: "The Castell",
    slug: "the-castell",
    base_price: 1450,
    image_url: "/images/castell.jpg",
    inscription_chars_included: 80,
    inscription_price_per_char: 1.95,
    product_categories: { name: "Lawn Headstones", slug: "lawn-headstones" },
  }]);
  if (url.includes("/rest/v1/stone_colours?")) return Response.json([
    { name: "Black", slug: "black", is_premium: false, tier: "standard" },
  ]);
  if (url.includes("/rest/v1/product_addons?")) return Response.json([
    { name: "Flower Vase", slug: "vase", price: 85 },
  ]);
  if (url.includes("/rest/v1/product_sizes?")) return Response.json([
    { size_name: "Standard", size_code: "standard", dimensions: "30 × 24", price_adjustment: 0, is_default: true },
  ]);
  if (url.includes("/rest/v1/orders?") && init.method === "PATCH") {
    orderPatch = JSON.parse(init.body);
    return new Response(null, { status: 204 });
  }
  throw new Error(`Unexpected fetch in quote edit test: ${url}`);
};

const response = await onRequest({
  env,
  request: new Request("https://searsmelvin.co.uk/api/quotes", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Origin": "https://searsmelvin.co.uk", "CF-Connecting-IP": "203.0.113.20" },
    body: JSON.stringify({
      token,
      product: {
        slug: "the-castell",
        colour: "Black",
        sizeCode: "standard",
        addons: ["Flower Vase"],
        addonSlugs: [],
        price: 1,
      },
      message: "",
    }),
  }),
});
const payload = await response.json();

assert.equal(response.status, 200);
assert.equal(payload.ok, true);
assert.equal(payload.value, 1535);
assert.equal(payload.product.price, 1535);
assert.equal(orderPatch.value, 1535);
assert.equal(JSON.parse(orderPatch.product_config).price, 1535);
assert.deepEqual(JSON.parse(orderPatch.product_config).addonLineItems, [{ name: "Flower Vase", price: 85 }]);

globalThis.fetch = originalFetch;
console.log("quote edit pricing test passed");
