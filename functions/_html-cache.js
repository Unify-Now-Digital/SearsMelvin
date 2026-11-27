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

export async function cachedHtml(request) {
  const cache = edgeCache();
  if (!cache) return null;
  try {
    return (await cache.match(htmlCacheRequest(request))) || null;
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
