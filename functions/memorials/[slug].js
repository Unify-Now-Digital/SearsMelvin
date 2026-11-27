/**
 * Server-renders product detail pages at /memorials/<slug>.
 *
 * memorial.html is a static shell. This function fills the title, the
 * description, the price, a short unique facts block, and related links
 * before the response is sent, so a crawler that does not run JavaScript
 * still sees one product per URL.
 *
 * An unknown slug redirects to /memorials (302, query string kept).
 * A known retired slug is a 301 or a 410.
 * If Supabase cannot be reached, the shell is served with 200 so a live
 * product is not turned into a 404 during an outage.
 */

import { publishableKey, publicSupabaseUrl, supabaseKeyHeaders } from "../api/_supabase-keys.js";
import { legacySlugStatus } from "../_legacy-slugs.js";
import { cachedHtml, storeHtml, HTML_CACHE_GENERATION } from "../_html-cache.js";
import { factsParagraph, productDescription, productTitle, SHARE_IMAGE } from "../../product-copy.js";

const BASE = "https://searsmelvin.co.uk";
const SM_ORG_ID = "3770972d-1bbd-417b-b413-297e844db285";
const NOT_FOUND = Symbol("not-found");

function looksLikeAsset(slug) {
  return /\.[a-z0-9]{2,5}$/i.test(slug);
}

function escapeHtml(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

function safeSlug(value) {
  const slug = String(value == null ? "" : value).toLowerCase();
  return /^[a-z0-9-]{1,120}$/.test(slug) ? slug : "";
}

async function catalogueFetch(env, path) {
  const base = publicSupabaseUrl(env);
  return fetch(`${base}${path}`, { headers: supabaseKeyHeaders(publishableKey(env)) });
}

async function fetchProduct(env, slug) {
  if (looksLikeAsset(slug)) return null;
  const org = encodeURIComponent(env.SM_ORG_ID || SM_ORG_ID);
  try {
    const res = await catalogueFetch(
      env,
      `/rest/v1/products?slug=eq.${encodeURIComponent(slug)}&organization_id=eq.${org}&is_active=eq.true&is_listed=eq.true&category_id=not.is.null&select=id,name,slug,short_description,description,image_url,base_price,included_features,category_id,product_categories(name,slug)&limit=1`,
    );
    if (!res.ok) return null;
    const rows = await res.json();
    return rows[0] || NOT_FOUND;
  } catch {
    return null;
  }
}

async function readList(env, path) {
  try {
    const res = await catalogueFetch(env, path);
    if (!res.ok) return { ok: false, rows: [] };
    const rows = await res.json();
    return Array.isArray(rows) ? { ok: true, rows } : { ok: false, rows: [] };
  } catch {
    return { ok: false, rows: [] };
  }
}

async function fetchSizes(env, productId) {
  return readList(
    env,
    `/rest/v1/product_sizes?product_id=eq.${encodeURIComponent(productId)}&select=size_name,dimensions&order=display_order.asc`,
  );
}

async function fetchRelated(env, product) {
  const categoryId = product.category_id;
  if (!categoryId) return { ok: true, rows: [] };
  const org = encodeURIComponent(env.SM_ORG_ID || SM_ORG_ID);
  return readList(
    env,
    `/rest/v1/products?organization_id=eq.${org}&category_id=eq.${encodeURIComponent(categoryId)}&slug=neq.${encodeURIComponent(product.slug)}&is_active=eq.true&is_listed=eq.true&select=name,slug&order=display_order.asc&limit=8`,
  );
}

function absoluteImage(env, value) {
  if (!value) return "";
  try {
    const supabase = publicSupabaseUrl(env);
    const url = new URL(String(value), supabase);
    if (url.protocol !== "https:" || url.username || url.password) return "";
    if (url.pathname.startsWith("/storage/") || url.pathname.startsWith("/rest/")) {
      const host = new URL(supabase);
      url.protocol = host.protocol;
      url.host = host.host;
    }
    return url.href;
  } catch {
    return "";
  }
}

function renderSrc(url, width) {
  if (!url.includes("/storage/v1/object/public/")) return url;
  // Main product image: Supabase render host directly (separate connection for the LCP
  // image). Swatches and catalogue cards use the cached /img proxy.
  return url.replace("/storage/v1/object/public/", "/storage/v1/render/image/public/") +
    `?width=${width}&quality=70&resize=contain`;
}

function buildSchema(product, canonicalUrl, description, imageUrl) {
  const catName = product.product_categories?.name || "Memorial";
  const price = parseFloat(product.base_price);
  const productLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.name,
    description,
    image: imageUrl,
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
  return {
    productLd,
    breadcrumbLd: { "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: crumbs },
  };
}

function factsHtml(product, sizes) {
  return `<p>${escapeHtml(factsParagraph(product, sizes))}</p>`;
}

function breadcrumbHtml(product) {
  const catSlug = safeSlug(product.product_categories?.slug);
  const catName = String(product.product_categories?.name || "").replace(/\s+/g, " ").trim();
  const typeLink = catSlug && catName
    ? `<a href="/memorials?type=${catSlug}">${escapeHtml(catName)}</a><span>/</span>`
    : "";
  return `<a href="/">Home</a><span>/</span><a href="/memorials">Memorials</a><span>/</span>${typeLink}<span>${escapeHtml(product.name || "Memorial")}</span>`;
}

function relatedHtml(related, product) {
  const links = related.map((item) => {
    const slug = safeSlug(item.slug);
    const name = String(item.name || "").replace(/\s+/g, " ").trim();
    if (!slug || !name) return "";
    return `<li><a href="/memorials/${slug}">${escapeHtml(name)}</a></li>`;
  }).filter(Boolean);
  const catSlug = safeSlug(product?.product_categories?.slug);
  const catName = String(product?.product_categories?.name || "memorials").replace(/\s+/g, " ").trim();
  const seeAll = catSlug
    ? `<p><a href="/memorials?type=${catSlug}">See all ${escapeHtml(catName.toLowerCase())}</a></p>`
    : "";
  if (!links.length && !seeAll) return "";
  const heading = links.length ? "<h2>Related designs</h2>" : "";
  const list = links.length ? `<ul>${links.join("")}</ul>` : "";
  return `${heading}${list}${seeAll}`;
}

function gone() {
  return new Response("This memorial is no longer listed.", {
    status: 410,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "X-Robots-Tag": "noindex",
      "Cache-Control": "public, max-age=3600",
    },
  });
}

function moved(request, pathname) {
  const incoming = new URL(request.url);
  const target = new URL(pathname, incoming.origin);
  for (const [key, value] of incoming.searchParams) {
    if (!target.searchParams.has(key)) target.searchParams.append(key, value);
  }
  const search = target.searchParams.toString();
  return new Response(null, {
    status: 301,
    headers: {
      Location: target.pathname + (search ? `?${search}` : ""),
      "X-Robots-Tag": "noindex",
      "Cache-Control": "public, max-age=3600",
    },
  });
}

export async function onRequestGet({ request, env, params, waitUntil }) {
  const slug = params && params.slug;
  const shellUrl = new URL("/memorial.html", request.url);
  if (!slug) return env.ASSETS.fetch(shellUrl);

  const hit = await cachedHtml(request);
  if (hit) return hit;

  const product = await fetchProduct(env, slug);
  if (product === NOT_FOUND) {
    const legacy = legacySlugStatus(String(slug).toLowerCase());
    if (legacy === 410) return gone();
    if (typeof legacy === "string") return moved(request, legacy);
    // Unknown or unlisted slug. 302 because the slug may be listed later.
    // The query string (gclid, gbraid, wbraid, utm_*) is kept verbatim.
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
  // Supabase was unreachable. Serve the shell and do not cache it.
  if (!product) return env.ASSETS.fetch(shellUrl);

  // Shell, sizes and related overlap. A failed sizes or related read still
  // renders (empty list), but that 200 must not be stored: the header is
  // chosen only after both reads have settled.
  const [shell, sizes, related] = await Promise.all([
    env.ASSETS.fetch(shellUrl),
    fetchSizes(env, product.id),
    fetchRelated(env, product),
  ]);
  const catalogueOk = sizes.ok && related.ok;

  const canonicalUrl = `${BASE}/memorials/${encodeURIComponent(product.slug)}`;
  const title = productTitle(product);
  const desc = productDescription(product);
  const imageUrl = absoluteImage(env, product.image_url) || SHARE_IMAGE;
  const lcp = renderSrc(imageUrl, 800);
  const srcset = imageUrl.includes("/storage/v1/object/public/")
    ? [400, 800, 1200].map((width) => `${renderSrc(imageUrl, width)} ${width}w`).join(", ")
    : "";
  const categoryName = product.product_categories?.name || "Memorial";
  const shortDescription = String(product.short_description || "").trim();
  let longDescription = String(product.description || "").trim();
  if (shortDescription && longDescription.startsWith(shortDescription)) {
    longDescription = longDescription.slice(shortDescription.length).trim();
  }
  const lead = shortDescription || longDescription || "Hand-finished memorial, professionally installed.";
  const price = parseFloat(product.base_price);
  const displayedPrice = Number.isFinite(price)
    ? `From £${price.toLocaleString("en-GB")}`
    : "Guide price on request";
  const { productLd, breadcrumbLd } = buildSchema(product, canonicalUrl, desc, imageUrl);
  // 50vw at 820px and 2x is 820 device pixels and selects the 1200w file.
  // The 769–1024 frame is 220px tall, so a 400px slot (800w at 2x) is enough.
  const gallerySizes = "(max-width: 768px) 100vw, (max-width: 1024px) 400px, 50vw";
  const preload = srcset
    ? `<link rel="preload" as="image" href="${escapeHtml(lcp)}" imagesrcset="${escapeHtml(srcset)}" imagesizes="${gallerySizes}" fetchpriority="high">`
    : `<link rel="preload" as="image" href="${escapeHtml(lcp)}" fetchpriority="high">`;

  const response = new HTMLRewriter()
    .on("title", { element(el) { el.setInnerContent(title); } })
    // LCP image preload goes straight after the viewport meta, which memorial.html keeps
    // at the very top of <head>: the preload scanner finds it before the consent/GTM
    // inline scripts and stylesheets, and imagesizes resolves against the phone
    // viewport (before the viewport meta it picks the 1200w file and the img then
    // downloads 800w as well).
    .on('meta[name="viewport"]', { element(el) { el.after(preload, { html: true }); } })
    .on('meta[name="description"]', { element(el) { el.setAttribute("content", desc); } })
    .on('link[rel="canonical"]', { element(el) { el.setAttribute("href", canonicalUrl); } })
    .on('meta[property="og:title"]', { element(el) { el.setAttribute("content", title); } })
    .on('meta[property="og:description"]', { element(el) { el.setAttribute("content", desc); } })
    .on('meta[property="og:url"]', { element(el) { el.setAttribute("content", canonicalUrl); } })
    .on('meta[property="og:image"]', { element(el) { el.setAttribute("content", imageUrl); } })
    .on('meta[name="twitter:title"]', { element(el) { el.setAttribute("content", title); } })
    .on('meta[name="twitter:description"]', { element(el) { el.setAttribute("content", desc); } })
    .on('meta[name="twitter:image"]', { element(el) { el.setAttribute("content", imageUrl); } })
    .on("script#breadcrumbJsonLd", { element(el) { el.setInnerContent(JSON.stringify(breadcrumbLd), { html: false }); } })
    .on("script#productJsonLd", { element(el) { el.setInnerContent(JSON.stringify(productLd), { html: false }); } })
    .on("#productName", { element(el) { el.setInnerContent(product.name || "Memorial", { html: false }); } })
    .on("#productCategory", { element(el) { el.setInnerContent(categoryName, { html: false }); } })
    .on("#productLead", { element(el) { el.setInnerContent(lead, { html: false }); } })
    .on("#productDescription", { element(el) { el.setInnerContent(longDescription, { html: false }); } })
    .on("#productFacts", { element(el) { el.setInnerContent(factsHtml(product, sizes.rows), { html: true }); } })
    .on("#breadcrumb", { element(el) { el.setInnerContent(breadcrumbHtml(product), { html: true }); } })
    .on("#relatedDesigns", { element(el) { el.setInnerContent(relatedHtml(related.rows, product), { html: true }); } })
    .on("#priceTotal", { element(el) { el.setInnerContent(displayedPrice, { html: false }); } })
    .on("#mobilePriceTotal", { element(el) { el.setInnerContent(displayedPrice, { html: false }); } })
    .on("#galleryMainImg", {
      element(el) {
        el.setAttribute("src", lcp);
        el.setAttribute("alt", product.name || "Memorial");
        if (srcset) {
          el.setAttribute("srcset", srcset);
          el.setAttribute("sizes", "(max-width: 768px) 100vw, (max-width: 1024px) 400px, 50vw");
        }
      },
    })
    .transform(new Response(shell.body, {
      status: shell.status,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": catalogueOk ? "public, max-age=300, stale-while-revalidate=3600" : "no-store",
        "X-SM-HTML": HTML_CACHE_GENERATION,
      },
    }));
  return storeHtml(request, response, waitUntil);
}
