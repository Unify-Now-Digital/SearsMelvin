// /memorials toolbar. One scrolling type row, a price icon, and the stone band.
// The sidebar, the colour filter, and the phone Filters drawer are gone.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../memorials.html", import.meta.url), "utf8");
const server = readFileSync(new URL("../functions/memorials.js", import.meta.url), "utf8");

assert.doesNotMatch(html, /id="typeFilters"|id="colourFilters"|id="filtersShow"|id="filtersShowCount"|id="filtersSidebar"/);
assert.doesNotMatch(html, /class="mobile-filter-btn"|class="filters-show"/);
assert.doesNotMatch(html, />Featured</);
assert.match(html, /id="sortSelect"/);
assert.match(html, /value="featured"/);
assert.match(html, /id="priceSort"/);
assert.match(html, /aria-label="Usual order"/);
assert.match(html, /Price, low to high/);
assert.match(html, /Price, high to low/);
assert.match(html, /function cyclePriceSort/);
assert.match(html, /min-width:\s*44px/);
assert.match(html, /min-height:\s*44px/);
assert.match(html, /history\[push \? 'pushState' : 'replaceState'\]/);
assert.match(html, /function onTypeChipClick/);
assert.match(html, /input\[data-filter="type"\]/);
assert.match(html, /data-filter="price"/);

const browse = html.match(/<nav class="type-browse"[\s\S]*?<\/nav>/);
assert.ok(browse, "type chip row missing");
assert.match(browse[0], /All memorials/);
assert.match(browse[0], /data-type-count="all"/);
assert.match(browse[0], /flex-wrap:\s*nowrap|class="type-browse-list"/);
assert.doesNotMatch(browse[0], />\s*\d+\s*</, "chip counts are not hard-coded");

assert.match(html, /@media \(min-width: 1024px\) \{ \.products-grid \{ grid-template-columns: repeat\(3, 1fr\); \} \}/);
assert.match(html, /@media \(min-width: 1280px\) \{ \.products-grid \{ grid-template-columns: repeat\(4, 1fr\); \} \}/);
assert.match(html, /@media \(max-width: 1200px\) \{ \.products-grid \{ grid-template-columns: repeat\(2, 1fr\); \} \}/);

assert.match(html, /id="stoneBand"/);
assert.match(html, /Every design comes in all/);
assert.match(html, /The From price is for a standard stone\. Premium and natural stones cost a little more\./);
assert.match(html, /grid-template-rows:\s*4\.25rem 4\.25rem/);
assert.match(html, /\.products-grid > \.stone-band \{[\s\S]*?grid-row:\s*1;/);
assert.match(html, /\.products-grid > \.stone-band \{[\s\S]*?margin-bottom:\s*var\(--sm-space-4\);/);
assert.doesNotMatch(html, /grid-row:\s*2/);
assert.match(html, /font-variant-numeric:\s*tabular-nums/);
assert.doesNotMatch(html, /font-family:\s*[^;]*monospace/);
assert.doesNotMatch(html, /Compare the stones/);
assert.match(html, /All ' \+ n \+ \(n === 1 \? ' stone' : ' stones'\)/);

assert.match(server, /function stoneBandMarkup/);
assert.match(server, /Every design comes in all/);
assert.match(server, /product-stones/);
assert.doesNotMatch(server, /product-colour-dot|filtersShowCount|Compare the stones/);
assert.match(html, /\['type', 'price'\]/);

console.log("memorials-toolbar: ok");
