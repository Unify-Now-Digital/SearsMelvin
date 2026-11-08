// Design-system guards. S1: public pages load tokens.css and no raw colour.
// They do not load components.css. /styleguide is noindex and has no Tag Manager.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { checkTokens, findRawColours, foreignComponentClasses } from "../scripts/check-tokens.mjs";

const read = (path) => readFileSync(path, "utf8");

assert.deepEqual(findRawColours("color: var(--sm-color-text);"), []);
assert.ok(findRawColours("color: #302C27; background: rgb(48 44 39 / 0.1);").length >= 2);
assert.deepEqual(foreignComponentClasses(".sm-btn { } .sg-frame { }"), ["sg-frame"]);

const result = checkTokens();
assert.deepEqual(result.problems, [], result.problems.join("\n"));
assert.equal(result.ok, true);
// Phase 2 required leftover hex (legacyUnique > 0). S1 removes it.
// Zero is stricter. The link rule below is the only rule that flipped.
assert.equal(result.legacyUnique, 0, "S1 leaves no raw colour outside tokens.css");
assert.equal(result.legacyHits, 0);
console.log(`check-tokens OK (legacy: ${result.legacyUnique} unique / ${result.legacyHits} hits in ${result.legacyFiles} files)`);

const guide = read("styleguide.html");
const components = read("components.css");
const guideCss = read("styleguide.css");
const tokens = read("tokens.css");

assert.match(guide, /<meta name="robots" content="noindex,\s*nofollow">/);
assert.doesNotMatch(guide, /googletagmanager|google-analytics|GTM-|gtag\s*\(|dataLayer/);
assert.doesNotMatch(guide, /<form[\s>]/i);
assert.doesNotMatch(guide, /concept/i);
assert.doesNotMatch(`${components}\n${guideCss}\n${guide}`, /arched|frame--arch|archway/i);
assert.match(guide, /10am to 3pm \(days TBC\)/);
assert.match(guide, /Showroom phone/);
assert.match(guide, /\/images\/brand\/logo\/sears-melvin-stacked-ink\.svg/);
assert.match(guide, /\/images\/brand\/logo\/sears-melvin-stacked-bronze\.svg/);
assert.match(guide, /\/images\/brand\/logo\/sears-melvin-stacked-soft-bronze\.svg/);
assert.match(guide, /\/images\/brand\/logo\/sears-melvin-stacked-ink-no-rules\.svg/);
assert.match(guide, /Use with rules/);
assert.match(guide, /Fallback: no rules \(small sizes only\)/);
assert.match(guide, /below 262px at 1×/);
assert.match(guide, /below 131px at 2×/);
assert.doesNotMatch(guide, /no side rules|Rules are not approved|Do not add side rules/);
assert.doesNotMatch(guide, /previous stacked files|not the weight-500 master|were not in the upload/);
assert.match(guide, /\/images\/brand\/logo\/favicon\/favicon-light\.svg/);
assert.match(guide, /\/images\/brand\/logo\/favicon\/favicon-dark\.svg/);
assert.match(guide, /\/images\/brand\/logo\/favicon\/apple-touch-icon\.png/);
assert.match(guide, /\/images\/brand\/logo\/favicon\/icon-192\.png/);
assert.match(guide, /\/images\/brand\/logo\/favicon\/icon-512\.png/);
assert.match(guide, /\/images\/brand\/logo\/favicon\/site\.webmanifest/);
const guideHead = guide.slice(0, guide.indexOf("</head>"));
assert.match(guideHead, /<link rel="icon" href="\/favicon\.svg">/);
assert.doesNotMatch(guideHead, /images\/brand\/logo\/favicon|apple-touch-icon|rel="manifest"/);
assert.match(guide, /\/images\/brand\/photo-standard\.png/);
assert.match(guide, /4:5 frame on linen/);
assert.doesNotMatch(guide, /existing sales line/);
assert.doesNotMatch(guide, /120px/);
assert.doesNotMatch(guide, /sm-wordmark/);
assert.match(guide, /Do not use a horizontal layout/);
assert.doesNotMatch(guide, /sm-logo--horizontal|sears-melvin-horizontal/);
assert.doesNotMatch(guide, /Pending Arin|DRAFT, pending Arin/);
assert.match(tokens, /10am to 3pm \(days TBC\)/);
assert.match(tokens, /--sm-logo-min-stacked:\s*240px/);
assert.doesNotMatch(tokens, /logo-min-horizontal/);
assert.match(read("BRAND.md"), /10am to 3pm \(days TBC\)/);
assert.match(read("BRAND.md"), /Do not use a horizontal layout/);
assert.match(read("BRAND.md"), /4:5 frame on linen/);
assert.match(read("BRAND.md"), /Cormorant Garamond 500/);
assert.match(read("BRAND.md"), /262px wide on a 1× screen/);
assert.match(read("BRAND.md"), /131px wide on a 2× screen/);
assert.doesNotMatch(read("BRAND.md"), /no side rules|Rules are not approved|Do not add side rules/);
assert.doesNotMatch(read("BRAND.md"), /Pending Arin|DRAFT, pending Arin/);
assert.match(guide, /href="\/tokens\.css"/);
assert.match(guide, /href="\/components\.css"/);
assert.match(guide, /href="\/styleguide\.css"/);
assert.match(guide, /shortlist-btn-copy/);
assert.match(guide, /shortlist-btn-email/);
assert.match(guide, /class="save-btn sm-save"/);
assert.match(guide, /020 3835 2548/);
assert.doesNotMatch(guide, /\+44 20 3835 2548/);

const saveRule = components.match(/\.sm-save\s*\{[^}]+\}/);
assert.ok(saveRule, "sm-save rule missing");
assert.match(saveRule[0], /--sm-radius-sm/);
assert.doesNotMatch(saveRule[0], /radius-round|radius-pill|50%|999px/);

for (const file of readdirSync(".").filter((name) => name.endsWith(".html") && name !== "styleguide.html")) {
  const html = read(file);
  assert.match(html, /href="\/tokens\.css"/, `${file} must load tokens.css`);
  assert.equal(html.includes("components.css"), false, `${file} must not link components.css yet`);
  assert.equal(html.includes("styleguide.css"), false, `${file} must not link styleguide.css yet`);
  assert.doesNotMatch(html, /sears-melvin-stacked-(?:bronze|soft-bronze)|source-exact/, `${file} must not use a bronze or archive logo`);
  if (html.includes('id="navbar"')) {
    assert.match(html, /\/images\/brand\/logo\/sears-melvin-stacked-ink(?:-no-rules)?\.svg/, `${file} must use the stacked ink header logo`);
  }
  assert.match(html, /href="\/favicon\.svg|href="\/images\/brand\/logo\/favicon\//, `${file} must keep a favicon`);
}

const sitemap = read("functions/sitemap.xml.js");
assert.doesNotMatch(sitemap, /["']\/styleguide["']/);
assert.match(read("robots.txt"), /Disallow:\s*\/styleguide\b/);
assert.match(read("_headers"), /\/styleguide[\s\S]*X-Robots-Tag:\s*noindex/);

function channel(hex) {
  const value = parseInt(hex, 16) / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}
function luminance(hex) {
  const h = hex.slice(1);
  const r = channel(h.slice(0, 2));
  const g = channel(h.slice(2, 4));
  const b = channel(h.slice(4, 6));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function ratio(a, b) {
  const left = luminance(a);
  const right = luminance(b);
  const [hi, lo] = left > right ? [left, right] : [right, left];
  return (hi + 0.05) / (lo + 0.05);
}
function token(name) {
  const match = tokens.match(new RegExp(`${name}:\\s*(#[0-9A-Fa-f]{6})`));
  assert.ok(match, `missing ${name}`);
  return match[1].toUpperCase();
}

const ink = token("--sm-ref-ink");
const linen = token("--sm-ref-linen");
const bronze = token("--sm-ref-bronze");
const sand = token("--sm-ref-sand");
const soft = token("--sm-ref-soft-bronze");
const white = token("--sm-ref-white");
const dark = token("--sm-ref-bronze-800");
const muted = token("--sm-ref-ink-muted");
const inverse = token("--sm-ref-ink-inverse-muted");
const error = token("--sm-ref-error");
const success = token("--sm-ref-success");
const warning = token("--sm-ref-warning");
const warningSurface = token("--sm-ref-warning-surface");
const successSurface = token("--sm-ref-success-surface");
const errorSurface = token("--sm-ref-error-surface");

const textPairs = [
  [ink, linen, 13.18],
  [ink, white, 13.86],
  [ink, sand, 9.21],
  [linen, ink, 13.18],
  [bronze, linen, 5.33],
  [bronze, white, 5.61],
  [dark, sand, 5.66],
  [dark, linen, 8.09],
  [soft, ink, 5.13],
  [ink, soft, 5.13],
  [linen, bronze, 5.33],
  [muted, linen, 6.99],
  [muted, sand, 4.88],
  [inverse, ink, 8.2],
  [error, linen, 6.45],
  [error, white, 6.78],
  [success, linen, 5.62],
  [success, white, 5.91],
  [warning, linen, 7.32],
  [warning, white, 7.7],
  [warning, sand, 5.12],
  [warning, warningSurface, 6.68],
  [success, successSurface, 5.15],
  [error, errorSurface, 5.7],
];
for (const [fg, bg, expected] of textPairs) {
  const got = ratio(fg, bg);
  assert.ok(Math.abs(got - expected) < 0.06, `${fg} on ${bg}: ${got.toFixed(2)} expected ${expected}`);
  assert.ok(got >= 4.5, `${fg} on ${bg} is below AA text (${got.toFixed(2)})`);
}

const fails = [
  [bronze, ink, 2.47],
  [soft, linen, 2.57],
  [bronze, sand, 3.72],
  [linen, soft, 2.57],
  [sand, linen, 1.43],
];
for (const [fg, bg, expected] of fails) {
  const got = ratio(fg, bg);
  assert.ok(Math.abs(got - expected) < 0.06, `${fg} on ${bg}: ${got.toFixed(2)} expected ${expected}`);
  assert.ok(got < 4.5, `${fg} on ${bg} should stay below AA text so it is not used for small type`);
}
assert.ok(ratio(bronze, sand) >= 3, "bronze on sand must still pass as a non-text focus ring");

console.log("design-tokens: contrast pairs pass AA rules");
