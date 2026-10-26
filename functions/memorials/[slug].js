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
 * the public catalogue is unreachable, we fall through and serve the static
 * memorial.html unchanged. The client JS shows "Product not found" or its
 * normal "no slug" message.
 */

const BASE = "https://searsmelvin.co.uk";
const FALLBACK_IMAGE = `${BASE}/sm-logo.svg`;
const PUBLIC_SUPABASE_URL = "https://bfwohzcugtwbhhxdqgme.supabase.co";
const SM_ORG_ID = "3770972d-1bbd-417b-b413-297e844db285";
const PUBLIC_SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJmd29oemN1Z3R3YmhoeGRxZ21lIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjgyMDA0NTIsImV4cCI6MjA4Mzc3NjQ1Mn0.QbEq1y3hczoRzcCrdajPmpPNkeh5A7jkAsfHP9BSAGg";

// Asset requests (favicon.svg, robots.txt, *.map …) can be resolved by the
// browser against /memorials/<slug>/ and land on this route. They're never
// products, so skip the DB lookup rather than querying slug=eq.favicon.svg.
function looksLikeAsset(slug) {
  return /\.[a-z0-9]{2,5}$/i.test(slug);
}

const NOT_FOUND = Symbol("not-found");

async function fetchProduct(env, slug) {
  // This is a public route: never make the service-role key available to it.
  // Catalogue rows are intentionally readable through the public anon role.
  const url = env.SUPABASE_URL || PUBLIC_SUPABASE_URL;
  const key = env.SUPABASE_ANON_KEY || PUBLIC_SUPABASE_KEY;
  if (looksLikeAsset(slug)) return null;
  try {
    const res = await fetch(
      `${url}/rest/v1/products?slug=eq.${encodeURIComponent(slug)}&organization_id=eq.${encodeURIComponent(env.SM_ORG_ID || SM_ORG_ID)}&is_active=eq.true&is_listed=eq.true&category_id=not.is.null&select=id,name,slug,short_description,description,image_url,base_price,product_categories(name,slug)&limit=1`,
      {
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
        },
      },
    );
    if (!res.ok) return null;
    const rows = await res.json();
    // Supabase answered and there is no public, listed product with this
    // slug (e.g. the unlisted £1 `test-product`): tell the caller it is a
    // definite miss so we can send a real 404 instead of a soft-404 200.
    return rows[0] || NOT_FOUND;
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
    description: product.description || "Hand-finished memorial with a 30-year fixing guarantee.",
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
      description: "Cemetery permit fees are extra and vary by cemetery.",
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
  if (product === NOT_FOUND) {
    // Unknown or retired/unlisted slug (Supabase answered, no listed row):
    // send visitors to the listing instead of a dead page. 302 (temporary)
    // because a slug may be re-listed later and we don't want browsers or
    // Google to cache a permanent move. The original query string (gclid,
    // gbraid, wbraid, utm_*, etc.) is carried over verbatim so the /memorials
    // page (GTM-KRDX4BQ5, consent mode, gclid capture) still sees it.
    const src = new URL(request.url);
    const dest = new URL("/memorials", src.origin);
    dest.search = src.search;
    return new Response(null, {
      status: 302,
      headers: {
        Location: dest.pathname + dest.search,
        "X-Robots-Tag": "noindex",
        "Cache-Control": "no-store",
      },
    });
  }
  if (!product) return shell;

  const canonicalUrl = `${BASE}/memorials/${encodeURIComponent(product.slug)}`;
  const title = `${product.name} | Sears Melvin Memorials`;
  const desc = clip(product.description, 200) ||
    "Hand-finished memorial with a 30-year fixing guarantee. Configure your memorial online.";
  const imageUrl = product.image_url || FALLBACK_IMAGE;
  const categoryName = product.product_categories?.name || "Memorial";
  const shortDescription = String(product.short_description || "").trim();
  let longDescription = String(product.description || "").trim();
  if (shortDescription && longDescription.startsWith(shortDescription)) {
    longDescription = longDescription.slice(shortDescription.length).trim();
  }
  const lead = shortDescription || longDescription ||
    "Hand-finished memorial, professionally installed.";
  const price = parseFloat(product.base_price);
  const displayedPrice = Number.isFinite(price)
    ? `From £${price.toLocaleString("en-GB")}`
    : "Guide price on request";

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
    .on("#productName", {
      element(el) { el.setInnerContent(product.name || "Memorial", { html: false }); },
    })
    .on("#productCategory", {
      element(el) { el.setInnerContent(categoryName, { html: false }); },
    })
    .on("#productLead", {
      element(el) { el.setInnerContent(lead, { html: false }); },
    })
    .on("#productDescription", {
      element(el) { el.setInnerContent(longDescription, { html: false }); },
    })
    .on("#priceTotal", {
      element(el) { el.setInnerContent(displayedPrice, { html: false }); },
    })
    .on("#mobilePriceTotal", {
      element(el) { el.setInnerContent(displayedPrice, { html: false }); },
    })
    .on("#galleryMainImg", {
      element(el) {
        el.setAttribute("src", imageUrl);
        el.setAttribute("alt", product.name || "Memorial");
      },
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
