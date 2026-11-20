/**
 * Redirects that _redirects cannot express (query strings, or a hostname).
 * www → apex on every path needs a zone redirect rule as well: Pages
 * Functions only run for routes in _routes.json, so static pages never
 * reach this file. The rule is documented on the pull request.
 */

const APEX = "searsmelvin.co.uk";
const SLUG_RE = /^[a-z0-9-]{1,120}$/;

export function wwwToApexRedirect(request) {
  const url = new URL(request.url);
  if (url.hostname !== `www.${APEX}`) return null;
  url.hostname = APEX;
  url.protocol = "https:";
  return new Response(null, {
    status: 301,
    headers: {
      Location: url.toString(),
      "Cache-Control": "public, max-age=3600",
    },
  });
}

/**
 * /memorial.html?slug=X and /memorial?slug=X → /memorials/X.
 * Click IDs and UTMs stay on the destination. A missing or unsafe slug
 * goes to the catalogue.
 */
export function legacyQueryRedirect(request) {
  const url = new URL(request.url);
  const path = url.pathname.length > 1 && url.pathname.endsWith("/")
    ? url.pathname.slice(0, -1)
    : url.pathname;
  if (path !== "/memorial" && path !== "/memorial.html") return null;
  if (!url.searchParams.has("slug")) return null;
  const slug = String(url.searchParams.get("slug") || "").trim().toLowerCase();
  url.searchParams.delete("slug");
  const search = url.searchParams.toString();
  const destPath = SLUG_RE.test(slug) ? `/memorials/${slug}` : "/memorials";
  return new Response(null, {
    status: 301,
    headers: {
      Location: destPath + (search ? `?${search}` : ""),
      "Cache-Control": "public, max-age=3600",
    },
  });
}
