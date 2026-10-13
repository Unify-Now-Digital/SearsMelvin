import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";

// The RQMF badge, registration number and NAMM qualification line are plain
// content: no page may wrap them in a link.
const root = new URL("../", import.meta.url);
const files = [
  ...(await readdir(root)).filter(f => f.endsWith(".html")),
  ...(await readdir(new URL("areas/", root))).filter(f => f.endsWith(".html")).map(f => `areas/${f}`),
];
const anchorRe = /<a\b[^>]*>[\s\S]*?<\/a>/gi;
for (const file of files) {
  const html = await readFile(new URL(file, root), "utf8");
  assert.doesNotMatch(html, /href="[^"]*(rqmf|namm)[^"]*"/i, `${file} links to RQMF/NAMM`);
  for (const [anchor] of html.matchAll(anchorRe)) {
    assert.ok(!/RQMF Registered|NAMM-run RQMF|rqmf-logo|accred-link|accred-logo/i.test(anchor), `${file} wraps RQMF content in a link`);
  }
}
const css = await readFile(new URL("accreditations.css", root), "utf8");
assert.doesNotMatch(css, /accred[\w-]*[^{}]*:hover/, "accreditation badge still has hover styles");
console.log("rqmf no-link test passed");
