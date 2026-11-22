// Phone type-filter chips, Option A (Arin, 22 Nov): a small line icon above
// a 12px short label, plus a leading sticky "Filter" cue. Full names stay in
// the DOM as each link's accessible name; they just hide visually on phones
// in favour of the icon + short label. Desktop/tablet (>=768px) are
// unaffected — icons, short labels and the cue stay display:none there.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CATEGORIES } from "../data/categories.js";

const html = readFileSync(new URL("../memorials.html", import.meta.url), "utf8");

const browse = html.match(/<nav class="type-browse"[\s\S]*?<\/nav>/);
assert.ok(browse, "type chip row missing");
const nav = browse[0];

assert.match(nav, /aria-label="Filter by type"/);

// The leading Filter cue: non-link, icon over the word, sticky.
assert.match(nav, /<li class="type-filter-cue"[^>]*><span class="type-filter-tab">/);
assert.match(nav, /<span class="type-filter-word">Filter<\/span>/);

// 8 chips total (All + 7 categories), each with an icon, a full-name
// accessible name, a hidden full-text label kept for desktop, and a
// phones-only short label.
const FULL = {
  all: "All memorials",
  ...Object.fromEntries(CATEGORIES.map((c) => [c.slug, c.name])),
};
const SHORT = {
  all: "All",
  "lawn-headstones": "Lawn",
  "kerb-sets": "Kerb",
  "heart-memorials": "Heart",
  "book-memorials": "Book",
  "churchyard-memorials": "Churchyard",
  "cremation-memorials": "Cremation",
  "childrens-memorials": "Children",
};

const links = [...nav.matchAll(/<a\b[^>]*>[\s\S]*?<\/a>/g)].map((m) => m[0]);
assert.equal(links.length, 8, "expected All + 7 category chips");

for (const [slug, full] of Object.entries(FULL)) {
  const href = slug === "all" ? "/memorials" : `/memorials?type=${slug}`;
  const link = links.find((a) => a.includes(`href="${href}"`));
  assert.ok(link, `missing chip for ${slug}`);
  // No fixed aria-label: the accessible name comes from content (full label
  // + visible count on desktop), so it isn't stuck at "Kerb sets" when the
  // chip shows "Kerb sets 33".
  assert.doesNotMatch(link, /aria-label="/, `${slug} should not have a fixed aria-label`);
  assert.match(link, /<svg class="type-icon"[^>]*aria-hidden="true"/, `${slug} icon`);
  assert.match(link, new RegExp(`<span class="type-label-full">${full}</span>`), `${slug} full label text`);
  assert.match(link, new RegExp(`<span class="type-label-short" aria-hidden="true">${SHORT[slug]}</span>`), `${slug} short label`);
}

// Order matches CATEGORIES (the hrefs the server rewriter counts against).
assert.deepEqual(
  [...nav.matchAll(/\/memorials\?type=([a-z0-9-]+)/g)].map((m) => m[1]),
  CATEGORIES.map((c) => c.slug),
);

// ---- Desktop/tablet: icons, short labels and the cue stay invisible ----
const beforePhoneBlock = html.slice(0, html.indexOf('@media (max-width: 767px) {\n            /* Shrink'));
assert.match(
  beforePhoneBlock,
  /\.type-browse-list a \.type-icon,\s*\n\s*\.type-browse-list a \.type-label-short,\s*\n\s*\.type-filter-cue \{ display: none; \}/,
);

// ---- Phones: Option A sizing ----
const phoneBlock = html.slice(html.indexOf('@media (max-width: 767px) {\n            /* Shrink'));
const optionA = phoneBlock.slice(phoneBlock.indexOf("Option A"), phoneBlock.indexOf("/* The permanent stone strip"));
assert.match(optionA, /\.catalogue-toolbar,\s*\n\s*\.type-browse,\s*\n\s*\.type-browse-list \{ height: 56px; min-height: 56px; max-height: 56px; \}/);
assert.match(optionA, /\.type-browse::after \{ height: 56px; \}/);
assert.match(
  optionA,
  /\.type-browse-list \{ gap: 0\.3rem; align-items: center; scroll-padding-inline: 72px 2\.5rem; \}/,
);
assert.match(optionA, /min-width:\s*52px/);
assert.match(optionA, /border-radius:\s*8px/);
assert.match(optionA, /gap:\s*2px/);
assert.match(optionA, /min-height:\s*44px/);
assert.match(optionA, /width:\s*48px/);
assert.match(optionA, /\.type-filter-tab \{/);

// The sticky Filter cue covers roughly x 0-64 on phones; a chip scrolled in
// from the left must clear it. .type-label-full is sr-only clipped (not
// display:none) so it stays in the accessible-name text while invisible,
// and the row's own scroll-padding-inline-start also clears the cue for
// focus scrolling.
assert.match(
  optionA,
  /\.type-browse-list a \.type-label-full \{\s*position: absolute;\s*width: 1px;\s*height: 1px;\s*padding: 0;\s*margin: -1px;\s*overflow: hidden;\s*clip: rect\(0, 0, 0, 0\);\s*clip-path: inset\(50%\);\s*white-space: nowrap;\s*border: 0;\s*\}/,
);
assert.doesNotMatch(optionA, /\.type-browse-list a \.type-label-full[^{]*\{[^}]*display:\s*none/);
assert.match(optionA, /\.type-browse-list a \.type-count \{ display: none; \}/);

// ---- Intro copy (Arin t2441u): drop "Greater" from the phone line ----
assert.match(html, /<p class="page-header-phone-line">Made to your specification for London families\.<\/p>/);
assert.doesNotMatch(html, /specification for Greater London families/);

// ---- Header logo link: >=44px tap area on phones, no visual change ----
const upgrades = readFileSync(new URL("../site-upgrades.css", import.meta.url), "utf8");
assert.match(upgrades, /html body #navbar \.logo \{\s*min-height: 44px;\s*\}/);

// ---- FIX: a chip scrolled in from the left must clear the sticky Filter
// cue (it covers ~x 0-64 on phones). markTypeLinks measures the cue's own
// width for the left inset instead of a fixed 16px, so it tracks the cue's
// real rendered width rather than assuming it.
const markTypeLinksFn = html.slice(
  html.indexOf("function markTypeLinks()"),
  html.indexOf("function onTypeChipClick"),
);
assert.match(
  markTypeLinksFn,
  /const cue = list\.querySelector\('\.type-filter-cue'\);/,
  "markTypeLinks must measure the Filter cue",
);
assert.match(
  markTypeLinksFn,
  /cue\.getBoundingClientRect\(\)\.width/,
  "markTypeLinks must read the cue's rendered width",
);
assert.match(
  markTypeLinksFn,
  /left - padL < list\.scrollLeft/,
  "the measured cue width must drive the left-branch inset",
);

console.log("type-chips-option-a: ok");
