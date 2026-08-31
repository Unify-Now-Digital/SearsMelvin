import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { onRequest as partnerAuth } from "../functions/api/partner-auth.js";
import { onRequest as partnerOrders } from "../functions/api/partner-orders.js";
import { onRequest as redirectPartner } from "../functions/partner.js";
import { onRequest as redirectPartnerHtml } from "../functions/partner.html.js";
import { onRequest as redirectPartnerSplat } from "../functions/partner/[[path]].js";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

assert.equal(existsSync(join(repoRoot, "partner.html")), false, "partner.html must be deleted so assets cannot 200 a desk UI");

const redirects = readFileSync(join(repoRoot, "_redirects"), "utf8");
for (const source of ["/partner.html", "/partner", "/partner/", "/partner/*"]) {
  const rule = new RegExp(`^${source.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s+https://partner\\.searsmelvin\\.co\\.uk/\\s+301\\s*$`, "m");
  assert.match(redirects, rule, `missing _redirects 301 for ${source}`);
}

const goneBody = { ok: false, error: "Moved. Use https://partner.searsmelvin.co.uk" };

async function assertGone(handler, url) {
  const response = await handler({
    env: {},
    waitUntil() {},
    request: new Request(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://searsmelvin.co.uk" },
      body: JSON.stringify({ action: "login" }),
    }),
  });
  assert.equal(response.status, 410, url);
  assert.deepEqual(await response.json(), goneBody);
}

await assertGone(partnerAuth, "https://searsmelvin.co.uk/api/partner-auth");
await assertGone(partnerOrders, "https://searsmelvin.co.uk/api/partner-orders");

for (const [name, handler, url] of [
  [" /partner", redirectPartner, "https://searsmelvin.co.uk/partner"],
  ["/partner.html", redirectPartnerHtml, "https://searsmelvin.co.uk/partner.html"],
  ["/partner/orders", redirectPartnerSplat, "https://searsmelvin.co.uk/partner/orders"],
]) {
  const response = handler({
    request: new Request(url),
  });
  assert.equal(response.status, 301, name);
  assert.equal(response.headers.get("Location"), "https://partner.searsmelvin.co.uk/");
}

function walkHtml(dir, acc = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".git") continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walkHtml(path, acc);
    else if (entry.name.endsWith(".html")) acc.push(path);
  }
  return acc;
}

for (const file of walkHtml(repoRoot)) {
  const html = readFileSync(file, "utf8");
  assert.equal(html.includes('href="/partner"'), false, `${file} still links to /partner`);
  assert.equal(html.includes('href="/partner.html"'), false, `${file} still links to /partner.html`);
  assert.equal(html.includes("request-magic-link"), false, `${file} still contains partner desk UI`);
  assert.equal(html.includes("consume-magic-link"), false, `${file} still contains partner desk UI`);
}

const indexHtml = readFileSync(join(repoRoot, "index.html"), "utf8");
assert.equal(indexHtml.includes("https://partner.searsmelvin.co.uk"), true);

const authSource = readFileSync(join(repoRoot, "functions/api/partner-auth.js"), "utf8");
const ordersSource = readFileSync(join(repoRoot, "functions/api/partner-orders.js"), "utf8");
const goneSource = readFileSync(join(repoRoot, "functions/api/_partner-gone.js"), "utf8");
assert.equal(authSource.includes("password_hash"), false);
assert.equal(ordersSource.includes("deriveWorkflow"), false);
assert.match(authSource, /partnerGone/);
assert.match(ordersSource, /partnerGone/);
assert.match(goneSource, /410/);

console.log("retired partner surface tests passed");
