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
// An old quote that still lists the retired flower vase re-prices without it.
assert.equal(payload.value, 1450);
assert.equal(payload.product.price, 1450);
assert.equal(orderPatch.value, 1450);
assert.equal(JSON.parse(orderPatch.product_config).price, 1450);
assert.deepEqual(JSON.parse(orderPatch.product_config).addonLineItems, []);

globalThis.fetch = originalFetch;

const colourRows = [
  { name: "Black", slug: "black", is_premium: false, tier: "standard" },
  { name: "Black Galaxy", slug: "black-galaxy", is_premium: true, tier: "premium" },
  { name: "Crystal White", slug: "crystal-white", is_premium: true, tier: "premium" },
];
const colourProducts = {
  "the-castell": {
    id: "product-castell",
    name: "The Castell",
    slug: "the-castell",
    base_price: 1450,
    image_url: "/images/castell.jpg",
    inscription_chars_included: 80,
    inscription_price_per_char: 1.95,
    product_categories: { name: "Lawn Headstones", slug: "lawn-headstones" },
  },
  "the-hartwell": {
    id: "product-hartwell",
    name: "The Hartwell",
    slug: "the-hartwell",
    base_price: 4140,
    image_url: "/images/hartwell.jpg",
    inscription_chars_included: 80,
    inscription_price_per_char: 1.95,
    product_categories: { name: "Kerb Sets", slug: "kerb-sets" },
  },
  "the-albury": {
    id: "product-albury",
    name: "The Albury",
    slug: "the-albury",
    base_price: 1500,
    image_url: "/images/albury.jpg",
    inscription_chars_included: 80,
    inscription_price_per_char: 1.95,
    product_categories: { name: "Cremation Memorials", slug: "cremation-memorials" },
  },
};

async function editColourQuote(slug, colour) {
  let orderPatch = null;
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    if (url.includes("/rpc/check_portal_rate_limit")) {
      return Response.json([{ allowed: true, retry_after_seconds: 0 }]);
    }
    if (url.includes("/quote_access_tokens?")) return Response.json([{ order_id: "order-colour" }]);
    if (url.includes("/rest/v1/orders?") && (init.method || "GET") === "GET") {
      return Response.json([{
        id: "order-colour",
        location: "Example Cemetery",
        product_config: {
          name: colourProducts[slug].name,
          slug,
          colour: "Black",
          addons: [],
          price: 1,
        },
        value: 1,
        notes: "",
        status: "pending",
        created_at: "2026-08-01T12:00:00Z",
        sku: slug,
        color: "Black",
        inscription_text: "",
        people: { first_name: "Test", last_name: "Customer", email: "test@example.com", phone: "" },
      }]);
    }
    if (url.includes("/rest/v1/products?")) return Response.json([colourProducts[slug]]);
    if (url.includes("/rest/v1/stone_colours?")) return Response.json(colourRows);
    if (url.includes("/rest/v1/product_addons?")) return Response.json([]);
    if (url.includes("/rest/v1/product_sizes?")) return Response.json([
      { size_name: "Standard", size_code: "standard", dimensions: "30 × 24", price_adjustment: 0, is_default: true },
    ]);
    if (url.includes("/rest/v1/orders?") && init.method === "PATCH") {
      orderPatch = JSON.parse(init.body);
      return new Response(null, { status: 204 });
    }
    throw new Error(`Unexpected fetch in colour quote edit: ${url}`);
  };

  const response = await onRequest({
    env,
    request: new Request("https://searsmelvin.co.uk/api/quotes", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://searsmelvin.co.uk", "CF-Connecting-IP": "203.0.113.22" },
      body: JSON.stringify({
        token,
        product: { slug, colour, sizeCode: "standard", addonSlugs: [], price: 1 },
        message: "",
      }),
    }),
  });
  const payload = await response.json();
  globalThis.fetch = originalFetch;
  return { response, payload, orderPatch };
}

const colourEdits = [
  ["the-castell", "Crystal White", 1950, "Additional stone colour — Crystal White", 500],
  ["the-castell", "Black Galaxy", 1650, "Additional stone colour — Black Galaxy", 200],
  ["the-hartwell", "Crystal White", 5190, "Additional stone colour — Crystal White", 1050],
  ["the-hartwell", "Black Galaxy", 4690, "Additional stone colour — Black Galaxy", 550],
  ["the-albury", "Crystal White", 1590, "Additional stone colour — Crystal White", 90],
  ["the-albury", "Black Galaxy", 1590, "Additional stone colour — Black Galaxy", 90],
];
for (const [slug, colour, total, lineName, surcharge] of colourEdits) {
  const { response, payload, orderPatch } = await editColourQuote(slug, colour);
  assert.equal(response.status, 200, `${slug} ${colour}`);
  assert.equal(payload.ok, true);
  assert.equal(payload.value, total, `${slug} ${colour}`);
  assert.equal(payload.product.price, total);
  assert.equal(orderPatch.value, total);
  assert.deepEqual(JSON.parse(orderPatch.product_config).addonLineItems, [
    { name: lineName, price: surcharge },
  ]);
}

console.log("quote edit pricing test passed");
