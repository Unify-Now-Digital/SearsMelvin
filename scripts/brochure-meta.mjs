// Reads the shipped brochure PDF and returns its real page count and size.
// Usage: node scripts/brochure-meta.mjs  -> prints JSON; tests use pdfMeta()
// to make sure site-config.js never drifts from the actual file.
import { readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";

export function pdfPageCount(buf) {
  // Count page objects (/Type /Page, not /Pages). Works for the uncompressed
  // object table fpdf2 writes; falls back to the /Count of the root /Pages.
  const text = buf.toString("latin1");
  const pages = text.match(/\/Type\s*\/Page(?![a-zA-Z])/g) || [];
  if (pages.length) return pages.length;
  const counts = [...text.matchAll(/\/Type\s*\/Pages[^>]*\/Count\s+(\d+)/g)].map((m) => Number(m[1]));
  return counts.length ? Math.max(...counts) : 0;
}

export function pdfMeta(path) {
  const buf = readFileSync(path);
  return { pages: pdfPageCount(buf), bytes: statSync(path).size };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(pdfMeta(process.argv[2] || "assets/sears-melvin-brochure.pdf")));
}
