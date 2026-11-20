// /memorials/type/<slug> is a 301 to the filtered range page.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { onRequestGet } from "../functions/memorials/type/[type].js";
import { CATEGORIES } from "../data/categories.js";

const source = readFileSync(new URL("../functions/memorials/type/[type].js", import.meta.url), "utf8");
assert.doesNotMatch(source, /renderCategoryPage|ASSETS\.fetch|supabase/);
assert.doesNotMatch(source, /SERVICE_ROLE|service_role|sb_secret_/);

let response = await onRequestGet({
  request: new Request("https://preview.example/memorials/type/unknown"),
  params: { type: "unknown" },
});
assert.equal(response.status, 404);
assert.equal(response.headers.get("X-Robots-Tag"), "noindex");

response = await onRequestGet({
  request: new Request("https://preview.example/memorials/type/Kerb-Sets?utm_source=old"),
  params: { type: "Kerb-Sets" },
});
assert.equal(response.status, 301);
assert.equal(response.headers.get("Location"), "/memorials?type=kerb-sets&utm_source=old");
assert.equal(response.headers.get("X-Robots-Tag"), "noindex");

for (const category of CATEGORIES) {
  response = await onRequestGet({
    request: new Request(`https://searsmelvin.co.uk/memorials/type/${category.slug}`),
    params: { type: category.slug },
  });
  assert.equal(response.status, 301, category.slug);
  assert.equal(response.headers.get("Location"), `/memorials?type=${category.slug}`);
}

console.log("category-pages: ok");
