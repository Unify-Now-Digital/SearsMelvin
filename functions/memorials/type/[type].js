/**
 * /memorials/type/<slug> — one page per memorial category.
 * More specific than functions/memorials/[slug].js, so a product URL is unchanged.
 */

import { publishableKey, publicSupabaseUrl, supabaseKeyHeaders } from "../../api/_supabase-keys.js";
import { categoryBySlug } from "../../../data/categories.js";
import { renderCategoryPage } from "../../_seo-document.js";

const SM_ORG_ID = "3770972d-1bbd-417b-b413-297e844db285";

function text(status, body) {
  return new Response(body, {
    status,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "X-Robots-Tag": "noindex",
      "Cache-Control": "no-store",
    },
  });
}

async function fetchCatalogue(env) {
  const base = publicSupabaseUrl(env);
  const headers = supabaseKeyHeaders(publishableKey(env));
  const org = encodeURIComponent(env.SM_ORG_ID || SM_ORG_ID);
  const response = await fetch(
    `${base}/rest/v1/products?organization_id=eq.${org}&is_active=eq.true&is_listed=eq.true&category_id=not.is.null&select=*,product_categories(name,slug)&order=display_order`,
    { headers },
  );
  if (!response.ok) return null;
  const products = await response.json();
  return Array.isArray(products) ? products : null;
}

export async function onRequestGet({ request, env, params }) {
  const category = categoryBySlug(params && params.type);
  if (!category) return text(404, "Not Found");

  let products;
  try {
    products = await fetchCatalogue(env);
  } catch {
    return text(503, "The catalogue is temporarily unavailable.");
  }
  if (!products) return text(503, "The catalogue is temporarily unavailable.");

  const shell = await env.ASSETS.fetch(new URL("/memorials.html", request.url));
  const shellHtml = await shell.text();
  const inType = products.filter((product) => product?.product_categories?.slug === category.slug);
  const html = renderCategoryPage({ shellHtml, category, products: inType });
  return new Response(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "public, max-age=300, stale-while-revalidate=3600",
    },
  });
}
