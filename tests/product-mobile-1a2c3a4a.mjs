// Product page on phones (767px and below): options 1A, 2C, 3A and 4A.
// 1A colour picker grid, 2C back link + title/price row, 3A guarantee
// icons, 4A bolder phone-bar price. 768px and wider keep the old rules.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const root = new URL("..", import.meta.url);
const html = readFileSync(new URL("memorial.css", root), "utf8") + "\n" + readFileSync(new URL("memorial.html", root), "utf8");
const globals = readFileSync(new URL("site-globals.js", root), "utf8");
const slugFn = readFileSync(new URL("functions/memorials/[slug].js", root), "utf8");

// Every @media (max-width: 767px) block in the page's inline style, braces balanced.
function mediaBlocks(source, query) {
  const out = [];
  let at = source.indexOf(query);
  while (at !== -1) {
    const open = source.indexOf("{", at);
    let depth = 0;
    let i = open;
    for (; i < source.length; i++) {
      if (source[i] === "{") depth++;
      else if (source[i] === "}" && --depth === 0) break;
    }
    out.push(source.slice(open + 1, i));
    at = source.indexOf(query, i);
  }
  return out;
}
function rule(block, selectorRe) {
  const m = block.match(new RegExp(selectorRe.source + "\\s*\\{([^}]*)\\}"));
  return m ? m[1] : null;
}

const phone = mediaBlocks(html, "@media (max-width: 767px)").find((b) => b.includes("Option 2C"));
assert.ok(phone, "a 767px block carries the phone product rules");

// --- 1A: the picker wraps, no sideways strip ---
const options = rule(phone, /\.phone-colour-slot \.colour-options/);
assert.ok(options, "the phone block restyles the colour options");
assert.match(options, /display:\s*block/);
assert.match(options, /overflow:\s*visible/);
const row = rule(phone, /\.phone-colour-slot \.colour-swatch-row/);
assert.ok(row, "the phone block restyles the swatch rows");
assert.match(row, /display:\s*grid/);
assert.match(row, /grid-template-columns:\s*repeat\(auto-fill/);
const colourRules = phone.slice(0, phone.indexOf("Option 2C"));
assert.doesNotMatch(colourRules, /flex-wrap:\s*nowrap/, "no nowrap strip on phones");
assert.doesNotMatch(colourRules, /overflow-x:\s*auto/, "no sideways scroll on phones");
assert.match(colourRules, /\.colour-group-tag-full \{ display: inline; \}/, "full group names show on phones");
assert.match(colourRules, /\.colour-group-tag-short \{ display: none; \}/);
assert.match(rule(phone, /\.phone-colour-slot \.stone-colour-preview-frame/) || "", /width:\s*96px;\s*height:\s*96px/);
assert.match(html, /function revealColourSwatch[\s\S]{0,700}if \(strip\.scrollWidth <= strip\.clientWidth\) return;/,
  "the sideways reveal is a no-op when the strip does not scroll");

// The premium tiers stay <details> and open on phones; selection logic unchanged.
assert.match(html, /function premiumGroup\(tag, shortTag, list\)/);
assert.match(html, /<details class="colour-tier"' \+ open \+ '><summary>/);
assert.match(html, /details\.colour-tier'\)\.forEach\(function \(details\) \{ details\.open = true; \}\)/);
assert.match(html, /state\.colourPrice = parseInt\(input\.dataset\.price\) \|\| 0/);

// The selected colour card comes before the options, in markup and in the slot.
assert.ok(html.indexOf('id="stoneColourPreview"') < html.indexOf('id="stoneColourOptions"'), "preview before options in markup");
const place = html.slice(html.indexOf("function placeStoneColourControls"), html.indexOf("function revealColourSwatch"));
assert.ok(place.indexOf("slot.appendChild(preview)") !== -1, "the preview moves into the phone slot");
assert.ok(place.indexOf("slot.appendChild(preview)") < place.indexOf("slot.appendChild(options)"), "preview is placed before the options");

// The PR 302 150px gap is gone on phones; 768px keeps its rule.
const slot = rule(phone, /\.phone-colour-slot/);
assert.ok(slot, "the phone block resets the filled slot");
assert.match(slot, /min-height:\s*0;/);
assert.match(slot, /padding-bottom:\s*0\.5rem/);
// Before it is filled, the hidden slot reserves the grid's height (no CLS).
const pending = rule(phone, /#phoneColourSlot\[hidden\]/);
assert.ok(pending, "the phone block reserves the hidden slot");
assert.match(pending, /min-height:\s*770px/);
assert.doesNotMatch(pending, /min-height:\s*0/);
const narrow = mediaBlocks(html, "@media (max-width: 374px)").map((b) => rule(b, /#phoneColourSlot\[hidden\]/)).find(Boolean);
assert.ok(narrow, "a 374px block reserves the hidden slot on narrow phones");
assert.match(narrow, /min-height:\s*927px/);
assert.ok(html.indexOf("@media (max-width: 374px) {\n            #phoneColourSlot") > html.indexOf("Option 1A"), "the narrow reservation comes after the phone rule");
assert.doesNotMatch(phone, /19rem/);
assert.doesNotMatch(phone, /150px/);
assert.ok(html.indexOf("Option 1A") > html.indexOf("min-height: 19rem; padding-bottom: calc(150px"), "the phone reset comes after the 768px rule it overrides");
// The page bottom still clears the 69px phone bar.
assert.match(html, /body \{ padding-bottom: calc\(72px \+ env\(safe-area-inset-bottom\)\); \}/);

// --- 2C: back link, title and price on one row ---
assert.match(phone, /body\.memorial-page \.breadcrumb > \* \{ display: none; \}/);
assert.match(rule(phone, /body\.memorial-page \.breadcrumb > a:nth-last-child\(3\)/) || "", /display:\s*inline-flex/);
assert.match(rule(phone, /body\.memorial-page \.breadcrumb > a:nth-last-child\(3\)::before/) || "", /content:\s*'\\2039'/);
assert.match(slugFn, /<a href="\/">Home<\/a><span>\/<\/span><a href="\/memorials">Memorials<\/a><span>\/<\/span>\$\{typeLink\}<span>/,
  "server crumbs keep the parent link third from last");
assert.match(html, /\(catSlug \? '<a href="\/memorials\?type=' \+ encodeURIComponent\(catSlug\) \+ '">' \+ esc\(catName\) \+ '<\/a><span>\/<\/span>' : ''\)/,
  "client crumbs keep the parent link third from last");
assert.match(html, /<script type="application\/ld\+json" id="breadcrumbJsonLd">/, "breadcrumb JSON-LD stays");
assert.match(rule(phone, /\.product-container/) || "", /flex-flow:\s*row wrap/);
assert.match(rule(phone, /#productName/) || "", /flex:\s*1 1 auto/);
assert.match(rule(phone, /#productTitlePrice/) || "", /white-space:\s*nowrap/);

// --- 3A: four PR 307 icons on the guarantees ---
const iconPaths = {};
for (const name of ["shield", "spanner", "clipboard", "clock"]) {
  const m = globals.match(new RegExp(name + ":\\s*'([^']+)'"));
  assert.ok(m, `site-globals.js has the ${name} icon`);
  iconPaths[name] = m[1].replace(/"/g, "'").replace(/</g, "%3C").replace(/>/g, "%3E");
}
const icons = [...phone.matchAll(/--sm-guarantee-icon:\s*url\("data:image\/svg\+xml,([^"]+)"\)/g)].map((m) => m[1]);
assert.equal(icons.length, 4, "four guarantee icons");
const iconFor = (selector) => {
  const m = phone.match(new RegExp(selector.source + '\\s*\\{[^}]*--sm-guarantee-icon:\\s*url\\("data:image\\/svg\\+xml,([^"]+)"\\)'));
  return m ? m[1] : "";
};
assert.ok(iconFor(/\.product-guarantees li:nth-child\(1\)/).includes(iconPaths.shield), "shield on structural fixing");
assert.ok(iconFor(/\.product-guarantees li:nth-child\(2\)/).includes(iconPaths.spanner), "spanner on workmanship");
assert.ok(iconFor(/\.product-guarantees li:nth-child\(3\)/).includes(iconPaths.clipboard), "clipboard on ground settlement");
assert.ok(iconFor(/\.product-guarantees > p/).includes(iconPaths.clock), "clock on the terms line");
for (const svg of icons) {
  assert.match(svg, /viewBox='0 0 24 24'/);
  assert.match(svg, /stroke-width='1\.7'/);
  assert.match(svg, /stroke-linecap='round'/);
}
assert.match(phone, /width: 20px;\s*height: 20px;/, "20px icons");
assert.match(phone, /background-color: var\(--sm-color-text-accent\)/, "bronze icons from a token");
assert.match(html, /<li><strong>Structural fixing – 30 years\.<\/strong><\/li>\s*<li><strong>Workmanship – 10 years\.<\/strong><\/li>\s*<li><strong>Ground settlement – 2 years\.<\/strong><\/li>/);
assert.match(html, /<p><a href="\/terms">See our terms for full guarantee details\.<\/a><\/p>/);

// --- 4A: bolder bar price ---
const amount = rule(phone, /#mobileBarAmount/) || "";
const size = amount.match(/font-size:\s*([\d.]+)(px|rem)/);
assert.ok(size, "#mobileBarAmount has a phone font size");
assert.ok(Number(size[1]) * (size[2] === "rem" ? 16 : 1) >= 20, "#mobileBarAmount is at least 20px on phones");
assert.match(amount, /font-weight:\s*700/);
assert.match(rule(phone, /#mobileBarFrom/) || "", /font-size:\s*12px/);
assert.match(rule(phone, /\.mobile-bar-vat/) || "", /font-size:\s*12px/);
assert.doesNotMatch(phone, /mobile-bar-call|\.btn\b/, "the phone block leaves the bar buttons alone");

// The Call link and Get a quote button are byte-identical to main.
const MAIN_BAR_ACTIONS =
  '        <div class="mobile-bar-actions">\n' +
  '            <a class="btn btn-secondary mobile-bar-call" href="tel:+442038352548"><span class="mobile-bar-call-label">Call</span><span class="mobile-bar-call-number"> 020 3835 2548</span></a>\n' +
  '            <button type="button" class="btn btn-primary" onclick="openQuoteModal()">Get a quote</button>\n' +
  '        </div>\n';
assert.ok(html.includes(MAIN_BAR_ACTIONS), "Call link and Get a quote markup unchanged");

console.log("product-mobile-1a2c3a4a: ok");
