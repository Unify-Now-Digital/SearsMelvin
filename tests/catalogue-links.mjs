// Every listed design is linked from server-rendered /memorials HTML.
// The first page is cards. The rest are text links under "More memorials".
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { catalogueInjection, onRequestGet } from "../functions/memorials.js";
import { CATEGORIES } from "../data/categories.js";

const html = readFileSync(new URL("../memorials.html", import.meta.url), "utf8");
assert.match(html, /<link rel="canonical" href="https:\/\/searsmelvin\.co\.uk\/memorials">/);
assert.match(html, /id="rangeLinks"/);
assert.match(html, /function applyUrlFilters\(\)/);
assert.match(html, /safeSlug\(params\.get\('type'\)\)/);
assert.match(html, /if \(!applyUrlFilters\(\)\) renderProducts\(\)/);
assert.doesNotMatch(html, /canonical[^>]{0,80}searchParams|searchParams\.get\('type'\)[\s\S]{0,120}canonical/);
assert.equal(html.includes("/memorials/type/"), false);

const order = html.match(/RANGE_TYPE_ORDER = \[([^\]]+)\]/);
assert.ok(order, "range type order missing");
assert.deepEqual(
  [...order[1].matchAll(/'([a-z0-9-]+)'/g)].map((match) => match[1]),
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
const hrefs = [...`${all.grid}\n${all.links}`.matchAll(/href="\/memorials\/([a-z0-9-]+)"/g)].map((match) => match[1]);
for (const item of [...lawn, ...children]) {
  assert.equal(hrefs.filter((slug) => slug === item.slug).length, 1, item.slug);
}
assert.match(all.grid, /href="\/memorials\/lawn-headstones-0"/);
assert.doesNotMatch(all.grid, /href="\/memorials\/lawn-headstones-24"/);
assert.match(all.links, /href="\/memorials\/lawn-headstones-24"/);
assert.match(all.links, /href="\/memorials\/childrens-memorials-0"/);
assert.match(all.links, /href="\/memorials\/childrens-memorials-1"/);
assert.match(all.links, /Child&#039;s book|Child&#39;s book/);
assert.equal(all.count, 27);
assert.equal(all.more, true);

const onlyChildren = catalogueInjection(children, colours);
assert.match(onlyChildren.grid, /href="\/memorials\/childrens-memorials-0"/);
assert.match(onlyChildren.grid, /href="\/memorials\/childrens-memorials-1"/);
assert.equal(onlyChildren.links, "");
assert.doesNotMatch(onlyChildren.grid, /lawn-headstones/);

const captured = {};
globalThis.HTMLRewriter = class {
  constructor() { this.handlers = []; }
  on(selector, handler) { this.handlers.push({ selector, handler }); return this; }
  transform(response) {
    const handlers = this.handlers;
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

const shell = "<!DOCTYPE html><html><head><link rel=\"canonical\" href=\"https://searsmelvin.co.uk/memorials\"></head><body><div id=\"productsGrid\"></div><nav id=\"rangeLinks\"></nav><span id=\"resultsCount\">...</span><span id=\"filtersShowCount\">0</span><button id=\"catalogueMore\" hidden></button></body></html>";
globalThis.fetch = async (url) => {
  const target = String(url);
  assert.match(target, /organization_id=eq\.|stone_colours/);
  if (target.includes("stone_colours")) return Response.json(colours);
  assert.match(target, /is_active=eq\.true/);
  assert.match(target, /is_listed=eq\.true/);
  return Response.json([...lawn, ...children]);
};

const response = await onRequestGet({
  request: new Request("https://preview.example/memorials?type=childrens-memorials"),
  env: {
    SM_ORG_ID: "3770972d-1bbd-417b-b413-297e844db285",
    ASSETS: { fetch: async () => new Response(shell, { headers: { "Content-Type": "text/html" } }) },
  },
});
assert.equal(response.status, 200);
const body = await response.text();
assert.match(body, /rel="canonical" href="https:\/\/searsmelvin\.co\.uk\/memorials"/);
assert.match(captured["#productsGrid"], /childrens-memorials-0/);
assert.doesNotMatch(captured["#productsGrid"], /lawn-headstones/);
assert.equal(captured["#resultsCount"], "2");
assert.equal(captured["#catalogueMore"], undefined);

console.log("catalogue-links: ok");
