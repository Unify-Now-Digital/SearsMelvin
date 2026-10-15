/** Server-render the unfiltered memorial catalogue for non-JavaScript crawlers. */

const PUBLIC_SUPABASE_URL = "https://bfwohzcugtwbhhxdqgme.supabase.co";
const SM_ORG_ID = "3770972d-1bbd-417b-b413-297e844db285";
const PUBLIC_SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJmd29oemN1Z3R3YmhoeGRxZ21lIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjgyMDA0NTIsImV4cCI6MjA4Mzc3NjQ1Mn0.QbEq1y3hczoRzcCrdajPmpPNkeh5A7jkAsfHP9BSAGg";

function escapeHtml(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

function safeSlug(value) {
  const slug = String(value == null ? "" : value).toLowerCase();
  return /^[a-z0-9-]{1,120}$/.test(slug) ? slug : "";
}

function safeId(value) {
  const id = String(value == null ? "" : value);
  return /^[a-zA-Z0-9_-]{1,80}$/.test(id) ? id : "";
}

function safeHex(value) {
  const hex = String(value == null ? "" : value);
  return /^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/i.test(hex) ? hex : "#d0cbc3";
}

function safeImageUrl(value) {
  if (!value || String(value).length > 2048) return "";
  try {
    const url = new URL(String(value), "https://searsmelvin.co.uk");
    return url.protocol === "https:" && !url.username && !url.password ? url.href : "";
  } catch {
    return "";
  }
}

function imageAttributes(url) {
  if (!/\/storage\/v1\/object\/public\/product-images\/[^?]+$/.test(url)) {
    return `src="${escapeHtml(url)}"`;
  }
  const render = (width) => url.replace("/storage/v1/object/public/", "/storage/v1/render/image/public/") +
    `?width=${width}&quality=70&resize=contain`;
  const srcset = [400, 800, 1200].map((width) => `${escapeHtml(render(width))} ${width}w`).join(", ");
  return `src="${escapeHtml(render(800))}" srcset="${srcset}" sizes="(max-width: 600px) 50vw, (max-width: 1024px) 33vw, 300px" data-fallback="${escapeHtml(url)}" onerror="this.onerror=null;this.removeAttribute('srcset');this.src=this.dataset.fallback"`;
}

async function fetchCatalogue(env) {
  const base = env.SUPABASE_URL || PUBLIC_SUPABASE_URL;
  const key = env.SUPABASE_ANON_KEY || PUBLIC_SUPABASE_KEY;
  const headers = { apikey: key, Authorization: `Bearer ${key}` };
  const org = encodeURIComponent(env.SM_ORG_ID || SM_ORG_ID);
  const [productsResponse, coloursResponse] = await Promise.all([
    fetch(`${base}/rest/v1/products?organization_id=eq.${org}&is_active=eq.true&is_listed=eq.true&category_id=not.is.null&select=*,product_categories(name,slug)&order=display_order`, { headers }),
    fetch(`${base}/rest/v1/stone_colours?is_active=eq.true&select=*&order=display_order`, { headers }),
  ]);
  if (!productsResponse.ok || !coloursResponse.ok) return null;
  const [products, colours] = await Promise.all([productsResponse.json(), coloursResponse.json()]);
  return Array.isArray(products) && Array.isArray(colours) ? { products, colours } : null;
}

function renderCards(products, colours) {
  const colourSlugs = colours.map((colour) => safeSlug(colour.slug)).filter(Boolean).join(",");
  const colourDots = colours.map((colour) =>
    `<span class="product-colour-dot" style="background:${safeHex(colour.hex_primary)};"></span>`
  ).join("");

  return products.map((product, index) => {
    const id = safeId(product.id);
    const slug = safeSlug(product.slug);
    const price = parseFloat(product.base_price);
    if (!id || !slug || !Number.isFinite(price) || price < 0 || price > 1000000) return "";
    const categorySlug = safeSlug(product.product_categories?.slug) || "default";
    const categoryName = String(product.product_categories?.name || "Memorial").slice(0, 120);
    const productName = String(product.name || "").slice(0, 120);
    const imageUrl = safeImageUrl(product.image_url);
    const priceRange = price < 1000 ? "under-1000" : price >= 3000 ? "over-3000" : price < 1500 ? "1000-1500" : price < 2000 ? "1500-2000" : "2000-3000";
    const priority = index === 0 ? ' loading="eager" fetchpriority="high"' : ' loading="lazy"';
    const image = imageUrl ? `<img ${imageAttributes(imageUrl)} width="800" height="800" alt="${escapeHtml(productName)}" decoding="async"${priority}>` : "";
    const badge = product.is_featured ? `<span class="product-badge">${index === 0 ? "Popular" : "Best Value"}</span>` : "";
    return `<a href="/memorials/${slug}" class="product-card" data-id="${id}" data-type="${categorySlug}" data-colours="${colourSlugs}" data-price="${priceRange}" data-price-value="${price}" data-name="${escapeHtml(productName)}" data-image="${escapeHtml(imageUrl)}" data-slug="${slug}"><div class="product-actions"><button class="product-action save-btn" onclick="event.preventDefault(); event.stopPropagation(); toggleSave(this)" title="Save" aria-label="Save memorial"><svg viewBox="0 0 24 24"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg></button></div><div class="product-image">${image}${badge}</div><div class="product-info"><span class="product-category">${escapeHtml(categoryName)}</span><h3 class="product-name">${escapeHtml(productName)}</h3><div class="product-meta"><div class="product-colours">${colourDots}</div></div><p class="product-price">From <strong>£${price.toLocaleString("en-GB")}</strong></p><p class="product-price-note">Installed guide price · cemetery fees extra</p></div></a>`;
  }).join("");
}

export async function onRequestGet({ request, env }) {
  const shell = await env.ASSETS.fetch(new URL("/memorials.html", request.url));
  if (new URL(request.url).search) return shell;
  let catalogue;
  try {
    catalogue = await fetchCatalogue(env);
  } catch {
    return shell;
  }
  if (!catalogue || catalogue.products.length === 0) return shell;
  const cards = renderCards(catalogue.products, catalogue.colours);
  if (!cards) return shell;
  const fallback = `${cards}<div class="no-results" id="noResults" style="display: none;"><h3>No memorials found</h3><p>Try adjusting your filters to find the right memorial.</p></div>`;
  return new HTMLRewriter().on("#productsGrid", {
    element(el) { el.setInnerContent(fallback, { html: true }); },
  }).transform(shell);
}
