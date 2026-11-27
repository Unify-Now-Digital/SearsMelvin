// Product HTML is cached by path. A second view, including one with an ad
// query string, must not call Supabase again. Unknown slugs stay uncached.
import assert from "node:assert/strict";
import { onRequestGet } from "../functions/memorials/[slug].js";

const saved = new Map();
globalThis.caches = {
  default: {
    async match(request) {
      const hit = saved.get(request.url);
      return hit ? hit.clone() : undefined;
    },
    async put(request, response) {
      saved.set(request.url, response);
    },
  },
};
globalThis.HTMLRewriter = class {
  on() { return this; }
  transform(response) { return response; }
};

const shell = "<html><head><title>Memorial</title></head><body>From £1,450</body></html>";
const env = {
  ASSETS: { fetch: async () => new Response(shell, { headers: { "Content-Type": "text/html" } }) },
};
const product = {
  id: "p1",
  name: "The Charnwood",
  slug: "the-charnwood",
  base_price: 1450,
  category_id: "c1",
  image_url: "https://bfwohzcugtwbhhxdqgme.supabase.co/storage/v1/object/public/product-images/the-charnwood.webp",
  included_features: [],
  product_categories: { name: "Lawn Headstones", slug: "lawn-headstones" },
};

let fetches = 0;
globalThis.fetch = async (url) => {
  fetches += 1;
  if (String(url).includes("slug=eq.the-charnwood")) return Response.json([product]);
  return Response.json([]);
};

let stored = null;
const first = await onRequestGet({
  request: new Request("https://searsmelvin.co.uk/memorials/the-charnwood?gclid=abc"),
  env,
  params: { slug: "the-charnwood" },
  waitUntil(promise) { stored = promise; },
});
assert.equal(first.status, 200);
assert.match(first.headers.get("Cache-Control"), /public/);
const body = await first.text();
assert.equal(body, shell);
await stored;
const afterFirst = fetches;
assert.ok(afterFirst >= 1);

const second = await onRequestGet({
  request: new Request("https://searsmelvin.co.uk/memorials/the-charnwood?utm_source=ads"),
  env,
  params: { slug: "the-charnwood" },
});
assert.equal(second.status, 200);
assert.equal(await second.text(), body);
assert.equal(fetches, afterFirst, "cached product HTML must not call Supabase");
assert.equal(saved.size, 1);
assert.equal([...saved.keys()][0], "https://searsmelvin.co.uk/memorials/the-charnwood");

globalThis.fetch = async () => {
  fetches += 1;
  return Response.json([]);
};
const missing = await onRequestGet({
  request: new Request("https://searsmelvin.co.uk/memorials/not-a-stone"),
  env,
  params: { slug: "not-a-stone" },
});
assert.equal(missing.status, 302);
assert.equal(missing.headers.get("Cache-Control"), "no-store");

console.log("html-cache: ok");
