// The A–Z name list is not on /memorials. The header rule stays on #navbar.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../memorials.html", import.meta.url), "utf8");
const server = readFileSync(new URL("../functions/memorials.js", import.meta.url), "utf8");

assert.equal(html.includes("catalogueIndex"), false);
assert.equal(html.includes("catalogue-index"), false);
assert.equal(html.includes("ensureCatalogueIndex"), false);
assert.equal(html.includes("<details"), false);
assert.equal(html.includes("All memorials, A to Z"), false);
assert.match(html, /nav#navbar \{/);
assert.match(html, /data-brochure-source="listing"/);
assert.equal(server.includes("catalogueIndex"), false);
assert.equal(server.includes("renderIndex"), false);

console.log("catalogue-index: ok");
