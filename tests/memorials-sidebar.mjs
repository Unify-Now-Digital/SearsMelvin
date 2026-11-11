// Catalogue filter sidebar. Pins the Bronze & Linen fixes on /memorials:
// photo swatches, ink controls, 2px corners, sentence-case clear, square heart.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../memorials.html", import.meta.url), "utf8");
const upgrades = readFileSync(new URL("../site-upgrades.css", import.meta.url), "utf8");

assert.match(html, /class="filters-clear"[^>]*>Clear all</);
assert.doesNotMatch(html, />Clear All</);

const filterBtn = html.match(/\.mobile-filter-btn \{[^}]+\}/g) || [];
assert.ok(filterBtn.length >= 1, "mobile filter button rule missing");
assert.match(filterBtn[0], /color:\s*var\(--sm-color-text\)/);
assert.match(filterBtn[0], /border:\s*1px solid var\(--sm-color-border-control\)/);
assert.match(filterBtn[0], /border-radius:\s*var\(--sm-radius-sm\)/);
assert.doesNotMatch(html, /border-radius:\s*999px/);
assert.doesNotMatch(html, /\.mobile-filter-btn \{[^}]*border-radius:\s*4px/);

assert.match(html, /\.filter-tag \{[^}]*border-radius:\s*var\(--sm-radius-sm\)/);
assert.match(html, /\.active-filters \{[^}]*border-radius:\s*var\(--sm-radius-sm\)/);
assert.doesNotMatch(html, /\.filter-tag \{[^}]*border-radius:\s*20px/);
assert.doesNotMatch(html, /\.active-filters \{[^}]*border-radius:\s*6px/);

assert.match(html, /\.search-modal \.search-input \{[^}]*color:\s*var\(--sm-color-text\)/);
assert.match(upgrades, /html body \.search-modal \.search-input,\s*html body #searchInput \{[^}]*color:\s*var\(--sm-color-text\)/);

assert.match(html, /\.floating-btn\.shortlist \{[^}]*border-radius:\s*var\(--sm-radius-sm\)/);
assert.match(html, /\.floating-btn\.shortlist \{[^}]*border:\s*1px solid var\(--sm-color-border-control\)/);
assert.doesNotMatch(html, /\.floating-btn\.shortlist \{[^}]*border-radius:\s*50%/);

assert.match(html, /\.swatch \{[^}]*width:\s*52px;\s*height:\s*52px;\s*border-radius:\s*50%/);
assert.match(html, /input:checked \+ \.swatch-wrapper \.swatch \{[^}]*0 0 0 3px var\(--sm-color-bg-surface\), 0 0 0 6px var\(--color-accent\)/);
assert.match(html, /input:checked \+ \.swatch-wrapper \.swatch \{[^}]*scale\(1\.1\)/);
assert.match(html, /\.swatch \{ width: 44px; height: 44px; \}/);

console.log("memorials-sidebar: ok");
