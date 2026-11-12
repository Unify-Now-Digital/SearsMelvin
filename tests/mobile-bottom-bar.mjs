// Memorial phone bar, option B. Price is the page-load guide total.
// The call link keeps its tracking classes and the showroom number.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readFileSync("memorial.html", "utf8");
const css = readFileSync("site-upgrades.css", "utf8");

const bars = html.match(/<div class="mobile-bottom-bar">[\s\S]*?<\/div>\s*<\/div>/g) || [];
assert.equal(bars.length, 1, "one phone bar, not a second bar");
const bar = bars[0];

assert.match(bar, /id="mobileBarPrice" hidden/, "price starts hidden when there is no guide total");
assert.match(bar, /class="mobile-bar-from">From <span id="mobileBarAmount"><\/span>/, "the word From stays, and the amount is filled in later");
assert.match(bar, /class="mobile-bar-vat">Inc\. VAT</, "Inc. VAT sits under the price");
assert.doesNotMatch(bar, /£\d/, "the bar does not hard-code a price");

const call = bar.match(/<a class="btn btn-secondary mobile-bar-call" href="tel:\+442038352548">([\s\S]*?)<\/a>/);
assert.ok(call, "call control keeps btn, btn-secondary, mobile-bar-call, and the tel link");
const callText = call[1].replace(/<[^>]+>/g, "");
assert.match(callText, /Call/, "the call control says Call");
assert.ok(callText.includes("020 3835 2548"), "the showroom number stays in the tel link");
assert.match(call[1], /<span class="mobile-bar-call-number">\s*020 3835 2548<\/span>/, "the number is one text node");

const quoteAt = bar.indexOf('onclick="openQuoteModal()">Get a quote</button>');
assert.ok(quoteAt > bar.indexOf("mobile-bar-call"), "Get a quote follows Call and still opens the quote form");
assert.match(bar, /<button type="button" class="btn btn-primary" onclick="openQuoteModal\(\)">Get a quote<\/button>/);

const priceFn = html.slice(html.indexOf("function updateTotalPrice"), html.indexOf("function paintMobileGuidePrice"));
assert.doesNotMatch(priceFn, /mobileBarAmount|mobileBarPrice|mobilePriceTotal/, "option changes do not rewrite the phone-bar price");
const paint = html.slice(html.indexOf("function paintMobileGuidePrice"), html.indexOf("function paintMobileGuidePrice") + 700);
assert.match(paint, /amount\.textContent = formatGbp\(total\)/, "the bar uses the same formatter as the desktop summary");
assert.match(paint, /!\(total > 0\)/, "a missing guide total leaves the price hidden");
const load = html.slice(html.indexOf("updateAddonsTotal();"), html.indexOf("updateAddonsTotal();") + 180);
assert.match(load, /updateTotalPrice\(\);\s*paintMobileGuidePrice\(\);/, "the bar is painted once, after the first guide total");
assert.equal(html.split("paintMobileGuidePrice()").length, 3, "paint runs from load only, plus its definition");

const sync = html.slice(html.indexOf("function syncMobileQuoteBar"), html.indexOf("function setupMobileQuoteBar"));
assert.match(sync, /cookieConsent/, "the bar stays hidden while the cookie card shows");
assert.match(sync, /mobileQuoteCtaEligible && !modalOpen && !cookieVisible/, "show/hide logic is unchanged");
assert.match(html, /getElementById\('quoteIntro'\)/, "the bar still waits for the intro quote button to scroll away");

assert.match(html, /@media \(max-width: 768px\)[\s\S]*\.mobile-bottom-bar\.is-visible \{ display: flex; \}/);
assert.doesNotMatch(html, /@media \(min-width: 769px\)[\s\S]{0,400}\.mobile-bottom-bar\.is-visible/);
assert.match(css, /@media \(max-width: 768px\) \{[\s\S]*html body \.mobile-bottom-bar \{[\s\S]*background: var\(--sm-color-bg\);[\s\S]*border-top: 1px solid var\(--sm-color-border-decorative\);/);
assert.match(css, /html body \.mobile-bottom-bar \.mobile-bar-call \{[\s\S]*width: var\(--sm-control-height\);[\s\S]*height: var\(--sm-control-height\);/);
assert.doesNotMatch(css.slice(css.lastIndexOf("Memorial phone bar")), /#[0-9a-fA-F]{3,8}\b/, "the bar uses tokens, not a raw colour");

console.log("mobile-bottom-bar: ok");
