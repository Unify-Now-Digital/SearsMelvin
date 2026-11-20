// 20 Nov device review, must-fix. These assertions read the source the
// browser actually applies. They fail if a later edit puts the hero photo,
// the permit line, the area quote button, sand links, or the sort control back.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (name) => readFileSync(new URL(`../${name}`, import.meta.url), "utf8");
const index = read("index.html");
const upgrades = read("site-upgrades.css");
const areas = read("functions/_area-pages.js");
const memorial = read("memorial.html");
const memorials = read("memorials.html");

function rule(css, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(`(?:^|\\n)\\s*${escaped}\\s*\\{[^}]*\\}`));
  assert.ok(match, `missing rule ${selector}`);
  return match[0];
}

const hero = rule(index, ".hero");
assert.match(hero, /overflow:\s*visible/);
assert.doesNotMatch(hero, /overflow:\s*hidden/);

const visual = rule(index, ".hero-visual");
assert.match(visual, /width:\s*100%/);
assert.match(visual, /min-width:\s*12rem/);
assert.match(visual, /min-height:\s*12rem/);

const note = rule(upgrades, ".hero-guide-price-note");
assert.match(note, /position:\s*static/);
assert.match(note, /display:\s*block/);
assert.doesNotMatch(note, /position:\s*absolute/);
assert.doesNotMatch(note, /bottom:\s*-/);
assert.match(index, /Cemetery permit fees are extra and vary by cemetery/);
assert.doesNotMatch(index, /hero-guide-price-note[^}]*display:\s*none/);

const quote = rule(areas, ".area-band a.area-band-quote");
assert.match(quote, /color:\s*var\(--sm-color-text\)/);
assert.match(quote, /background:\s*var\(--sm-color-bg\)/);
assert.doesNotMatch(quote, /text-inverse/);

const mapLink = rule(areas, ".area-card .area-links a");
assert.match(mapLink, /color:\s*var\(--sm-color-link-on-panel\)/);
assert.match(areas, /\.area-details a\s*\{[^}]*color:\s*var\(--sm-color-link-on-panel\)/);

const related = rule(memorial, "nav.related-designs a");
assert.match(related, /color:\s*var\(--sm-color-link-on-panel\)/);
assert.doesNotMatch(related, /color:\s*var\(--sm-color-link\)/);

const sort = rule(memorials, ".sort-dropdown select");
assert.match(sort, /font-size:\s*var\(--sm-text-md\)/);
assert.match(sort, /border:\s*1px solid var\(--sm-color-border-control\)/);
assert.doesNotMatch(sort, /font-size:\s*0\.8rem/);
assert.doesNotMatch(sort, /var\(--color-border\)/);
assert.match(memorials, /\.sort-dropdown select\s*\{[^}]*font-size:\s*var\(--sm-text-md\)/);
assert.doesNotMatch(memorials, /sort-dropdown select[^}]*font-size:\s*0\.8rem/);

const locked = rule(upgrades, "html body #sortSelect");
assert.match(locked, /font-size:\s*var\(--sm-text-md\)/);
assert.match(locked, /border:\s*1px solid var\(--sm-color-border-control\)/);

console.log("device-review-must-fix: ok");
