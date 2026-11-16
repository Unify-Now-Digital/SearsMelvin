// Public copy no longer says North London or UK-wide.
// The England & Wales legal lines stay.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const root = new URL("../", import.meta.url);
const htmlFiles = readdirSync(root).filter((name) => name.endsWith(".html"));
const files = [
  ...htmlFiles,
  "product-copy.js",
  "data/categories.js",
  "functions/_business-schema.js",
  "functions/memorials/type/[type].js",
  "functions/sitemap.xml.js",
  "functions/api/submit.js",
  "functions/api/stripe-webhook.js",
  "functions/api/brochure.js",
];

for (const file of files) {
  const text = readFileSync(new URL(file, root), "utf8");
  assert.equal(text.includes("North London"), false, `${file} still says North London`);
  assert.equal(text.includes("UK-wide"), false, `${file} still says UK-wide`);
}

const terms = readFileSync(new URL("terms.html", root), "utf8");
const privacy = readFileSync(new URL("privacy.html", root), "utf8");
assert.match(terms, /laws of England and Wales/);
assert.match(terms, /Registered in England &amp; Wales/);
assert.match(privacy, /Registered in England &amp; Wales/);

const home = readFileSync(new URL("index.html", root), "utf8");
assert.match(home, /Greater London and surrounds/);
assert.match(home, /class="footer-explore"[\s\S]*\/memorials\?type=lawn-headstones/);
assert.doesNotMatch(home, /\/memorials\/type\//);
assert.doesNotMatch(home, /href="\/areas"/);

console.log("no-north-london: ok");
