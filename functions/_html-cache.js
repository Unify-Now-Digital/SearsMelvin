/**
 * Pages does not store Function HTML on the CDN. cf-cache-status stays
 * DYNAMIC, so every product and area view waits on Supabase even when
 * Cache-Control is public. caches.default is the cache that honours that
 * header. The key is the path only: ad-click query strings must not
 * fragment it, and the HTML does not vary by query.
 */

export function htmlCacheRequest(request) {
  const url = new URL(request.url);
  url.search = "";
  url.hash = "";
  return new Request(url.toString(), { method: "GET" });
}

function edgeCache() {
  try {
    return globalThis.caches && globalThis.caches.default ? globalThis.caches.default : null;
  } catch {
    return null;
  }
}

// Bump when the cached HTML's image markup changes. Older entries lack the
// header, so they are rebuilt instead of keeping a 1200w preload.
export const HTML_CACHE_GENERATION = "gallery-sizes-4";

export async function cachedHtml(request) {
  const cache = edgeCache();
  if (!cache) return null;
  try {
    const hit = await cache.match(htmlCacheRequest(request));
    if (!hit) return null;
    if (hit.headers.get("X-SM-HTML") !== HTML_CACHE_GENERATION) return null;
    return hit;
  } catch {
    return null;
  }
}

export function storeHtml(request, response, waitUntil) {
  const cache = edgeCache();
  if (!cache || !response || response.status !== 200 || request.method !== "GET") return response;
  const control = response.headers.get("Cache-Control") || "";
  if (!/public/i.test(control) || /no-store|private/i.test(control)) return response;
  let copy;
  try {
    copy = response.clone();
  } catch {
    return response;
  }
  const saving = cache.put(htmlCacheRequest(request), copy).catch(() => {});
  if (typeof waitUntil === "function") waitUntil(saving);
  return response;
}
