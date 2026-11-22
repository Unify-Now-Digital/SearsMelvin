// /memorials renders every matching design in the grid. There is no
// "Show more memorials" button and no "More memorials" link list.
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
assert.doesNotMatch(html, /id="catalogueMore"|Show more memorials|showMoreMemorials|CATALOGUE_PAGE/);
assert.match(html, /catalogueMatchCount/);
assert.match(html, /filterSelectEvent\(change, catalogueMatchCount, meta\)/);
assert.match(html, /function firstRowCount\(\)/);
assert.match(html, /loading="eager" fetchpriority="high"/);
assert.match(html, /loading="lazy"/);
assert.doesNotMatch(server, /CARD_PAGE|catalogueMore|Show more/);
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
    image_url: `https://bfwohzcugtwbhhxdqgme.supabase.co/storage/v1/object/public/product-images/${type}-${index}.jpg`,
    product_categories: { name: type, slug: type },
  };
}

function cardImages(grid) {
  return [...grid.matchAll(/<a href="\/memorials\/[^"]+" class="product-card"[\s\S]*?<\/a>/g)].map((match) => {
    const img = match[0].match(/<img\b[^>]*>/);
    return img ? img[0] : "";
  });
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
for (const item of [...lawn, ...children]) {
  assert.equal(hrefs.filter((slug) => slug === item.slug).length, 1, item.slug);
}
assert.equal(hrefs.includes("lawn-headstones-24"), true);
assert.equal(hrefs.includes("childrens-memorials-0"), true);
assert.match(all.grid, /href="\/memorials\/lawn-headstones-0"/);
assert.equal(all.count, 27);
assert.equal(all.more, undefined);
const images = cardImages(all.grid);
assert.equal(images.length, 27);
for (const [index, tag] of images.entries()) {
  assert.match(tag, /width="800"/, index);
  assert.match(tag, /height="800"/, index);
  if (index === 0) {
    assert.match(tag, /loading="eager"/, index);
    assert.match(tag, /fetchpriority="high"/, index);
    assert.doesNotMatch(tag, /decoding="async"/, index);
  } else if (index < 2) {
    assert.match(tag, /loading="eager"/, index);
    assert.match(tag, /decoding="async"/, index);
    assert.match(tag, /fetchpriority="low"/, index);
  } else {
    assert.match(tag, /loading="lazy"/, index);
    assert.match(tag, /decoding="async"/, index);
    assert.doesNotMatch(tag, /fetchpriority/, index);
  }
}

const onlyChildren = catalogueInjection(children, colours);
assert.match(onlyChildren.grid, /href="\/memorials\/childrens-memorials-0"/);
assert.match(onlyChildren.grid, /href="\/memorials\/childrens-memorials-1"/);
assert.match(onlyChildren.grid, /Child&#039;s book|Child&#39;s book/);
assert.equal(onlyChildren.more, undefined);
const childImages = cardImages(onlyChildren.grid);
assert.match(childImages[0], /loading="eager"/);
assert.match(childImages[0], /fetchpriority="high"/);
assert.doesNotMatch(childImages[0], /decoding="async"/);
assert.match(childImages[1], /loading="eager"/);
assert.match(childImages[1], /fetchpriority="low"/);
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
      append(value) { captured[`${selector}@append`] = value; },
    });
    return super.on(selector, handler);
  }
};

const shell = "<!DOCTYPE html><html><head><link rel=\"canonical\" href=\"https://searsmelvin.co.uk/memorials\"></head><body><div id=\"productsGrid\"></div><span id=\"resultsCount\">...</span><span id=\"filtersShowCount\">0</span></body></html>";
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
assert.match(captured["#productsGrid"], /lawn-headstones-24/);
assert.doesNotMatch(captured["#productsGrid"], /More memorials|range-links|Show more/);
assert.equal(captured["#resultsCount"], "27");
assert.equal(captured['.type-count[data-type-count="all"]'], "27");
assert.match(captured["#productsGrid"], /id="stoneBand"/);
assert.match(captured["#productsGrid"], /All 1 stone/);
assert.match(captured["#productsGrid"], /Every design comes in all/);
assert.doesNotMatch(captured["#productsGrid"], /Compare the stones|product-colour-dot/);
assert.equal(captured["#catalogueMore"], undefined);
assert.equal(captured["#rangeLinks"], undefined);
assert.match(captured["head@append"], /rel="preload" as="image"/);
assert.match(captured["head@append"], /fetchpriority="high"/);
assert.match(captured["head@append"], /lawn-headstones-0/);
assert.match(captured["head@append"], /imagesrcset="[^"]*width=400[^"]* 400w, [^"]*width=800[^"]* 800w, [^"]*width=1200[^"]* 1200w"/);
assert.match(captured["head@append"], /imagesizes="\(max-width: 1023px\) 50vw, \(max-width: 1279px\) 33vw, \(max-width: 1679px\) 25vw, 20vw"/);
assert.match(captured["head@append"], /href="[^"]*width=800&amp;quality=70/);
const firstImg = cardImages(captured["#productsGrid"])[0];
const preloadSrcset = captured["head@append"].match(/imagesrcset="([^"]+)"/)[1];
const imgSrcset = firstImg.match(/srcset="([^"]+)"/)[1];
assert.equal(preloadSrcset, imgSrcset);
assert.equal(
  captured["head@append"].match(/imagesizes="([^"]+)"/)[1],
  firstImg.match(/sizes="([^"]+)"/)[1],
);
assert.match(html, /\.product-face \{[^}]*content-visibility:\s*auto/);
assert.match(html, /nth-child\(-n \+ 4\) \.product-face \{[^}]*content-visibility:\s*visible/);
assert.doesNotMatch(html, /\.product-card \{[^}]*content-visibility/);
assert.match(server, /aria-label="\$\{escapeHtml\(cardAccessibleName\(productName, categoryName, colours\.length, price\)\)\}"/);
assert.match(all.grid, /aria-label="Lawn 0, lawn-headstones, All 1 stone, From £1,000"/);
assert.match(html, /function cardAccessibleName\(name, category, stoneCount, price\)/);
assert.match(html, /aria-label="Save ' \+ escapeHtml\(productName\) \+ '"/);
assert.match(server, /aria-label="Save \$\{escapeHtml\(productName\)\}"/);
assert.match(server, /alt=""/);
assert.match(server, /class="product-info" aria-hidden="true"/);
assert.match(all.grid, /aria-label="Save Lawn 0"/);
assert.match(all.grid, /<img [^>]*alt=""/);
assert.match(server, /<div class="product-face">/);

console.log("catalogue-links: ok");
