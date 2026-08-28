import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dest = "https://partner.searsmelvin.co.uk/";

const redirects = readFileSync(join(root, "_redirects"), "utf8");
assert.match(redirects, /^\/partner\s+https:\/\/partner\.searsmelvin\.co\.uk\/\s+301\s*$/m);
assert.match(redirects, /^\/partner\/\s+https:\/\/partner\.searsmelvin\.co\.uk\/\s+301\s*$/m);
assert.match(redirects, /^\/partner\.html\s+https:\/\/partner\.searsmelvin\.co\.uk\/\s+301\s*$/m);
assert.match(redirects, /^\/partner\/\*\s+https:\/\/partner\.searsmelvin\.co\.uk\/\s+301\s*$/m);
assert.equal(/^\/api\/partner/m.test(redirects), false);

const partnerHtml = readFileSync(join(root, "partner.html"), "utf8");
assert.match(partnerHtml, /http-equiv="refresh"/i);
assert.match(partnerHtml, /location\.replace\("https:\/\/partner\.searsmelvin\.co\.uk\/"\)/);
assert.equal(partnerHtml.includes(dest), true);
assert.equal(partnerHtml.includes("/api/partner-auth"), false);
assert.equal(partnerHtml.includes("/api/partner-orders"), false);
assert.equal(partnerHtml.includes('type="password"'), false);

const partnerAuth = readFileSync(join(root, "functions/api/partner-auth.js"), "utf8");
const partnerOrders = readFileSync(join(root, "functions/api/partner-orders.js"), "utf8");
assert.match(partnerAuth, /DEPRECATED/);
assert.match(partnerOrders, /DEPRECATED/);

const claude = readFileSync(join(root, "CLAUDE.md"), "utf8");
const workflow = readFileSync(join(root, "docs/PARTNER-PORTAL-V2-WORKFLOW.md"), "utf8");
assert.match(claude, /public-site `\/partner` UI is deprecated/);
assert.match(claude, /partner\.searsmelvin\.co\.uk/);
assert.match(workflow, /Deprecated public-site UI/);
assert.match(workflow, /#152/);

function htmlFiles(dir, acc = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === ".git" || entry.name === "node_modules") continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) htmlFiles(path, acc);
    else if (entry.name.endsWith(".html") && entry.name !== "partner.html") acc.push(path);
  }
  return acc;
}

for (const file of htmlFiles(root)) {
  const html = readFileSync(file, "utf8");
  assert.equal(
    html.includes('href="/partner"'),
    false,
    `${file} still points humans at /partner`,
  );
}

console.log("partner deprecation checks passed");
