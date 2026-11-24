import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { onRequestGet as imageProxy } from "../functions/img/[[path]].js";
import { onRequestGet as productPage } from "../functions/memorials/[slug].js";

const root = new URL("..", import.meta.url);
const memorial = readFileSync(new URL("memorial.html", root), "utf8");
assert.match(memorial, /href="\/memorial\.css\?v=[^"]+"/);

for (const file of readdirSync(root).filter((name) => name.endsWith(".html") && !/^admin.*\.html$/.test(name) && name !== "styleguide.html")) {
  assert.doesNotMatch(readFileSync(new URL(file, root), "utf8"), /fonts\.googleapis\.com/, `${file} uses self-hosted fonts`);
}

const captured = {};
globalThis.HTMLRewriter = class {
  on(selector, handler) {
    if (selector === "head") {
      handler.element({ prepend(value, opts) { captured.headFirst = value; captured.headFirstHtml = opts && opts.html; } });
    }
    return this;
  }
  transform(response) { return response; }
};
const product = {
  id: "p1", name: "The Test", slug: "the-test", base_price: 1200, category_id: "c1",
  image_url: "https://bfwohzcugtwbhhxdqgme.supabase.co/storage/v1/object/public/product-images/test.webp",
  included_features: [], product_categories: { name: "Headstone", slug: "headstones" },
};
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url) => String(url).includes("products?slug=") ? Response.json([product]) : Response.json([]);
await productPage({
  request: new Request("https://example.test/memorials/the-test"),
  params: { slug: "the-test" },
  env: { ASSETS: { fetch: async () => new Response("<html><head><meta charset=\"UTF-8\"><meta name=\"viewport\" content=\"width=device-width\"></head></html>") } },
});
globalThis.fetch = originalFetch;
assert.equal(captured.headFirstHtml, true, "preload is inserted as HTML");
assert.match(captured.headFirst, /^<link rel="preload" as="image"/, "LCP preload is the first child of <head>");
assert.match(captured.headFirst, /fetchpriority="high"/);
assert.match(captured.headFirst, /href="\/img\/product-images\/test\.webp\?width=800&amp;quality=70&amp;resize=contain"/);

const env = {};
assert.equal((await imageProxy({ request: new Request("https://example.test/img/private/a.webp?width=96"), env, params: { path: ["private", "a.webp"] } })).status, 404);
assert.equal((await imageProxy({ request: new Request("https://example.test/img/product-images/a.webp?width=96&url=https://evil.test"), env, params: { path: ["product-images", "a.webp"] } })).status, 404);
assert.equal((await imageProxy({ request: new Request("https://example.test/img/product-images/a.webp?width=99999"), env, params: { path: ["product-images", "a.webp"] } })).status, 404);

const swatches = readFileSync(new URL("data/stone-colour-swatches.js", root), "utf8");
assert.match(swatches, /\/img\/.*width=144&quality=70&resize=contain/);
const { stoneBandMarkup } = await import("../functions/memorials.js");
const band = stoneBandMarkup([{ slug: "black", name: "Black", hex_primary: "#111111", image_url: "https://bfwohzcugtwbhhxdqgme.supabase.co/storage/v1/object/public/product-images/stone-colours/black.webp" }]);
assert.match(band, /src="\/img\/product-images\/stone-colours\/black\.webp\?width=144&amp;quality=70&amp;resize=contain"/, "SSR swatches use the same resized URL as the client");

// Long-cached (immutable) stylesheets must be re-versioned whenever they change.
for (const css of ["memorial.css", "memorials.css", "fonts.css"]) {
  const v = createHash("sha256").update(readFileSync(new URL(css, root))).digest("hex").slice(0, 10);
  for (const file of readdirSync(root).filter((name) => name.endsWith(".html"))) {
    const html = readFileSync(new URL(file, root), "utf8");
    for (const m of html.matchAll(new RegExp(`href="/${css.replace(".", "\\.")}\\?v=([^"]+)"`, "g"))) {
      assert.equal(m[1], v, `${file}: bump /${css}?v= to ${v} (file changed)`);
    }
  }
}

console.log("mobile-speed: ok");
