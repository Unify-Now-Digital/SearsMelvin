/** Server-render every listed memorial. The phone's first row is eager; later images are lazy. */

import { publishableKey, publicSupabaseUrl, supabaseKeyHeaders } from "./api/_supabase-keys.js";

const SM_ORG_ID = "3770972d-1bbd-417b-b413-297e844db285";

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
    const supabase = publicSupabaseUrl({});
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

const IMAGE_SIZES = "(max-width: 1023px) 50vw, (max-width: 1279px) 33vw, 25vw";

function isBucketImage(url) {
  return new RegExp('/' + ['storage','v1','object','public','product-images'].join('/') + '/[^?]+$').test(url);
}

function renderImageUrl(url, width) {
  return url.replace("/storage/v1/object/public/", "/storage/v1/render/image/public/") +
    `?width=${width}&quality=70&resize=contain`;
}

function imageSources(url) {
  const srcset = [400, 800, 1200].map((width) => `${escapeHtml(renderImageUrl(url, width))} ${width}w`).join(", ");
  return { src: escapeHtml(renderImageUrl(url, 800)), srcset, sizes: IMAGE_SIZES };
}

function imageAttributes(url) {
  if (!isBucketImage(url)) return `src="${escapeHtml(url)}"`;
  const { src, srcset, sizes } = imageSources(url);
  return `src="${src}" srcset="${srcset}" sizes="${sizes}" data-fallback="${escapeHtml(url)}" onerror="this.onerror=null;this.removeAttribute('srcset');this.src=this.dataset.fallback"`;
}

function imagePreload(url) {
  if (!url) return "";
  if (!isBucketImage(url)) {
    return `<link rel="preload" as="image" href="${escapeHtml(url)}" fetchpriority="high">`;
  }
  // Same src, srcset and sizes as the first card, so the browser fetches one file.
  const { src, srcset, sizes } = imageSources(url);
  return `<link rel="preload" as="image" href="${src}" imagesrcset="${srcset}" imagesizes="${sizes}" fetchpriority="high">`;
}

export function typeCounts(products) {
  const visible = listableProducts(products);
  const counts = { all: visible.length };
  for (const product of visible) {
    const slug = safeSlug(product.product_categories?.slug);
    if (!slug) continue;
    counts[slug] = (counts[slug] || 0) + 1;
  }
  return counts;
}

function stonesLabel(count) {
  const n = Number(count) || 0;
  return `All ${n} ${n === 1 ? "stone" : "stones"}`;
}

function cardAccessibleName(name, category, stoneCount, price) {
  const amount = Number(price).toLocaleString("en-GB");
  return `${name}, ${category}, ${stonesLabel(stoneCount)}, From £${amount}`;
}

function colourWord(count) {
  return Number(count) === 1 ? "stone colour" : "stone colours";
}

function colourTier(colour) {
  return colour.tier || (colour.is_premium ? "premium" : "standard");
}

function stoneInlineButton(colour, pressed) {
  const name = escapeHtml(String(colour.name || "").slice(0, 80));
  const slug = safeSlug(colour.slug);
  const primary = safeHex(colour.hex_primary);
  const secondary = safeHex(colour.hex_secondary || colour.hex_primary);
  const imageUrl = safeImageUrl(colour.image_url);
  const photo = imageUrl
    ? `<img class="colour-swatch-photo" src="${escapeHtml(imageUrl)}" alt="" width="44" height="44" decoding="async" onerror="this.parentElement.classList.remove('has-photo');this.remove()">`
    : "";
  const label = name || "Stone colour";
  const tier = escapeHtml(colourTier(colour));
  return `<button type="button" class="listing-stone-inline-swatch" data-slug="${slug}" data-name="${name}" data-primary="${primary}" data-secondary="${secondary}" data-tier="${tier}"${imageUrl ? ` data-image="${escapeHtml(imageUrl)}"` : ""} aria-label="${label}" aria-pressed="${pressed ? "true" : "false"}"><span class="listing-stone-chip${photo ? " has-photo" : ""}" style="background:linear-gradient(145deg, ${primary}, ${secondary})">${photo}</span></button>`;
}

export function stoneInlineMarkup(colours) {
  const list = Array.isArray(colours) ? colours : [];
  return list.map((colour, index) => stoneInlineButton(colour, index === 0)).join("");
}

// The lead box shows the default-selected colour (first in display order) so
// the strip paints with no layout shift before the client's tap handler runs.
export function stoneInlineLeadMarkup(colour) {
  if (!colour) return { photoStyle: "", photoInner: "", name: "", slug: "" };
  const primary = safeHex(colour.hex_primary);
  const secondary = safeHex(colour.hex_secondary || colour.hex_primary);
  const imageUrl = safeImageUrl(colour.image_url);
  const photoInner = imageUrl
    ? `<img class="colour-swatch-photo" src="${escapeHtml(imageUrl)}" alt="" width="70" height="70" decoding="async" onerror="this.remove()">`
    : "";
  return {
    photoStyle: `background:linear-gradient(145deg, ${primary}, ${secondary})`,
    photoInner,
    name: String(colour.name || "").slice(0, 80) || "Stone colour",
    slug: safeSlug(colour.slug),
  };
}

export function stoneBandMarkup(colours) {
  const list = Array.isArray(colours) ? colours : [];
  const swatches = list.map((colour) => {
    const name = escapeHtml(String(colour.name || "").slice(0, 80));
    const slug = safeSlug(colour.slug);
    const primary = safeHex(colour.hex_primary);
    const secondary = safeHex(colour.hex_secondary || colour.hex_primary);
    const imageUrl = safeImageUrl(colour.image_url);
    const photo = imageUrl
      ? `<img class="colour-swatch-photo" src="${escapeHtml(imageUrl)}" alt="" width="76" height="32" decoding="async" onerror="this.parentElement.classList.remove('has-photo');this.remove()">`
      : "";
    return `<div class="stone-swatch" role="listitem"${slug ? ` data-colour="${slug}"` : ""}><span class="stone-swatch-chip${photo ? " has-photo" : ""}" style="background:linear-gradient(145deg, ${primary}, ${secondary})">${photo}</span><span class="stone-swatch-name">${name}</span></div>`;
  }).join("");
  return `<div class="stone-band" id="stoneBand"><p class="stone-band-lead">Every design comes in all <span id="stoneColourCount">${list.length}</span> ${colourWord(list.length)}</p><div class="stone-swatches" id="stoneSwatches" role="list" aria-label="Stone colours">${swatches}</div></div>`;
}

async function fetchCatalogue(env) {
  const base = publicSupabaseUrl(env);
  const headers = supabaseKeyHeaders(publishableKey(env));
  const org = encodeURIComponent(env.SM_ORG_ID || SM_ORG_ID);
  const [productsResponse, coloursResponse] = await Promise.all([
    fetch(`${base}/rest/v1/products?organization_id=eq.${org}&is_active=eq.true&is_listed=eq.true&category_id=not.is.null&select=*,product_categories(name,slug)&order=display_order`, { headers }),
    fetch(`${base}/rest/v1/stone_colours?is_active=eq.true&select=*&order=display_order`, { headers }),
  ]);
  if (!productsResponse.ok || !coloursResponse.ok) return null;
  const [products, colours] = await Promise.all([productsResponse.json(), coloursResponse.json()]);
  return Array.isArray(products) && Array.isArray(colours) ? { products, colours } : null;
}

// Two columns is the first row below 1024px. memorials.html raises this
// to three or four once it knows the viewport. Later images stay lazy.
const NARROW_FIRST_ROW = 2;

export function listableProducts(products) {
  const seen = new Set();
  const out = [];
  for (const product of products || []) {
    const slug = safeSlug(product.slug);
    const id = safeId(product.id);
    const price = parseFloat(product.base_price);
    if (!slug || !id || seen.has(slug)) continue;
    if (!Number.isFinite(price) || price < 0 || price > 1000000) continue;
    seen.add(slug);
    out.push(product);
  }
  return out;
}

export function catalogueInjection(products, colours) {
  const visible = listableProducts(products);
  const cards = renderCards(visible, colours);
  const grid = `${cards}${stoneBandMarkup(colours)}<div class="no-results" id="noResults" style="display: none;"><h3>No memorials found</h3><p>Try adjusting your filters to find the right memorial.</p><button type="button" onclick="clearAllFilters()">Clear all filters</button></div>`;
  return {
    grid,
    inline: stoneInlineMarkup(colours),
    lead: stoneInlineLeadMarkup(colours[0]),
    count: visible.length,
  };
}

function renderCards(products, colours) {
  const colourSlugs = colours.map((colour) => safeSlug(colour.slug)).filter(Boolean).join(",");
  const colourDots = `<span class="product-stones">${stonesLabel(colours.length)}</span>`;

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
    // Only the first photo is high priority, and it is not decoding="async":
    // async decode was holding the largest paint until after the file had arrived.
    const priority = index === 0
      ? ' loading="eager" fetchpriority="high"'
      : index < NARROW_FIRST_ROW
        ? ' loading="eager" fetchpriority="low" decoding="async"'
        : ' loading="lazy" decoding="async"';
    const image = imageUrl ? `<img ${imageAttributes(imageUrl)} width="800" height="800" alt=""${priority}>` : "";
    const badge = product.is_featured ? `<span class="product-badge" aria-hidden="true">${index === 0 ? "Popular" : "Best Value"}</span>` : "";
    return `<a href="/memorials/${slug}" class="product-card" data-id="${id}" data-type="${categorySlug}" data-colours="${colourSlugs}" data-price="${priceRange}" data-price-value="${price}" data-name="${escapeHtml(productName)}" data-image="${escapeHtml(imageUrl)}" data-slug="${slug}" aria-label="${escapeHtml(cardAccessibleName(productName, categoryName, colours.length, price))}"><div class="product-face"><div class="product-actions"><button class="product-action save-btn" onclick="event.preventDefault(); event.stopPropagation(); toggleSave(this)" title="Save ${escapeHtml(productName)}" aria-label="Save ${escapeHtml(productName)}"><svg viewBox="0 0 24 24"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg></button></div><div class="product-image">${image}${badge}</div><div class="product-info" aria-hidden="true"><span class="product-category">${escapeHtml(categoryName)}</span><h3 class="product-name">${escapeHtml(productName)}</h3><div class="product-meta"><div class="product-colours">${colourDots}</div></div><p class="product-price">From <strong>£${price.toLocaleString("en-GB")}</strong></p></div></div></a>`;
  }).join("");
}

export async function onRequestGet({ request, env }) {
  const shell = await env.ASSETS.fetch(new URL("/memorials.html", request.url));
  let catalogue;
  try {
    catalogue = await fetchCatalogue(env);
  } catch {
    return shell;
  }
  if (!catalogue || catalogue.products.length === 0) return shell;
  const counts = typeCounts(catalogue.products);
  const requested = safeSlug(new URL(request.url).searchParams.get("type"));
  let products = catalogue.products;
  if (requested) {
    const filtered = products.filter((product) => safeSlug(product.product_categories?.slug) === requested);
    if (filtered.length) products = filtered;
  }
  const visible = listableProducts(products);
  const { grid, inline, lead, count } = catalogueInjection(products, catalogue.colours);
  const preload = visible[0] ? imagePreload(safeImageUrl(visible[0].image_url)) : "";
  const typeName = requested && products !== catalogue.products
    ? String(products.find((product) => product.product_categories?.name)?.product_categories.name || "").replace(/\s+/g, " ").trim()
    : "";
  // The canonical stays the link in the shell (/memorials), including when ?type= is set.
  let rewriter = new HTMLRewriter()
    .on("#productsGrid", { element(el) { el.setInnerContent(grid, { html: true }); } })
    .on("#listingStoneInlineRow", { element(el) { el.setInnerContent(inline, { html: true }); } })
    .on("#listingStoneInlineLead", { element(el) { el.setAttribute("data-slug", lead.slug); } })
    .on("#listingStoneInlineLeadPhoto", {
      element(el) {
        el.setAttribute("style", lead.photoStyle);
        el.setInnerContent(lead.photoInner, { html: true });
      },
    })
    .on("#listingStoneInlineLeadName", { element(el) { el.setInnerContent(lead.name); } })
    .on("#resultsCount", { element(el) { el.setInnerContent(String(count)); } })
    .on('.type-count[data-type-count="all"]', { element(el) { el.setInnerContent(String(counts.all)); } });
  for (const slug of Object.keys(counts)) {
    if (slug === "all") continue;
    const value = String(counts[slug]);
    rewriter = rewriter.on(`.type-count[data-type-count="${slug}"]`, {
      element(el) { el.setInnerContent(value); },
    });
  }
  if (preload) rewriter = rewriter.on("head", { element(el) { el.append(preload, { html: true }); } });
  if (!typeName) {
    rewriter = rewriter.on(".type-browse-list a.type-all", {
      element(el) { el.setAttribute("aria-current", "page"); },
    });
  }
  if (typeName) {
    rewriter = rewriter.on(`a[href="/memorials?type=${requested}"]`, {
      element(el) { el.setAttribute("aria-current", "page"); },
    });
  }
  return rewriter.transform(shell);
}
