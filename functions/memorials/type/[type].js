/**
 * /memorials/type/<slug> 301s to the range page with that filter already on.
 * Unknown slugs stay a 404. A product URL is /memorials/<slug> and is unchanged.
 */

import { categoryBySlug } from "../../../data/categories.js";

function notFound() {
  return new Response("Not Found", {
    status: 404,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "X-Robots-Tag": "noindex",
      "Cache-Control": "no-store",
    },
  });
}

export function categoryRedirect(request, slug) {
  const incoming = new URL(request.url);
  const params = new URLSearchParams();
  params.set("type", slug);
  for (const [key, value] of incoming.searchParams) {
    if (key === "type") continue;
    params.append(key, value);
  }
  const search = params.toString();
  return new Response(null, {
    status: 301,
    headers: {
      Location: `/memorials${search ? `?${search}` : ""}`,
      "X-Robots-Tag": "noindex",
      "Cache-Control": "public, max-age=3600",
    },
  });
}

export async function onRequestGet({ request, params }) {
  const category = categoryBySlug(params && params.type);
  if (!category) return notFound();
  return categoryRedirect(request, category.slug);
}
