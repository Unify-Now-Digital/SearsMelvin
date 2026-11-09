// Header rules stay on #navbar. Related designs stay in normal flow.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const root = new URL("..", import.meta.url);
const memorial = readFileSync(new URL("memorial.html", root), "utf8");
const slug = readFileSync(new URL("functions/memorials/[slug].js", root), "utf8");

assert.match(memorial, /nav#navbar \{ position: fixed;/);
assert.match(memorial, /nav#navbar \{ min-height: 64px;/);
assert.doesNotMatch(memorial, /(^|\n)\s*nav \{/);
assert.match(memorial, /nav\.related-designs \{[^}]*position:\s*static/);
assert.match(memorial, /id="relatedDesigns"/);
assert.match(slug, /#relatedDesigns/);
assert.doesNotMatch(slug, /(^|\n)\s*nav \{/);

const adminProducts = readFileSync(new URL("admin-products.html", root), "utf8");
assert.match(adminProducts, /nav:not\(\.mobile-bottom-nav\) \{ position: fixed/);
assert.equal(adminProducts.includes('id="navbar"'), false);

const pages = readdirSync(new URL(".", root)).filter((name) => name.endsWith(".html"));
for (const name of pages) {
  const html = readFileSync(new URL(name, root), "utf8");
  assert.doesNotMatch(html, /(^|\n)\s*nav \{/, `${name} still has a bare nav rule`);
  if (html.includes('class="mobile-bottom-nav"') && html.includes('id="navbar"')) {
    assert.match(html, /nav#navbar \{/, `${name} header rule is not scoped to #navbar`);
  }
}

const shared = readFileSync(new URL("accreditations.css", root), "utf8") + readFileSync(new URL("site-upgrades.css", root), "utf8");
assert.doesNotMatch(shared, /(^|\n)\s*nav \{/);
assert.doesNotMatch(shared, /(^|\n)\s*nav[ .,{]/);

console.log("related-designs-nav: ok");
