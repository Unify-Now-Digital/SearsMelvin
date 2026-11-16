import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { onRequestGet } from "../functions/sitemap.xml.js";
import { CATEGORIES } from "../data/categories.js";
import { PAGE_LASTMOD } from "../functions/_page-lastmod.js";

const source = readFileSync(new URL("../functions/sitemap.xml.js", import.meta.url), "utf8");
assert.match(source, /CATEGORIES/);
assert.doesNotMatch(source, /\/areas\//);

for (const category of CATEGORIES) {
  const path = `/memorials/type/${category.slug}`;
  assert.match(PAGE_LASTMOD[path], /^\d{4}-\d{2}-\d{2}$/, path);
}

globalThis.fetch = async () => Response.json([
  { slug: "the-castell", updated_at: "2026-11-01T00:00:00Z" },
]);

const response = await onRequestGet({ env: {} });
assert.equal(response.status, 200);
const xml = await response.text();
for (const category of CATEGORIES) {
  assert.match(xml, new RegExp(`<loc>https://searsmelvin\\.co\\.uk/memorials/type/${category.slug}</loc>`));
}
assert.match(xml, /<loc>https:\/\/searsmelvin\.co\.uk\/memorials\/the-castell<\/loc>/);
assert.doesNotMatch(xml, /\/areas\//);
assert.match(xml, /<lastmod>2026-11-16<\/lastmod>/);

console.log("sitemap-new-pages: ok");
