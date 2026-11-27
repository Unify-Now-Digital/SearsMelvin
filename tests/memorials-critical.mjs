// /memorials keeps its stylesheets render-blocking. The inline block is a
// small duplicate of the first-screen layout, and the catalogue loads a
// trimmed copy of the shared sheet instead of the full one.
import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";

const html = readFileSync("memorials.html", "utf8");
const head = html.slice(0, html.indexOf("</head>"));
assert.match(head, /<style id="sm-critical">/);
assert.match(head, /<link rel="stylesheet" href="\/memorials\.css\?v=e2b5a41e4e">/);
assert.match(head, /<link rel="stylesheet" href="\/memorials-upgrades\.css\?v=20261127f">/);
assert.doesNotMatch(head, /site-upgrades\.css/);
assert.doesNotMatch(head, /memorials\.css[^"]*" media="print"/);
assert.doesNotMatch(head, /memorials-upgrades\.css[^"]*" media="print"/);
assert.doesNotMatch(head, /memorials\.css[^"]*" rel="preload"/);
assert.doesNotMatch(head, /memorials-upgrades\.css[^"]*" rel="preload"/);
const critical = head.slice(head.indexOf('<style id="sm-critical">'), head.indexOf("</style>", head.indexOf("sm-critical")));
assert.ok(critical.length < 4000, "critical CSS stays small");
assert.match(critical, /site-trust-bar/);
assert.match(critical, /product-image/);
assert.match(critical, /#navbar/);
assert.doesNotMatch(critical, /onload=/);

const full = statSync("site-upgrades.css").size;
const trimmed = statSync("memorials-upgrades.css").size;
assert.ok(trimmed < full * 0.75, "the catalogue copy of the shared sheet is smaller");
const sheet = readFileSync("memorials-upgrades.css", "utf8");
const page = readFileSync("memorials.css", "utf8");
for (const name of ["site-trust-bar", "product-card", "save-btn", "shortlist-panel", "search-modal"]) {
  assert.ok(page.includes(name) || sheet.includes(name), name);
}
assert.match(readFileSync("memorial.html", "utf8"), /memorial-option-b\.css\?v=20261127f/);

console.log("memorials-critical: ok");
