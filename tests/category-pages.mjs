import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { onRequestGet } from "../functions/memorials/type/[type].js";
import { CATEGORIES, introText, wordCount } from "../data/categories.js";
import { shellParts } from "../functions/_seo-document.js";
import { businessJsonLd } from "../functions/_business-schema.js";

const shell = readFileSync(new URL("../memorials.html", import.meta.url), "utf8");
const parts = shellParts(shell);
assert.ok(parts.trackingHead.includes("GTM-KRDX4BQ5"));
assert.ok(parts.trackingHead.includes("gtag('consent', 'default'"));
assert.ok(parts.cookie.includes("cookie-consent.js"));

const products = [
  { name: "The Castell", slug: "the-castell", base_price: 1450, product_categories: { name: "Lawn Headstones", slug: "lawn-headstones" } },
  { name: "The Bolton", slug: "the-bolton", base_price: 2100, product_categories: { name: "Lawn Headstones", slug: "lawn-headstones" } },
  { name: "The Hartwell", slug: "the-hartwell", base_price: 4140, product_categories: { name: "Kerb Sets", slug: "kerb-sets" } },
];

let fetches = 0;
globalThis.fetch = async (url) => {
  fetches += 1;
  assert.match(String(url), /organization_id=eq\./);
  assert.match(String(url), /is_active=eq\.true/);
  assert.match(String(url), /is_listed=eq\.true/);
  assert.match(String(url), /category_id=not\.is\.null/);
  assert.match(String(url), /select=\*,product_categories\(name,slug\)/);
  return Response.json(products);
};

const env = {
  SM_ORG_ID: "3770972d-1bbd-417b-b413-297e844db285",
  ASSETS: { fetch: async () => new Response(shell) },
};

let response = await onRequestGet({
  request: new Request("https://searsmelvin.co.uk/memorials/type/unknown"),
  env,
  params: { type: "unknown" },
});
assert.equal(fetches, 0);
assert.equal(response.status, 404);

response = await onRequestGet({
  request: new Request("https://searsmelvin.co.uk/memorials/type/lawn-headstones"),
  env,
  params: { type: "lawn-headstones" },
});
assert.equal(response.status, 200);
const html = await response.text();
assert.equal((html.match(/<h1\b/g) || []).length, 1);
assert.match(html, /<h1>Lawn headstones<\/h1>/);
assert.match(html, /<link rel="canonical" href="https:\/\/searsmelvin\.co\.uk\/memorials\/type\/lawn-headstones">/);
assert.ok(html.includes(parts.trackingHead));
assert.ok(html.includes(parts.gtmNoscript));
assert.ok(html.includes(parts.cookie));
assert.match(html, /href="\/memorials\/the-castell"/);
assert.match(html, /href="\/memorials\/the-bolton"/);
assert.doesNotMatch(html, /href="\/memorials\/the-hartwell"/);
assert.match(html, /Guide prices start from £1,450/);
assert.match(html, /Cemetery permit fees are extra and vary by cemetery/);
assert.match(html, /Many cemeteries/);
assert.match(html, /We check the cemetery's rules first/);
assert.doesNotMatch(html, /UK-wide|North London|\/areas/);
assert.doesNotMatch(html, /\sstyle="/);
assert.match(html, /020 3835 2548/);

const lawn = CATEGORIES.find((category) => category.slug === "lawn-headstones");
const words = wordCount(introText(lawn, "£1,450"));
assert.ok(words >= 120 && words <= 200, String(words));
assert.ok(lawn.title.length <= 60);
assert.ok(lawn.meta.length >= 140 && lawn.meta.length <= 155, String(lawn.meta.length));

for (const block of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
  JSON.parse(block[1]);
}
assert.match(html, /"@type":"FAQPage"/);
assert.match(html, /"@type":"ItemList"/);
assert.match(html, /"@type":"BreadcrumbList"/);
assert.match(html, /Greater London/);
const business = businessJsonLd();
assert.equal(business.geo.latitude, 51.58619);
assert.equal(business.geo.longitude, -0.18362);
assert.equal(business.sameAs, undefined);
assert.equal(business.aggregateRating, undefined);
assert.equal(JSON.stringify(business).includes("NAMM"), false);

globalThis.fetch = async () => new Response("no", { status: 503 });
response = await onRequestGet({
  request: new Request("https://searsmelvin.co.uk/memorials/type/lawn-headstones"),
  env,
  params: { type: "lawn-headstones" },
});
assert.equal(response.status, 503);

const source = readFileSync(new URL("../functions/memorials/type/[type].js", import.meta.url), "utf8");
assert.match(source, /publishableKey/);
assert.doesNotMatch(source, /SERVICE_ROLE|service_role|sb_secret_/);

console.log("category-pages: ok");
