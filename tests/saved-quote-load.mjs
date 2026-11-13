// A saved kerb quote is shown from the stored order. get-quote does not re-price it.
import assert from "node:assert/strict";

import { onRequest } from "../functions/api/quotes.js";

const env = {
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SERVICE_KEY: "test-service-key",
  SM_ORG_ID: "00000000-0000-4000-8000-000000000001",
};
const token = "b".repeat(32);
const storedLines = [
  { name: "Kerb Infill — Chippings (White)", price: 250 },
];
const storedProduct = {
  name: "The Charnwood",
  slug: "the-charnwood",
  type: "Kerb Sets",
  colour: "Black",
  price: 4200,
  addons: ["Kerb Infill — Chippings (White)"],
  addonLineItems: storedLines,
};
const storedValue = 4200;
let catalogueReads = 0;

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
      value: storedValue,
      notes: "",
      status: "pending",
      created_at: "2026-05-01T12:00:00Z",
      sku: "The Charnwood",
      color: "Black",
      inscription_text: "",
      people: { first_name: "Ada", last_name: "Evans", email: "ada@example.com", phone: "" },
    }]);
  }
  if (url.includes("/rest/v1/products?") || url.includes("/rest/v1/stone_colours?") || url.includes("/rest/v1/product_addons?") || url.includes("/rest/v1/product_sizes?")) {
    catalogueReads += 1;
    return Response.json([]);
  }
  throw new Error(`Unexpected fetch in saved quote load test: ${url}`);
};

const response = await onRequest({
  env,
  request: new Request("https://searsmelvin.co.uk/api/quotes", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Origin": "https://searsmelvin.co.uk",
      "CF-Connecting-IP": "203.0.113.21",
    },
    body: JSON.stringify({ action: "get-quote", token }),
  }),
});
const payload = await response.json();

assert.equal(response.status, 200);
assert.equal(payload.ok, true);
assert.equal(payload.quote.value, storedValue);
assert.equal(payload.quote.product.price, 4200);
assert.deepEqual(payload.quote.product.addonLineItems, storedLines);
assert.equal(catalogueReads, 0, "loading a saved quote must not read the catalogue or re-price");

console.log("saved quote load test passed");
