// Mobile-only permanent stone colour strip on /memorials (<=767px). Desktop
// and tablet (>=768px) keep main's #stoneBand inside #productsGrid untouched.
// The strip's lead box is a plain element (not a button) — it does not open
// anything; aria-live spans announce the selected colour's name and price.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { premiumColourSurcharge, stoneInlineMarkup, stoneInlineLeadMarkup, catalogueInjection } from "../functions/memorials.js";

const html = readFileSync(new URL("../memorials.html", import.meta.url), "utf8");
const server = readFileSync(new URL("../functions/memorials.js", import.meta.url), "utf8");

// ---- Markup ----
assert.match(html, /id="listingStoneInline"/);
assert.match(html, /id="listingStoneInlineRow"/);
assert.match(html, /id="listingStoneInlineLead"/);
assert.match(html, /id="listingStoneInlineLeadPhoto"/);
assert.match(html, /id="listingStoneInlineLeadName"/);
assert.match(html, /id="listingStoneInlineLeadPrice"/);
assert.match(html, /The From price is for a standard stone\. Premium and natural stones cost a little more\./);
assert.match(html, /function setupListingInline/);
assert.match(html, /function selectListingInlineSwatch/);
assert.match(html, /function renderListingInlineLead/);

// The strip is the first child of <main>, above the type chip toolbar.
const mainOpen = html.indexOf("<main>");
const sectionAt = html.indexOf('<section class="listing-stone-inline"');
const toolbarAt = html.indexOf('<div class="catalogue-toolbar">');
assert.ok(mainOpen > -1 && sectionAt > mainOpen && toolbarAt > sectionAt, "strip must sit first inside <main>, above the toolbar");

// Lead box is NOT a button — it must not open a panel/sheet/dock.
const leadTagMatch = html.match(/<(\w+)[^>]*id="listingStoneInlineLead"/);
assert.ok(leadTagMatch, "lead box markup not found");
assert.notEqual(leadTagMatch[1], "button");
assert.doesNotMatch(html, /listing-stone-dock|listing-stone-panel|listing-stone-sheet|listing-stone-scrim|listing-stone-zoom|openListingPanel/);
assert.match(html, /id="listingStoneInlineLeadName" aria-live="polite"/);
assert.match(html, /id="listingStoneInlineLeadPrice" aria-live="polite"/);

// Main's desktop/tablet band is untouched.
assert.match(html, /id="stoneBand"/);
assert.match(html, /Every design comes in all/);

// ---- CSS: hidden by default, phones-only media query ----
assert.match(html, /\.listing-stone-inline,\s*\n\s*\.listing-stone-inline-note \{ display: none; \}/);
const mobileCss = html.slice(html.indexOf("/* Mobile compact stone strip."), html.indexOf("</style>\n</head>"));
assert.match(mobileCss, /@media \(max-width: 767px\)/);
assert.match(mobileCss, /position:\s*sticky/);
assert.match(mobileCss, /top:\s*var\(--header-height,\s*68px\)/);
// Two rows of swatches at the #295 height (Arin t2420u), the selected
// colour's name written under its square, and no 80px lead photo tile.
assert.match(mobileCss, /height:\s*104px/);
assert.match(mobileCss, /grid-template-rows:\s*50px 50px/);
assert.match(mobileCss, /grid-auto-columns:\s*44px/);
assert.match(mobileCss, /width:\s*44px/);
assert.match(mobileCss, /height:\s*50px/);
assert.match(mobileCss, /\[aria-pressed="true"\]::after \{\s*content:\s*attr\(data-name\)/);
assert.doesNotMatch(mobileCss, /width:\s*80px/);
assert.doesNotMatch(mobileCss, /height:\s*80px/);
assert.match(mobileCss, /overscroll-behavior-x:\s*contain/);
assert.match(mobileCss, /scrollbar-width:\s*none/);
assert.match(mobileCss, /\.products-grid > \.stone-band \{ display: none; \}/);
assert.doesNotMatch(mobileCss, /chat-widget|floating-btn/);

// At >=768px the band-hiding rule must not apply — only inside the 767 query.
const before767 = html.slice(0, html.indexOf("@media (max-width: 767px)"));
assert.doesNotMatch(before767, /\.products-grid > \.stone-band \{ display: none; \}/);

// ---- Server markup ----
assert.match(server, /function stoneInlineMarkup/);
assert.match(server, /function stoneInlineLeadMarkup/);
assert.match(server, /listing-stone-inline-swatch/);
assert.match(server, /#listingStoneInlineRow/);
assert.match(server, /#listingStoneInlineLeadPhoto/);

const colours = [
  { slug: "blue-pearl", name: "Blue Pearl", hex_primary: "#123456", hex_secondary: "#654321", is_premium: true, tier: "premium" },
  { slug: "black", name: "Black", hex_primary: "#123456", hex_secondary: "#654321", is_premium: false, tier: "standard" },
];

const markup = stoneInlineMarkup(colours);
assert.match(markup, /listing-stone-inline-swatch/);
assert.match(markup, /data-slug="blue-pearl"/);
assert.match(markup, /aria-label="Blue Pearl"/);
assert.match(markup, /data-tier="premium"/);
assert.match(markup, /data-slug="blue-pearl"[^>]*aria-pressed="true"/);
assert.match(markup, /data-slug="black"[^>]*aria-pressed="false"/);

const lead = stoneInlineLeadMarkup(colours[0], "");
assert.equal(lead.name, "Blue Pearl");
assert.equal(lead.slug, "blue-pearl");
assert.equal(lead.price, "+£200");
const standardLead = stoneInlineLeadMarkup(colours[1], "");
assert.equal(standardLead.price, "Included");
assert.deepEqual(stoneInlineLeadMarkup(null, ""), { photoStyle: "", photoInner: "", name: "", price: "", slug: "" });

// Price rules: standard tier is Included; premium/natural follows category,
// with Crystal White overriding the per-category amount.
assert.equal(premiumColourSurcharge("", "bahama-blue"), 200);
assert.equal(premiumColourSurcharge("kerb-sets", "bahama-blue"), 550);
assert.equal(premiumColourSurcharge("cremation-memorials", "bahama-blue"), 90);
assert.equal(premiumColourSurcharge("", "crystal-white"), 500);
assert.equal(premiumColourSurcharge("kerb-sets", "crystal-white"), 1050);
assert.equal(premiumColourSurcharge("cremation-memorials", "crystal-white"), 90);
assert.equal(premiumColourSurcharge("lawn-headstones", "crystal-white"), 500);

// catalogueInjection wires the lead/inline markup through, keyed off the
// requested type (the single active filter), without touching the grid.
const injected = catalogueInjection([], colours, "kerb-sets");
assert.equal(injected.lead.price, "+£550");
assert.match(injected.inline, /data-slug="blue-pearl"/);
assert.match(injected.grid, /id="stoneBand"/);

// The swatch row is a plain group of buttons (no list role without items).
assert.doesNotMatch(html, /id="listingStoneInlineRow"[^>]*role="list"/);

// The From-price note sits with the cards, below the results line, so it is
// not parked under the bottom bar at 320x568.
const noteAt = html.indexOf('<p class="listing-stone-inline-note">');
assert.ok(noteAt > html.indexOf('<div class="results-header">') && noteAt < html.indexOf('<div class="products-grid" id="productsGrid">'));

// Phone card faces are held at the measured tallest card for each width band,
// and the same value is the content-visibility reserve (no grow or shrink on paint).
assert.match(mobileCss, /--sm-card-face:\s*calc\(\(100vw - 40px\) \* 5 \/ 12 \+ 114px\)/);
assert.match(mobileCss, /min-height:\s*var\(--sm-card-face\)/);
assert.match(mobileCss, /contain-intrinsic-height:\s*auto var\(--sm-card-face\)/);
for (const [band, extra] of [["375px) and (max-width: 767px", 93]]) {
  const at = html.indexOf("@media (min-width: " + band + ")");
  assert.ok(at > -1, "missing card band " + band);
  assert.match(html.slice(at, at + 200), new RegExp("--sm-card-face: calc\\(\\(100vw - 40px\\) \\* 5 / 12 \\+ " + extra + "px\\)"));
}

console.log("listing-stone-inline: ok");
