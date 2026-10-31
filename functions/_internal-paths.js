/**
 * 404 for internal repo files.
 *
 * Cloudflare Pages Git deploys upload the dashboard build output directory
 * (the repo root). These paths are forced through Pages Functions
 * (`_routes.json`) and answered with 404. `wrangler.jsonc` must not set
 * `assets.directory` to the repo root: Wrangler then serves the file before
 * this Function. Do not add `pages_build_output_dir` until the dashboard
 * config has been downloaded and reviewed — that key makes wrangler.jsonc the
 * source of truth and would replace dashboard bindings.
 */

const EXACT = new Set([
  "/claude.md",
  "/seo-action-plan.md",
  "/readme.md",
  "/sears-melvin-readme.md",
  "/supabase-migration.sql",
  "/wrangler.jsonc",
  "/.gitignore",
]);

const PREFIXES = ["/docs", "/tests", "/scripts", "/migrations", "/.github", "/.codex-out"];

export function isInternalRepoPath(pathname) {
  let path;
  try {
    path = new URL(pathname, "https://searsmelvin.co.uk").pathname;
  } catch {
    return false;
  }
  path = path.replace(/\/{2,}/g, "/");
  if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
  const lower = path.toLowerCase();
  if (EXACT.has(lower)) return true;
  return PREFIXES.some((prefix) => lower === prefix || lower.startsWith(prefix + "/"));
}

export function notFound() {
  return new Response("Not Found", {
    status: 404,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "X-Robots-Tag": "noindex",
    },
  });
}

export async function onRequest(context) {
  const path = new URL(context.request.url).pathname;
  if (isInternalRepoPath(path)) return notFound();
  return context.next();
}
