// Desktop (≥768px) Colour pill + popover on /memorials. Hidden on phones.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { desktopColourGridMarkup, premiumColourSurcharge, catalogueInjection } from "../functions/memorials.js";

const html = readFileSync(new URL("../memorials.html", import.meta.url), "utf8");
const server = readFileSync(new URL("../functions/memorials.js", import.meta.url), "utf8");

assert.match(html, /id="desktopColour"/);
assert.match(html, /id="desktopColourBtn"/);
assert.match(html, /id="desktopColourPopover"/);
assert.match(html, /id="desktopColourGrid"/);
assert.match(html, /id="desktopColourClear"/);
assert.match(html, /aria-expanded="false"/);
assert.match(html, /aria-controls="desktopColourPopover"/);
assert.match(html, /aria-haspopup="dialog"/);
assert.match(html, /role="dialog"/);
assert.match(html, /id="desktopColourPopoverTitle"/);
assert.match(html, /The From price is for a standard stone\. Premium and natural stones cost a little more\./);

assert.match(html, /function selectListingColour/);
assert.match(html, /function setupDesktopColour/);
assert.match(html, /function openDesktopColourPopover/);
assert.match(html, /function closeDesktopColourPopover/);
assert.match(html, /function onDesktopColourKeydown/);
assert.match(html, /function positionDesktopColourPopover/);
assert.match(html, /event\.key === 'Escape'/);
assert.match(html, /pointerdown/);
assert.match(html, /aria-expanded/);

// Pill is in the toolbar, before the sort button.
const toolbarAt = html.indexOf('<div class="catalogue-toolbar">');
const colourAt = html.indexOf('id="desktopColour"');
const sortAt = html.indexOf('id="priceSort"');
assert.ok(toolbarAt > -1 && colourAt > toolbarAt && sortAt > colourAt, "Colour pill must sit in the toolbar before sort");

// Default-hidden on phones; shown and sticky only at ≥768.
const cssStart = html.indexOf("/* Desktop colour pill (option B).");
assert.ok(cssStart > -1);
const cssEnd = html.indexOf("/* Mobile compact stone strip.");
const css = html.slice(cssStart, cssEnd);
assert.match(css, /\.desktop-colour \{ display: none; \}/);
assert.match(css, /@media \(min-width: 768px\)/);
assert.match(css, /position:\s*sticky/);
assert.match(css, /top:\s*calc\(var\(--header-height,\s*80px\) \+ var\(--sm-cookie-stack,\s*0px\)\)/);
assert.match(css, /\.products-grid > \.stone-band \{ display: none; \}/);
assert.match(css, /min-width:\s*44px/);
assert.match(css, /width:\s*44px/);
assert.match(css, /height:\s*44px/);
assert.match(css, /grid-template-columns: repeat\(6,/);
assert.match(css, /@media \(min-width: 1024px\)[\s\S]*repeat\(3, 1fr\)/);
assert.match(css, /@media \(min-width: 1280px\)[\s\S]*repeat\(4, 1fr\)/);
assert.match(css, /@media \(min-width: 1680px\)[\s\S]*repeat\(5, 1fr\)/);
assert.match(css, /max-width:\s*1760px/);

// Phone layout rules live in the 767 block, not in the desktop colour CSS.
assert.doesNotMatch(css, /@media \(max-width: 767px\)/);
assert.doesNotMatch(css, /listing-stone-inline/);
assert.doesNotMatch(css, /--sm-card-face/);
assert.doesNotMatch(css, /chat-widget/);
assert.doesNotMatch(css, /gtm|googletagmanager|url_passthrough|ads_data_redaction/i);

const desktopJsStart = html.indexOf("// ==================== DESKTOP COLOUR PILL");
assert.ok(desktopJsStart > -1);
const desktopJs = html.slice(desktopJsStart, html.indexOf("// ==================== RENDER PRODUCTS"));
assert.doesNotMatch(desktopJs, /gtm|googletagmanager|url_passthrough|dataLayer|gclid/i);
assert.doesNotMatch(desktopJs, /chat-widget|site-upgrades/);
assert.match(desktopJs, /selectListingColour/);
assert.match(desktopJs, /listingInlinePriceLabel/);
assert.match(desktopJs, /listingInlineSelectedSlug/);

// Shared price rules stay as on #295.
assert.equal(premiumColourSurcharge("", "bahama-blue"), 200);
assert.equal(premiumColourSurcharge("kerb-sets", "bahama-blue"), 550);
assert.equal(premiumColourSurcharge("cremation-memorials", "bahama-blue"), 90);
assert.equal(premiumColourSurcharge("", "crystal-white"), 500);
assert.equal(premiumColourSurcharge("kerb-sets", "crystal-white"), 1050);
assert.equal(premiumColourSurcharge("cremation-memorials", "crystal-white"), 90);

const colours = [
  { slug: "blue-pearl", name: "Blue Pearl", hex_primary: "#123456", hex_secondary: "#654321", is_premium: true, tier: "premium" },
  { slug: "black", name: "Black", hex_primary: "#123456", hex_secondary: "#654321", is_premium: false, tier: "standard" },
];
const markup = desktopColourGridMarkup(colours);
assert.match(markup, /desktop-colour-swatch/);
assert.match(markup, /data-slug="blue-pearl"/);
assert.match(markup, /aria-label="Blue Pearl"/);
assert.match(markup, /aria-pressed="false"/);
assert.doesNotMatch(markup, /aria-pressed="true"/);
assert.match(markup, /desktop-colour-swatch-name/);

const injected = catalogueInjection([], colours, "");
assert.match(injected.desktop, /data-slug="blue-pearl"/);
assert.equal(injected.colourCount, 2);
assert.match(injected.grid, /id="stoneBand"/);
assert.match(server, /#desktopColourGrid/);
assert.match(server, /\(max-width: 1679px\) 25vw, 20vw/);

console.log("desktop-colour-pill: ok");
