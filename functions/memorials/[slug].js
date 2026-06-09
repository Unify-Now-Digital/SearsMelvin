/**
 * Server-renders product detail pages at /memorials/<slug>.
 *
 * Why: memorial.html is a static SPA shell — the Product JSON-LD, OG title,
 * canonical URL etc. are all empty until the client-side JS finishes a
 * Supabase fetch. Crawlers and social-share scrapers that don't run JS (Bing,
 * Pinterest, LinkedIn, some messengers) see only the placeholder. This
 * function fetches the product server-side and rewrites the static HTML with
 * real meta tags + a populated <script id="productJsonLd"> before serving.
 *
 * The client-side JS in memorial.html still runs and re-applies the same data
 * — that's harmless (idempotent) and keeps the shell working if the function
 * is ever bypassed.
 *
 * Failure modes: if Supabase is unreachable, the slug is unknown, or
 * env.SUPABASE_SERVICE_KEY isn't set, we fall through and serve the static
 * memorial.html unchanged. The client JS shows "Product not found" or its
 * normal "no slug" message.
 */

const BASE = "https://searsmelvin.co.uk";
const FALLBACK_IMAGE = `${BASE}/sm-logo.svg`;

// Asset requests (favicon.svg, robots.txt, *.map …) can be resolved by the
// browser against /memorials/<slug>/ and land on this route. They're never
// products, so skip the DB lookup rather than querying slug=eq.favicon.svg.
function looksLikeAsset(slug) {
  return /\.[a-z0-9]{2,5}$/i.test(slug);
}

async function fetchProduct(env, slug) {
  const key = env.SUPABASE_SERVICE_KEY || env.SUPABASE_ANON_KEY;
  if (!env.SUPABASE_URL || !key) return null;
  if (looksLikeAsset(slug)) return null;
  try {
    const res = await fetch(
      `${env.SUPABASE_URL}/rest/v1/products?slug=eq.${encodeURIComponent(slug)}&is_active=eq.true&select=*,product_categories(name,slug)&limit=1`,
      {
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
        },
      },
    );
    if (!res.ok) return null;
    const rows = await res.json();
    return rows[0] || null;
  } catch {
    return null;
  }
}

function clip(str, n) {
  if (!str) return "";
  const s = String(str).replace(/\s+/g, " ").trim();
  return s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s;
}

function buildSchema(product, canonicalUrl) {
  const catName = product.product_categories?.name || "Memorial";
  const productImage = product.image_url || FALLBACK_IMAGE;
  const price = parseFloat(product.base_price);

  const productLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.name,
    description: product.description || "Hand-finished memorial with 30-year guarantee.",
    image: productImage,
    sku: product.slug || String(product.id || ""),
    category: catName,
    brand: { "@type": "Brand", name: "Sears Melvin Memorials" },
    offers: {
      "@type": "Offer",
      url: canonicalUrl,
      priceCurrency: "GBP",
      price: Number.isFinite(price) ? price.toFixed(2) : undefined,
      availability: "https://schema.org/MadeToOrder",
      seller: { "@type": "Organization", name: "Sears Melvin Memorials" },
    },
  };

  const catSlug = product.product_categories?.slug;
  const crumbs = [
    { "@type": "ListItem", position: 1, name: "Home", item: `${BASE}/` },
    { "@type": "ListItem", position: 2, name: "Memorials", item: `${BASE}/memorials` },
  ];
  if (catSlug) {
    crumbs.push({
      "@type": "ListItem",
      position: 3,
      name: catName,
      item: `${BASE}/memorials?type=${encodeURIComponent(catSlug)}`,
    });
    crumbs.push({ "@type": "ListItem", position: 4, name: product.name, item: canonicalUrl });
  } else {
    crumbs.push({ "@type": "ListItem", position: 3, name: product.name, item: canonicalUrl });
  }

  const breadcrumbLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: crumbs,
  };

  return { productLd, breadcrumbLd };
}

export async function onRequestGet({ request, env, params }) {
  const slug = params && params.slug;
  // Always serve memorial.html as the body. If we have product data we
  // rewrite tags inside it; if not, we pass it through unchanged.
  const shellUrl = new URL("/memorial.html", request.url);
  const shell = await env.ASSETS.fetch(shellUrl);

  if (!slug) return shell;

  const product = await fetchProduct(env, slug);
  if (!product) return shell;

  const canonicalUrl = `${BASE}/memorials/${encodeURIComponent(product.slug)}`;
  const title = `${product.name} | Sears Melvin Memorials`;
  const desc = clip(product.description, 200) ||
    "Hand-finished memorial with 30-year guarantee. Configure your memorial online.";
  const imageUrl = product.image_url || FALLBACK_IMAGE;

  const { productLd, breadcrumbLd } = buildSchema(product, canonicalUrl);

  return new HTMLRewriter()
    .on("title", {
      element(el) { el.setInnerContent(title); },
    })
    .on('meta[name="description"]', {
      element(el) { el.setAttribute("content", desc); },
    })
    .on('link[rel="canonical"]', {
      element(el) { el.setAttribute("href", canonicalUrl); },
    })
    .on('meta[property="og:title"]', {
      element(el) { el.setAttribute("content", title); },
    })
    .on('meta[property="og:description"]', {
      element(el) { el.setAttribute("content", desc); },
    })
    .on('meta[property="og:url"]', {
      element(el) { el.setAttribute("content", canonicalUrl); },
    })
    .on('meta[property="og:image"]', {
      element(el) { el.setAttribute("content", imageUrl); },
    })
    .on('meta[name="twitter:title"]', {
      element(el) { el.setAttribute("content", title); },
    })
    .on('meta[name="twitter:description"]', {
      element(el) { el.setAttribute("content", desc); },
    })
    .on('meta[name="twitter:image"]', {
      element(el) { el.setAttribute("content", imageUrl); },
    })
    .on("script#breadcrumbJsonLd", {
      element(el) { el.setInnerContent(JSON.stringify(breadcrumbLd), { html: false }); },
    })
    .on("script#productJsonLd", {
      element(el) { el.setInnerContent(JSON.stringify(productLd), { html: false }); },
    })
    .transform(
      new Response(shell.body, {
        status: shell.status,
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          // Match the existing /*.html cache rule: short browser cache, longer
          // SWR so the edge can serve stale while revalidating.
          "Cache-Control": "public, max-age=300, stale-while-revalidate=3600",
        },
      }),
    );
}
