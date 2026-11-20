#!/usr/bin/env node
// Fail if components.css or the style guide CSS contain a raw colour.
// Raw colour = hex, rgb()/rgba(), or hsl()/hsla(), including %23 hex in a URL.
// tokens.css is the only file allowed to hold those values.
// Legacy CSS is counted and reported. It does not fail this check.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const COLOUR = /#(?:[0-9a-fA-F]{3,8})\b|%23(?:[0-9a-fA-F]{3,8})\b|rgba?\([^)]*\)|hsla?\([^)]*\)/g;
const SKIP_DIRS = new Set([".git", "node_modules", "images", "assets"]);

export function findRawColours(text) {
  return text.match(COLOUR) || [];
}

function normalise(match) {
  const compact = match.trim().replace(/\s+/g, "").toLowerCase();
  const hex = compact.match(/^#([0-9a-f]{3,8})$/);
  if (!hex) return compact;
  let h = hex[1];
  if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join("");
  return `#${h}`;
}

function read(path) {
  return readFileSync(path, "utf8");
}

function cssFromHtml(html) {
  const chunks = [];
  for (const block of html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)) chunks.push(block[1]);
  for (const attr of html.matchAll(/\sstyle\s*=\s*"([^"]*)"/gi)) chunks.push(attr[1]);
  for (const attr of html.matchAll(/\sstyle\s*=\s*'([^']*)'/gi)) chunks.push(attr[1]);
  return chunks.join("\n");
}

export function foreignComponentClasses(css) {
  const found = new Set();
  const code = css.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const match of code.matchAll(/\.(-?[_a-zA-Z][_a-zA-Z0-9-]*)/g)) {
    if (!match[1].startsWith("sm-")) found.add(match[1]);
  }
  return [...found];
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const path = join(dir, name);
    const info = statSync(path);
    if (info.isDirectory()) walk(path, out);
    else if (/\.(css|html)$/.test(name)) out.push(path);
  }
  return out;
}

export function checkTokens(root = ROOT) {
  const problems = [];
  const guarded = [
    { file: "components.css", text: read(join(root, "components.css")) },
    { file: "styleguide.css", text: read(join(root, "styleguide.css")) },
    { file: "styleguide.html (style attributes and style blocks)", text: cssFromHtml(read(join(root, "styleguide.html"))) },
  ];

  for (const item of guarded) {
    const hits = findRawColours(item.text);
    if (hits.length) problems.push(`${item.file}: ${hits.length} raw colour(s): ${[...new Set(hits)].slice(0, 8).join(", ")}`);
  }

  const foreign = foreignComponentClasses(read(join(root, "components.css")));
  if (foreign.length) problems.push(`components.css has classes without the sm- prefix: ${foreign.join(", ")}`);

  const legacyHits = [];
  const legacyFiles = new Set();
  for (const path of walk(root)) {
    const rel = relative(root, path);
    if (rel === "tokens.css" || rel === "components.css" || rel === "styleguide.css" || rel === "styleguide.html") continue;
    const text = rel.endsWith(".css") ? read(path) : cssFromHtml(read(path));
    const hits = findRawColours(text);
    if (!hits.length) continue;
    legacyFiles.add(rel);
    legacyHits.push(...hits);
  }

  const unique = new Set(legacyHits.map(normalise));
  return {
    ok: problems.length === 0,
    problems,
    legacyUnique: unique.size,
    legacyHits: legacyHits.length,
    legacyFiles: legacyFiles.size,
  };
}

function main() {
  const result = checkTokens();
  if (!result.ok) {
    console.error("check-tokens FAILED");
    for (const problem of result.problems) console.error(" - " + problem);
  } else {
    console.log("check-tokens OK");
    console.log("components.css, styleguide.css, and styleguide inline CSS have no raw colours.");
  }
  console.log(
    `Legacy files hold ${result.legacyUnique} unique raw colours (${result.legacyHits} hits) across ${result.legacyFiles} files. This check does not fail on them.`,
  );
  process.exitCode = result.ok ? 0 : 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
