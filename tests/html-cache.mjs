// Product HTML is cached by path. A second view, including one with an ad
// query string, must not call Supabase again. Unknown slugs stay uncached.
// A failed sizes, related, or area-product read still renders, and is not stored.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { onRequestGet } from "../functions/memorials/[slug].js";
import { onRequest as areaPage } from "../functions/areas/[[path]].js";

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

function rowFor(slug) {
  return { ...product, id: slug, slug };
}

async function failedProduct(slug, fail) {
  const key = `https://searsmelvin.co.uk/memorials/${slug}`;
  saved.delete(key);
  let calls = 0;
  globalThis.fetch = async (url) => {
    calls += 1;
    const target = String(url);
    if (target.includes("product_sizes")) return fail("sizes");
    if (target.includes("slug=neq.")) return fail("related");
    if (target.includes(`slug=eq.${slug}`)) return Response.json([rowFor(slug)]);
    return Response.json([]);
  };
  const load = () => onRequestGet({
    request: new Request(key),
    env,
    params: { slug },
    waitUntil(promise) { return promise; },
  });
  const first = await load();
  assert.equal(first.status, 200, slug);
  assert.equal(first.headers.get("Cache-Control"), "no-store", slug);
  assert.equal(await first.text(), shell, slug);
  assert.equal(saved.has(key), false, slug);
  const seen = calls;
  const second = await load();
  assert.equal(second.status, 200, slug);
  assert.equal(second.headers.get("Cache-Control"), "no-store", slug);
  assert.ok(calls > seen, `${slug} was served from cache`);
  assert.equal(saved.has(key), false, slug);
}

const okList = () => Response.json([]);
await failedProduct("sizes-http", (which) => (which === "sizes" ? new Response("no", { status: 500 }) : okList()));
await failedProduct("sizes-timeout", (which) => {
  if (which === "sizes") throw new Error("timeout");
  return okList();
});
await failedProduct("related-http", (which) => (which === "related" ? new Response("no", { status: 502 }) : okList()));
await failedProduct("related-timeout", (which) => {
  if (which === "related") throw new Error("timeout");
  return okList();
});

const about = readFileSync(new URL("../about.html", import.meta.url), "utf8");
const areaEnv = { ASSETS: { fetch: async () => new Response(about, { status: 200 }) } };

async function failedArea(label, respond) {
  const key = "https://searsmelvin.co.uk/areas/barnet";
  saved.delete(key);
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return respond();
  };
  const load = () => areaPage({
    request: new Request(key),
    env: areaEnv,
    waitUntil() {},
  });
  const first = await load();
  assert.equal(first.status, 200, label);
  assert.equal(first.headers.get("Cache-Control"), "no-store", label);
  assert.match(await first.text(), /Some of our memorials/, label);
  assert.equal(saved.has(key), false, label);
  const seen = calls;
  const second = await load();
  assert.equal(second.status, 200, label);
  assert.ok(calls > seen, `${label} was served from cache`);
  assert.equal(saved.has(key), false, label);
}

await failedArea("area products non-2xx", () => new Response("no", { status: 503 }));
await failedArea("area products timeout", () => { throw new Error("timeout"); });

console.log("html-cache: ok");
