// CI lint for the Bronze & Linen book.
// Fails when:
// - a colour named in BRAND.md does not match its token in tokens.css
// - site-upgrades.css, components.css, or styleguide.css gains a hex
//   that is not one of those book colours or a stone/mark token
// - a page gains a static style="" attribute that is not already
//   allowlisted and is not a dynamic swatch
// - a legacy CSS or HTML file gains a hex that is neither a book colour
//   nor already in the legacy allowlist
//
// The allowlists are the styles and hexes present when this guard was
// added. Deleting one is fine. Adding a static inline style is not.
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const HEX = /#(?:[0-9a-fA-F]{3,8})\b/g;

const TOKEN_FOR_BRAND_NAME = {
  Ink: "--sm-ref-ink",
  Linen: "--sm-ref-linen",
  Bronze: "--sm-ref-bronze",
  Sand: "--sm-ref-sand",
  "Soft bronze": "--sm-ref-soft-bronze",
  White: "--sm-ref-white",
  "Dark bronze": "--sm-ref-bronze-800",
  "Deeper bronze": "--sm-ref-bronze-700",
  "Ink muted": "--sm-ref-ink-muted",
  "Inverse muted": "--sm-ref-ink-inverse-muted",
  "Quiet sand": "--sm-ref-sand-100",
  Error: "--sm-ref-error",
  Success: "--sm-ref-success",
  Warning: "--sm-ref-warning",
  "Error surface": "--sm-ref-error-surface",
  "Success surface": "--sm-ref-success-surface",
  "Warning surface": "--sm-ref-warning-surface",
  "Ink hover": "--sm-ref-ink-hover",
  "Google blue": "--sm-ref-mark-google",
  "RQMF navy": "--sm-ref-mark-rqmf",
};

function read(rel) {
  return readFileSync(join(ROOT, rel), "utf8");
}

function normalHex(value) {
  let h = value.slice(1).toLowerCase();
  if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join("");
  return `#${h.slice(0, 6)}`;
}

function brandRows(markdown) {
  const rows = new Map();
  for (const match of markdown.matchAll(/^\| ([^|\n]+) \| (#[0-9A-Fa-f]{6}) \|/gm)) {
    rows.set(match[1].trim(), normalHex(match[2]));
  }
  return rows;
}

function tokenHexes(css) {
  const found = new Map();
  for (const match of css.matchAll(/--(sm-ref-[\w-]+):\s*(#[0-9A-Fa-f]{3,8})/g)) {
    found.set(`--${match[1]}`, normalHex(match[2]));
  }
  return found;
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === ".git" || name === "node_modules" || name === "images" || name === "assets" || name === "tests") continue;
    const path = join(dir, name);
    const info = statSync(path);
    if (info.isDirectory()) walk(path, out);
    else if (/\.(css|html)$/.test(name)) out.push(path);
  }
  return out;
}

function isDynamicSwatch(style) {
  return /'\s*\+|stoneHex|primaryHex|secondaryHex|safeHex|hex_primary|isHidden \?/.test(style);
}

function staticStyles() {
  const found = new Set();
  for (const path of walk(ROOT)) {
    if (!path.endsWith(".html")) continue;
    const rel = relative(ROOT, path);
    if (rel === "styleguide.html" || rel === "admin.html" || rel === "admin-products.html") continue;
    const html = readFileSync(path, "utf8");
    for (const match of html.matchAll(/\sstyle\s*=\s*"([^"]*)"/gi)) {
      const style = match[1].replace(/\s+/g, " ").trim();
      if (!style || isDynamicSwatch(style)) continue;
      found.add(style);
    }
  }
  return found;
}

function legacyHexes(approved) {
  const found = new Set();
  const guarded = new Set(["tokens.css", "components.css", "styleguide.css", "styleguide.html", "site-upgrades.css"]);
  for (const path of walk(ROOT)) {
    const rel = relative(ROOT, path);
    if (guarded.has(rel) || rel.startsWith("functions/")) continue;
    const text = readFileSync(path, "utf8");
    for (const match of text.matchAll(HEX)) {
      const hex = normalHex(match[0]);
      if (!approved.has(hex)) found.add(`${rel} ${hex}`);
    }
  }
  return found;
}

function loadList(rel) {
  return new Set(
    read(rel)
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#")),
  );
}

const brand = brandRows(read("BRAND.md"));
const tokens = tokenHexes(read("tokens.css"));

for (const [name, token] of Object.entries(TOKEN_FOR_BRAND_NAME)) {
  assert.ok(brand.has(name), `BRAND.md is missing the ${name} colour row`);
  assert.ok(tokens.has(token), `tokens.css is missing ${token} for ${name}`);
  assert.equal(tokens.get(token), brand.get(name), `${name} drifted: BRAND.md ${brand.get(name)} vs ${token} ${tokens.get(token)}`);
}

for (const [name, hex] of brand) {
  assert.ok(
    Object.prototype.hasOwnProperty.call(TOKEN_FOR_BRAND_NAME, name),
    `BRAND.md colour ${name} ${hex} has no token mapping in the brand lint`,
  );
}

const approved = new Set(tokens.values());
for (const file of ["site-upgrades.css", "components.css", "styleguide.css"]) {
  for (const match of read(file).matchAll(HEX)) {
    const hex = normalHex(match[0]);
    assert.ok(approved.has(hex), `${file} has off-brand hex ${hex}`);
  }
}

const styles = staticStyles();
const allowedStyles = loadList("tests/inline-style-allowlist.txt");
const extraStyles = [...styles].filter((style) => !allowedStyles.has(style));
assert.deepEqual(extraStyles, [], `new static inline style:\n${extraStyles.join("\n")}`);

const hexes = legacyHexes(approved);
const allowedHexes = loadList("tests/legacy-hex-allowlist.txt");
const extraHexes = [...hexes].filter((entry) => !allowedHexes.has(entry));
assert.deepEqual(extraHexes, [], `new off-brand hex:\n${extraHexes.join("\n")}`);

console.log("brand-guard: ok");
