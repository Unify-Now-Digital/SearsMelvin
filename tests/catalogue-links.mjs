// The first page of /memorials is product cards. Further designs open from
// the grid with "Show more memorials". There is no "More memorials" link list.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { catalogueInjection, onRequestGet } from "../functions/memorials.js";
import { CATEGORIES } from "../data/categories.js";

const html = readFileSync(new URL("../memorials.html", import.meta.url), "utf8");
const server = readFileSync(new URL("../functions/memorials.js", import.meta.url), "utf8");

assert.match(html, /<link rel="canonical" href="https:\/\/searsmelvin\.co\.uk\/memorials">/);
assert.doesNotMatch(html, /id="rangeLinks"|range-links|rangeLinksHtml|syncRangeLinks|More memorials/);
assert.doesNotMatch(server, /rangeLinks|renderRangeLinks|More memorials|RANGE_TYPE_ORDER/);
assert.match(html, /id="productsGrid"/);
assert.match(html, /id="catalogueMore"/);
assert.match(html, /Show more memorials/);
assert.match(html, /function applyUrlFilters\(\)/);
assert.match(html, /safeSlug\(params\.get\('type'\)\)/);
assert.match(html, /if \(!applyUrlFilters\(\)\) renderProducts\(\)/);
assert.match(html, /function injectItemListJsonLd/);
assert.doesNotMatch(html, /canonical[^>]{0,80}searchParams|searchParams\.get\('type'\)[\s\S]{0,120}canonical/);
assert.equal(html.includes("/memorials/type/"), false);

const browse = html.match(/<nav class="type-browse"[\s\S]*?<\/nav>/);
assert.ok(browse, "browse by type missing");
assert.deepEqual(
  [...browse[0].matchAll(/\/memorials\?type=([a-z0-9-]+)/g)].map((match) => match[1]),
  CATEGORIES.map((category) => category.slug),
);

function product(index, type, name) {
  return {
    id: `id-${type}-${index}`,
    slug: `${type}-${index}`,
    name,
    base_price: 1000 + index,
    is_featured: index === 0,
    product_categories: { name: type, slug: type },
  };
}

const lawn = Array.from({ length: 25 }, (_, index) => product(index, "lawn-headstones", `Lawn ${index}`));
const children = [
  product(0, "childrens-memorials", "Small heart"),
  product(1, "childrens-memorials", "Child's book"),
];
const colours = [{ slug: "blue-pearl", hex_primary: "#123456", hex_secondary: "#654321" }];
const all = catalogueInjection([...lawn, ...children], colours);
assert.equal(all.links, undefined);
assert.doesNotMatch(all.grid, /More memorials|range-links/);
const hrefs = [...all.grid.matchAll(/href="\/memorials\/([a-z0-9-]+)"/g)].map((match) => match[1]);
for (const item of lawn.slice(0, 24)) {
  assert.equal(hrefs.filter((slug) => slug === item.slug).length, 1, item.slug);
}
assert.equal(hrefs.includes("lawn-headstones-24"), false);
assert.equal(hrefs.includes("childrens-memorials-0"), false);
assert.match(all.grid, /href="\/memorials\/lawn-headstones-0"/);
assert.equal(all.count, 27);
assert.equal(all.more, true);

const onlyChildren = catalogueInjection(children, colours);
assert.match(onlyChildren.grid, /href="\/memorials\/childrens-memorials-0"/);
assert.match(onlyChildren.grid, /href="\/memorials\/childrens-memorials-1"/);
assert.match(onlyChildren.grid, /Child&#039;s book|Child&#39;s book/);
assert.equal(onlyChildren.more, false);
assert.doesNotMatch(onlyChildren.grid, /lawn-headstones|More memorials/);

const captured = {};
globalThis.HTMLRewriter = class {
  constructor() { this.handlers = []; }
  on(selector, handler) { this.handlers.push({ selector, handler }); return this; }
  transform(response) {
    return new Response(response.body, {
      status: response.status,
      headers: response.headers,
      async text() { return response.text(); },
    });
  }
};
// Capture the markup the rewriter is given. The real rewriter runs on Cloudflare.
const Original = globalThis.HTMLRewriter;
globalThis.HTMLRewriter = class extends Original {
  on(selector, handler) {
    handler.element({
      setInnerContent(value) { captured[selector] = value; },
      setAttribute(name, value) { captured[`${selector}@${name}`] = value; },
      removeAttribute() { captured[selector] = "visible"; },
    });
    return super.on(selector, handler);
  }
};

const shell = "<!DOCTYPE html><html><head><link rel=\"canonical\" href=\"https://searsmelvin.co.uk/memorials\"></head><body><div id=\"productsGrid\"></div><span id=\"resultsCount\">...</span><span id=\"filtersShowCount\">0</span><button id=\"catalogueMore\" hidden></button></body></html>";
globalThis.fetch = async (url) => {
  const target = String(url);
  assert.match(target, /organization_id=eq\.|stone_colours/);
  if (target.includes("stone_colours")) return Response.json(colours);
  assert.match(target, /is_active=eq\.true/);
  assert.match(target, /is_listed=eq\.true/);
  return Response.json([...lawn, ...children]);
};

const env = {
  SM_ORG_ID: "3770972d-1bbd-417b-b413-297e844db285",
  ASSETS: { fetch: async () => new Response(shell, { headers: { "Content-Type": "text/html" } }) },
};

const response = await onRequestGet({
  request: new Request("https://preview.example/memorials?type=childrens-memorials"),
  env,
});
assert.equal(response.status, 200);
const body = await response.text();
assert.match(body, /rel="canonical" href="https:\/\/searsmelvin\.co\.uk\/memorials"/);
assert.match(captured["#productsGrid"], /childrens-memorials-0/);
assert.match(captured["#productsGrid"], /Child&#039;s book|Child&#39;s book/);
assert.doesNotMatch(captured["#productsGrid"], /lawn-headstones|More memorials/);
assert.equal(captured["#resultsCount"], "2");
assert.equal(captured["#catalogueMore"], undefined);
assert.equal(captured["#rangeLinks"], undefined);

for (const key of Object.keys(captured)) delete captured[key];
const allResponse = await onRequestGet({
  request: new Request("https://preview.example/memorials"),
  env,
});
assert.equal(allResponse.status, 200);
assert.match(captured["#productsGrid"], /href="\/memorials\/lawn-headstones-0"/);
assert.doesNotMatch(captured["#productsGrid"], /lawn-headstones-24|More memorials|range-links/);
assert.equal(captured["#resultsCount"], "27");
assert.equal(captured['.type-count[data-type-count="all"]'], "27");
assert.doesNotMatch(captured["#productsGrid"], /id="stoneBand"|listing-stone-dot/);
assert.match(captured["#productsGrid"], /All 1 stone/);
assert.match(captured["#listingStoneTrack"], /data-slug="blue-pearl"/);
assert.equal(captured[".stone-colour-count"], "1");
assert.doesNotMatch(captured["#productsGrid"], /Compare the stones|product-colour-dot/);
assert.equal(captured["#catalogueMore"], "visible");
assert.equal(captured["#rangeLinks"], undefined);

console.log("catalogue-links: ok");
