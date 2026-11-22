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
assert.match(slug, /limit=8/);
assert.match(slug, /\/memorials\?type=/);
assert.doesNotMatch(slug, /\/memorials\/type\//);
assert.match(slug, /See all /);
assert.match(memorial, /min-height: 8\.75rem/);
assert.match(memorial, /#phoneColourSlot\[hidden\] \{ display: block !important; min-height: 19rem; padding-bottom: calc\(150px \+ env\(safe-area-inset-bottom\)\); \}/);
assert.match(memorial, /memorials\?type=/);
assert.doesNotMatch(memorial, /\/memorials\/type\//);
const fade = memorial.match(/@keyframes fadeInUp \{[^}]+\}/);
assert.ok(fade, "fadeInUp missing");
assert.match(fade[0], /opacity/);
assert.match(fade[0], /transform/);
assert.doesNotMatch(fade[0], /height|margin|padding|top:|width/);
const cookie = readFileSync(new URL("cookie-consent.css", root), "utf8");
assert.match(cookie, /#cookieConsent\.sm-cookie \{[\s\S]*position:\s*fixed/);
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
