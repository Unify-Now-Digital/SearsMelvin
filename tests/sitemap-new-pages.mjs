import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { onRequestGet } from "../functions/sitemap.xml.js";
import { CATEGORIES } from "../data/categories.js";
import { PAGE_LASTMOD } from "../functions/_page-lastmod.js";

const source = readFileSync(new URL("../functions/sitemap.xml.js", import.meta.url), "utf8");
assert.doesNotMatch(source, /CATEGORIES|memorials\/type|\?type=/);
assert.doesNotMatch(source, /\/areas\//);

for (const category of CATEGORIES) {
  assert.equal(PAGE_LASTMOD[`/memorials/type/${category.slug}`], undefined);
}

globalThis.fetch = async () => Response.json([
  { slug: "the-castell", updated_at: "2026-11-01T00:00:00Z" },
]);

const response = await onRequestGet({ env: {} });
assert.equal(response.status, 200);
const xml = await response.text();
for (const category of CATEGORIES) {
  assert.doesNotMatch(xml, new RegExp(`/memorials/type/${category.slug}`));
  assert.doesNotMatch(xml, new RegExp(`[?&]type=${category.slug}`));
}
assert.match(xml, /<loc>https:\/\/searsmelvin\.co\.uk\/memorials\/the-castell<\/loc>/);
assert.match(xml, /<loc>https:\/\/searsmelvin\.co\.uk\/memorials<\/loc>/);
assert.doesNotMatch(xml, /\/areas\//);
assert.doesNotMatch(xml, /\?type=/);
assert.match(xml, /<lastmod>2026-11-09<\/lastmod>/);

console.log("sitemap-new-pages: ok");
