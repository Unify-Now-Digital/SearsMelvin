// One visible Greater London line on Contact, About, and /memorials.
// Home, product pages, and schema stay as they are. No UK-wide wording.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const LINE = "We serve families across Greater London.";
const pages = {
  "contact.html": 2,
  "about.html": 1,
  "memorials.html": 1,
};

for (const [name, count] of Object.entries(pages)) {
  const html = readFileSync(name, "utf8");
  const found = html.split(LINE).length - 1;
  assert.equal(found, count, `${name} should show the line ${count} time(s)`);
  assert.doesNotMatch(html, /UK-wide|UK wide/i, `${name} must not say UK-wide`);
}

const contact = readFileSync("contact.html", "utf8");
assert.match(contact, /class="service-area-line"/);
assert.match(contact, /class="service-area-line service-area-line-compact"/);
const css = readFileSync("site-upgrades.css", "utf8");
assert.match(css, /@media \(max-width: 768px\) \{\s*html body \.form-header p\.service-area-line-compact \{ display: block; \}/);
assert.match(css, /html body p\.service-area-line-compact \{ display: none; \}/);

const elsewhere = readdirSync(".").filter((name) => name.endsWith(".html") && !pages[name]);
for (const name of elsewhere) {
  const html = readFileSync(name, "utf8");
  assert.equal(html.includes(LINE), false, `${name} is outside the coverage line`);
}

for (const name of ["index.html", "memorial.html", "contact.html", "about.html", "memorials.html"]) {
  const html = readFileSync(name, "utf8");
  const schema = html.slice(html.indexOf('"areaServed"'), html.indexOf('"areaServed"') + 800);
  assert.match(schema, /Greater London/);
  assert.match(schema, /Hertfordshire/);
  assert.doesNotMatch(schema, /UK-wide/);
}

console.log("service-area-line: ok");
