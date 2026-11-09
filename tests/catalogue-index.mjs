// The A–Z memorial index stays in the HTML, under the brochure block,
// inside a native details element that is closed until a person opens it.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../memorials.html", import.meta.url), "utf8");
const server = readFileSync(new URL("../functions/memorials.js", import.meta.url), "utf8");

const block = html.match(/<details class="catalogue-index-details">[\s\S]*?<\/details>/);
assert.ok(block, "missing the memorial index details");
assert.doesNotMatch(block[0], /\sopen(?:\s|=|>)/, "the index must be closed by default");
assert.match(
  block[0],
  /<summary><span class="catalogue-index-marker" aria-hidden="true"><\/span>All memorials, A to Z<\/summary>/,
);
assert.match(
  block[0],
  /<nav class="catalogue-index" id="catalogueIndex" aria-label="All memorials"><\/nav>/,
);

const grid = html.indexOf('id="productsGrid"');
const cta = html.indexOf('class="sm-brochure-cta"');
const index = html.indexOf('id="catalogueIndex"');
assert.ok(grid !== -1 && cta !== -1 && index !== -1);
assert.ok(grid < cta && cta < index, "the index sits below the brochure CTA");
assert.equal(html.match(/id="catalogueIndex"/g).length, 1);
assert.match(html, /data-brochure-source="listing"/);
assert.match(html, /nav#navbar \{/);

const style = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map((match) => match[1]).join("\n");
const indexCss = style.slice(style.indexOf(".catalogue-index-details"));
assert.ok(indexCss.startsWith(".catalogue-index-details"));
assert.match(indexCss, /column-count:\s*2/);
assert.match(indexCss, /@media \(min-width:\s*744px\) \{ nav\.catalogue-index \{ column-count:\s*3/);
assert.match(indexCss, /@media \(min-width:\s*1280px\) \{ nav\.catalogue-index \{ column-count:\s*4/);
assert.match(indexCss, /position:\s*static/);
assert.match(indexCss, /var\(--sm-color-text\)/);
assert.match(indexCss, /var\(--sm-color-link\)/);
assert.match(indexCss, /var\(--sm-font-body\)/);
assert.match(indexCss, /var\(--sm-text-sm\)/);
assert.match(indexCss, /var\(--sm-radius-sm\)/);
assert.match(indexCss, /summary:focus-visible/);

const hiddenLink = /nav\.catalogue-index[^{]*\{[^}]*(?:display\s*:\s*none|visibility\s*:\s*hidden|content-visibility\s*:\s*hidden|font-size\s*:\s*0|height\s*:\s*0|width\s*:\s*0|text-indent\s*:\s*-)/;
assert.doesNotMatch(indexCss, hiddenLink, "the index links must stay on screen when the details is open");
assert.doesNotMatch(indexCss, /visually-hidden|sr-only|clip-path:\s*inset\(100|left:\s*-999/);
assert.match(server, /#catalogueIndex/);
assert.match(server, /<a href="\/memorials\/\$\{slug\}">/);

console.log("catalogue-index: ok");
