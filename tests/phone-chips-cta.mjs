// Phone type chips must be a real scroller, and the two buttons that sat
// under the bottom nav must have room. These read the source the browser
// applies. They fail if the row grows with its chips again, or if the
// brochure and contact tightenings are removed.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (name) => readFileSync(new URL(`../${name}`, import.meta.url), "utf8");
const memorials = read("memorials.html");
const globals = read("site-globals.js");
const upgrades = read("site-upgrades.css");

const phoneChips = memorials.slice(memorials.indexOf(".catalogue-container > main { min-width: 0"));
const chipRule = phoneChips.slice(phoneChips.indexOf(".type-browse-list {"), phoneChips.indexOf(".type-browse-list::-webkit-scrollbar"));
assert.match(chipRule, /max-width:\s*100%/);
assert.match(chipRule, /min-width:\s*0/);
assert.match(chipRule, /overflow-x:\s*auto/);
assert.match(chipRule, /-webkit-overflow-scrolling:\s*touch/);
assert.match(memorials, /\.catalogue-container > main \{ min-width: 0; max-width: 100%; \}/);
assert.match(memorials, /\.type-browse\.is-scrolled-end::after \{ opacity: 0; \}/);

assert.match(globals, /nav:not\(\.mobile-bottom-nav\):not\(\.type-browse\)/);
assert.match(globals, /is-scrolled-end/);
assert.match(globals, /syncTypeChips/);

assert.match(upgrades, /html\[data-sm-cookie="open"\] body:has\(#brochureRequest\) main\.content/);
assert.match(upgrades, /html\[data-sm-cookie="open"\] body:has\(#brochureRequest\) #brochureRequest/);
assert.match(upgrades, /html body textarea#message/);
assert.match(upgrades, /min-height:\s*4\.5rem/);
assert.match(upgrades, /\.contact-form-wrapper \.form-row/);

console.log("phone-chips-cta: ok");
