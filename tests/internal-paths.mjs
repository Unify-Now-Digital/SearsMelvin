// Internal repo files must not be served. Pages Git deploys upload the
// dashboard build output (the repo root); this test pins the repo-side 404.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { isInternalRepoPath, onRequest } from "../functions/_internal-paths.js";

const root = fileURLToPath(new URL("..", import.meta.url));

const QUOTES = [
  ["Sarah M.", "Islington", "From our first call, Sears Melvin made what felt like an overwhelming process feel simple and caring. The memorial is absolutely beautiful — exactly what we wanted."],
  ["David R.", "Barnet", "They handled the cemetery permits and kept us informed at every step. The restoration of my grandparents' headstone brought it back to life. Highly recommended."],
  ["Angela K.", "Enfield", "We were nervous about choosing the right memorial but the team guided us through every option. The quality of the engraving and stonework exceeded our expectations."],
];

const indexHtml = readFileSync(new URL("../index.html", import.meta.url), "utf8");
assert.equal(indexHtml.includes("placeholder testimonials"), false);
assert.equal(indexHtml.includes("REPLACE: Swap placeholder"), false);
for (const [name, place, quote] of QUOTES) {
  assert.ok(indexHtml.includes(name), name);
  assert.ok(indexHtml.includes(place), place);
  assert.ok(indexHtml.includes(quote), quote);
}

const INTERNAL = [
  "/CLAUDE.md",
  "/docs/TRACKING.md",
  "/docs/TOOLING-AUDIT.md",
  "/SEO-ACTION-PLAN.md",
  "/supabase-migration.sql",
  "/wrangler.jsonc",
  "/.gitignore",
  "/tests/email-subjects.mjs",
  "/tests",
  "/scripts/ghl-chat-sync/sm_ghl_chat_sync.py",
  "/scripts/ghl-chat-sync/CRON.md",
  "/scripts",
  "/README.md",
  "/SEARS-MELVIN-README.md",
  "/migrations/2026-08-26-fix-public-cemetery-read-and-audit-log.sql",
  "/.github/workflows/tests.yml",
  "/.codex-out/BUGS.md",
];

const PUBLIC = [
  "/",
  "/about",
  "/contact",
  "/index.html",
  "/memorial.html",
  "/memorials.html",
  "/admin.html",
  "/quote.html",
  "/track.html",
  "/data/team.js",
  "/site-globals.js",
  "/site-config.js",
  "/site-upgrades.js",
  "/site-upgrades.css",
  "/assets/sears-melvin-brochure.pdf",
  "/images/accreditations/rqmf-logo-white.png",
  "/favicon.svg",
  "/sm-logo.svg",
  "/robots.txt",
  "/permit-checker",
  "/areas",
  "/areas/barnet",
  "/api/submit",
  "/api/config",
  "/memorials",
  "/memorials/hartwell",
  "/partner",
  "/sitemap.xml",
  "/supabase-config",
];

for (const path of INTERNAL) {
  assert.equal(isInternalRepoPath(path), true, path);
  assert.equal(isInternalRepoPath(path + "/"), true, path + "/");
}
for (const path of PUBLIC) assert.equal(isInternalRepoPath(path), false, path);

function ruleMatches(rule, path) {
  if (rule.endsWith("/*")) {
    const base = rule.slice(0, -2);
    return path === base || path.startsWith(base + "/");
  }
  return rule === path;
}

const routes = JSON.parse(readFileSync(new URL("../_routes.json", import.meta.url), "utf8"));
assert.equal(routes.version, 1);
assert.ok(Array.isArray(routes.include) && routes.include.length > 0);
assert.ok(routes.include.length + (routes.exclude || []).length <= 100);
for (const rule of [...routes.include, ...(routes.exclude || [])]) {
  assert.ok(rule.length <= 100, rule);
}

const MUST_INVOKE = [
  "/api/submit",
  "/api/config",
  "/api/stripe",
  "/api/stripe-webhook",
  "/api/brochure",
  "/api/quotes",
  "/api/customer-order",
  "/api/admin",
  "/api/upload-photo",
  "/api/csp-report",
  "/api/click-intent",
  "/api/order-type-after-deposit",
  "/api/partner-auth",
  "/api/partner-orders",
  "/memorials",
  "/memorials/hartwell",
  "/memorials.html",
  "/partner",
  "/partner/",
  "/partner.html",
  "/partner/orders",
  "/sitemap.xml",
  "/supabase-config",
  ...INTERNAL,
];
for (const path of MUST_INVOKE) {
  assert.ok(routes.include.some((rule) => ruleMatches(rule, path.replace(/\/$/, "") || "/")), `include misses ${path}`);
}
for (const path of ["/", "/about", "/contact", "/index.html", "/data/team.js", "/assets/sears-melvin-brochure.pdf", "/images/installed/x.webp", "/favicon.svg", "/robots.txt", "/permit-checker", "/areas", "/areas/barnet"]) {
  assert.equal(routes.include.some((rule) => ruleMatches(rule, path)), false, `${path} must stay a static asset or redirect`);
}

async function handle(url) {
  let nextCalled = false;
  const response = await onRequest({
    request: new Request(url),
    async next() {
      nextCalled = true;
      return new Response("next", { status: 200 });
    },
  });
  return { response, nextCalled };
}

for (const path of INTERNAL) {
  const { response, nextCalled } = await handle("https://searsmelvin.co.uk" + path);
  assert.equal(response.status, 404, path);
  assert.equal(nextCalled, false, path);
  assert.equal(await response.text(), "Not Found");
}
for (const path of ["/about", "/api/submit", "/memorials/hartwell", "/data/team.js"]) {
  const { response, nextCalled } = await handle("https://searsmelvin.co.uk" + path);
  assert.equal(nextCalled, true, path);
  assert.equal(response.status, 200, path);
}

// Every file Pages would upload from the repo root is either a public site
// file or covered by the 404. functions/ is compiled, not uploaded as assets.
const PUBLIC_ROOT = new Set([
  "404.html", "about.html", "admin.html", "admin-products.html", "brochure.html",
  "care-guide.html", "contact.html", "faq.html", "index.html", "memorial.html",
  "memorials.html", "privacy.html", "quote.html", "resources.html", "terms.html",
  "track.html", "accreditations.css", "chat-widget.css", "site-upgrades.css",
  "site-config.js", "site-globals.js", "site-upgrades.js", "favicon.svg",
  "sm-logo.svg", "robots.txt", "_headers", "_redirects", "_routes.json",
]);
const PUBLIC_DIRS = ["assets/", "images/", "data/"];
const tracked = execSync("git ls-files -z", { cwd: root, encoding: "utf8" }).split("\0").filter(Boolean);
for (const file of tracked) {
  if (file.startsWith("functions/") || file === "_routes.json") continue;
  const urlPath = "/" + file;
  const isPublic = PUBLIC_ROOT.has(file) || PUBLIC_DIRS.some((dir) => file.startsWith(dir));
  if (isPublic) assert.equal(isInternalRepoPath(urlPath), false, file);
  else assert.equal(isInternalRepoPath(urlPath), true, `unclassified public file ${file}`);
}

console.log("internal-paths: ok");
