import { publicSupabaseUrl } from "../api/_supabase-keys.js";

const ALLOWED_BUCKETS = new Set(["product-images"]);
const ALLOWED_PARAMS = new Set(["width", "quality", "resize"]);
const CACHE_CONTROL = "public, max-age=604800, stale-while-revalidate=86400";

function notFound() {
  return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
}

export async function onRequestGet({ request, env, params }) {
  const parts = Array.isArray(params.path) ? params.path : String(params.path || "").split("/");
  const [bucket, ...objectParts] = parts;
  if (!ALLOWED_BUCKETS.has(bucket) || objectParts.length === 0) return notFound();
  if (objectParts.some((part) => !part || part === "." || part === ".." || /[\\\0]/.test(part))) return notFound();

  const incoming = new URL(request.url);
  for (const key of incoming.searchParams.keys()) if (!ALLOWED_PARAMS.has(key)) return notFound();
  const width = incoming.searchParams.get("width");
  const quality = incoming.searchParams.get("quality");
  const resize = incoming.searchParams.get("resize");
  if (!/^[1-9]\d{1,3}$/.test(width || "") || Number(width) > 1600) return notFound();
  if (quality && (!/^\d{1,2}$/.test(quality) || Number(quality) < 1 || Number(quality) > 100)) return notFound();
  if (resize && resize !== "contain" && resize !== "cover") return notFound();

  const upstream = new URL(`${publicSupabaseUrl(env)}/storage/v1/render/image/public/${bucket}/${objectParts.map(encodeURIComponent).join("/")}`);
  upstream.searchParams.set("width", width);
  if (quality) upstream.searchParams.set("quality", quality);
  if (resize) upstream.searchParams.set("resize", resize);

  const cache = typeof caches !== "undefined" ? caches.default : null;
  const cacheKey = new Request(incoming.toString(), { method: "GET" });
  const cached = cache && await cache.match(cacheKey);
  if (cached) return cached;

  const response = await fetch(upstream, { cf: { cacheEverything: true, cacheTtl: 604800 } });
  if (!response.ok) return notFound();
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", CACHE_CONTROL);
  headers.set("X-Content-Type-Options", "nosniff");
  const proxied = new Response(response.body, { status: response.status, headers });
  if (cache) await cache.put(cacheKey, proxied.clone());
  return proxied;
}

export const onRequest = onRequestGet;
