// Re-saving a kerb quote keeps a stored chippings line when infillType was never saved.
// A new quote still starts with no infill.
import assert from "node:assert/strict";

import { onRequest } from "../functions/api/quotes.js";
import { calculateCanonicalQuoteProduct } from "../functions/api/_quote-pricing.js";

const env = {
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SERVICE_KEY: "test-service-key",
  SM_ORG_ID: "00000000-0000-4000-8000-000000000001",
};
const token = "c".repeat(32);

const charnwoodCatalogue = {
  product: {
    name: "The Charnwood",
    slug: "the-charnwood",
    base_price: 3950,
    image_url: "/images/charnwood.jpg",
    inscription_chars_included: 80,
    inscription_price_per_char: 2.4,
    product_categories: { name: "Kerb Sets", slug: "kerb-sets" },
  },
  sizes: [
    { size_name: "Standard", size_code: "standard", dimensions: "30 × 24", price_adjustment: 0, is_default: true },
  ],
  colours: [
    { name: "Black", slug: "black", is_premium: false },
  ],
  addons: [],
};

function catalogueResponse(url) {
  if (url.includes("/rest/v1/products?")) {
    return Response.json([{ id: "product-charnwood", ...charnwoodCatalogue.product }]);
  }
  if (url.includes("/rest/v1/stone_colours?")) return Response.json(charnwoodCatalogue.colours);
  if (url.includes("/rest/v1/product_addons?")) return Response.json(charnwoodCatalogue.addons);
  if (url.includes("/rest/v1/product_sizes?")) return Response.json(charnwoodCatalogue.sizes);
  return null;
}

async function resave(storedProduct) {
  let orderPatch = null;
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    if (url.includes("/rpc/check_portal_rate_limit")) {
      return Response.json([{ allowed: true, retry_after_seconds: 0 }]);
    }
    if (url.includes("/quote_access_tokens?")) return Response.json([{ order_id: "order-old" }]);
    if (url.includes("/rest/v1/orders?") && (init.method || "GET") === "GET") {
      return Response.json([{
        id: "order-old",
        location: "Test Cemetery",
        product_config: storedProduct,
        value: storedProduct.price,
        notes: "",
        status: "pending",
        created_at: "2026-05-01T12:00:00Z",
        sku: "The Charnwood",
        color: "Black",
        inscription_text: "",
        people: { first_name: "Ada", last_name: "Evans", email: "ada@example.com", phone: "" },
      }]);
    }
    const catalogue = catalogueResponse(url);
    if (catalogue) return catalogue;
    if (url.includes("/rest/v1/orders?") && init.method === "PATCH") {
      orderPatch = JSON.parse(init.body);
      return new Response(null, { status: 204 });
    }
    throw new Error(`Unexpected fetch in resave test: ${url}`);
  };

  const response = await onRequest({
    env,
    request: new Request("https://searsmelvin.co.uk/api/quotes", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://searsmelvin.co.uk",
        "CF-Connecting-IP": "203.0.113.40",
      },
      body: JSON.stringify({
        token,
        product: {
          slug: "the-charnwood",
          colour: "Black",
          sizeCode: "standard",
          addonLineItems: [],
          addons: [],
          addonSlugs: [],
          price: 1,
        },
      }),
    }),
  });
  const payload = await response.json();
  return { response, payload, orderPatch };
}

// (a) Stored £250 chippings line, no infillType. The editor wipes the lines on save.
{
  const { response, payload, orderPatch } = await resave({
    name: "The Charnwood",
    slug: "the-charnwood",
    type: "Kerb Sets",
    colour: "Black",
    price: 4200,
    addons: ["Kerb Infill — Chippings (White)"],
    addonLineItems: [{ name: "Kerb Infill — Chippings (White)", price: 250 }],
  });
  assert.equal(response.status, 200);
  assert.equal(payload.ok, true);
  assert.equal(payload.value, 4200);
  assert.equal(payload.product.price, 4200);
  assert.equal(payload.product.infillType, "chippings");
  assert.equal(payload.product.infillColour, "white");
  assert.deepEqual(payload.product.addonLineItems, [
    { name: "Kerb Infill — Chippings (White)", price: 250 },
  ]);
  const saved = JSON.parse(orderPatch.product_config);
  assert.equal(saved.price, 4200);
  assert.deepEqual(saved.addonLineItems, [
    { name: "Kerb Infill — Chippings (White)", price: 250 },
  ]);
}

// (b) A stored infillType is kept, including its colour.
{
  const { response, payload } = await resave({
    name: "The Charnwood",
    slug: "the-charnwood",
    colour: "Black",
    price: 4200,
    infillType: "chippings",
    infillColour: "black",
    addonLineItems: [{ name: "Kerb Infill — Chippings (Black)", price: 250 }],
  });
  assert.equal(response.status, 200);
  assert.equal(payload.value, 4200);
  assert.equal(payload.product.infillType, "chippings");
  assert.equal(payload.product.infillColour, "black");
  assert.deepEqual(payload.product.addonLineItems, [
    { name: "Kerb Infill — Chippings (Black)", price: 250 },
  ]);
}

// (c) A new Charnwood quote has no infill line and stays at the base price.
{
  const product = calculateCanonicalQuoteProduct({
    slug: "the-charnwood",
    colour: "Black",
    sizeCode: "standard",
    addonLineItems: [],
    addons: [],
    price: "1",
  }, charnwoodCatalogue);
  assert.equal(product.price, 3950);
  assert.equal(product.infillType, undefined);
  assert.deepEqual(product.addonLineItems, []);
}

console.log("saved quote resave test passed");
