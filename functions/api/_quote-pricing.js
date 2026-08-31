import { supabaseHeaders } from "./_security.js";

const SLUG_RE = /^[a-z0-9-]{1,120}$/;
const INFILL_PRICES = Object.freeze({ none: 0, soil: 80, coverslab: 950, chippings: 250 });
const PHOTO_OPTIONS = Object.freeze({
  oval: { label: "Oval", price: 160 },
  rectangle: { label: "Rectangle", price: 200 },
  heart: { label: "Heart", price: 240 },
});
const LEGACY_PHOTO_CODES = Object.freeze({ small: "oval", medium: "rectangle", large: "heart" });

export class QuotePricingError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = "QuotePricingError";
    this.status = status;
  }
}

function money(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number * 100) / 100 : 0;
}

function boundedText(value, max = 1000) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function sameChoice(value, row) {
  const normalised = boundedText(value, 160).toLowerCase();
  return normalised && [row?.slug, row?.name].some(candidate => String(candidate || "").toLowerCase() === normalised);
}

function premiumColourSurcharge(categorySlug) {
  if (categorySlug === "kerb-sets") return 550;
  if (categorySlug === "cremation-memorials") return 90;
  return 200;
}

function displaySize(size) {
  if (!size) return "";
  return `${size.size_name || ""}${size.dimensions ? ` (${size.dimensions})` : ""}`.trim();
}

function requestedAddonSlugs(rawProduct) {
  if (!Array.isArray(rawProduct?.addonSlugs)) return [];
  return [...new Set(rawProduct.addonSlugs
    .filter(value => typeof value === "string")
    .map(value => value.trim().toLowerCase())
    .filter(Boolean))];
}

function legacyAddonSelected(rawProduct, addon) {
  if (!Array.isArray(rawProduct?.addons)) return false;
  const name = String(addon.name || "").toLowerCase();
  return rawProduct.addons.some(value => String(value || "").toLowerCase().split(" — ")[0] === name);
}

function selectedPhotoCode(rawProduct) {
  const requested = boundedText(rawProduct?.photoSize, 30).toLowerCase() || "oval";
  return LEGACY_PHOTO_CODES[requested] || requested;
}

function hasLegacyAddon(rawProduct, prefix) {
  return Array.isArray(rawProduct?.addons)
    && rawProduct.addons.some(value => String(value || "").toLowerCase().startsWith(prefix));
}

export function calculateCanonicalQuoteProduct(rawProduct, catalogue) {
  if (!rawProduct || typeof rawProduct !== "object" || Array.isArray(rawProduct)) {
    throw new QuotePricingError("Invalid product configuration");
  }
  const product = catalogue?.product;
  if (!product || !SLUG_RE.test(String(product.slug || "")) || rawProduct.slug !== product.slug) {
    throw new QuotePricingError("This memorial is not available for online quotes");
  }

  const category = product.product_categories || {};
  const categorySlug = String(category.slug || "");
  const sizes = Array.isArray(catalogue.sizes) ? catalogue.sizes : [];
  const colours = Array.isArray(catalogue.colours) ? catalogue.colours : [];
  const addons = Array.isArray(catalogue.addons) ? catalogue.addons : [];

  let size = null;
  const sizeCode = boundedText(rawProduct.sizeCode, 80).toLowerCase();
  if (sizeCode) size = sizes.find(row => String(row.size_code || "").toLowerCase() === sizeCode);
  if (!size && rawProduct.size) {
    const submittedSize = boundedText(rawProduct.size, 160).toLowerCase();
    size = sizes.find(row => displaySize(row).toLowerCase() === submittedSize
      || submittedSize.startsWith(String(row.size_name || "").toLowerCase()));
  }
  if (!size) size = sizes.find(row => row.is_default) || sizes[0] || null;
  if (sizes.length && !size) throw new QuotePricingError("The selected memorial size is unavailable");

  const submittedColour = rawProduct.colour || rawProduct.colourSlug;
  const colour = colours.find(row => sameChoice(submittedColour, row));
  if (!colour) throw new QuotePricingError("The selected stone colour is unavailable");

  const lineItems = [];
  const basePrice = money(product.base_price);
  const sizeAdjustment = money(size?.price_adjustment);
  if (sizeAdjustment) lineItems.push({ name: `${size.size_name || "Selected"} size adjustment`, price: sizeAdjustment });

  const colourPrice = colour.is_premium ? premiumColourSurcharge(categorySlug) : 0;
  if (colourPrice) lineItems.push({ name: `Premium stone — ${colour.name}`, price: colourPrice });

  const requestedSlugs = requestedAddonSlugs(rawProduct);
  const specialSlugs = new Set(["photo-plaque", "garden-kerb", "garden-kerb-surround"]);
  for (const slug of requestedSlugs) {
    if (specialSlugs.has(slug)) continue;
    if (!addons.some(addon => addon.slug === slug)) {
      throw new QuotePricingError("One of the selected extras is unavailable");
    }
  }

  const selectedAddonSlugs = [];
  for (const addon of addons) {
    if (specialSlugs.has(addon.slug)) continue;
    if (!requestedSlugs.includes(addon.slug) && !legacyAddonSelected(rawProduct, addon)) continue;
    const addonPrice = money(addon.price);
    selectedAddonSlugs.push(addon.slug);
    if (addonPrice) lineItems.push({ name: boundedText(addon.name, 120), price: addonPrice });
  }

  const photoRequested = rawProduct.photoActive === true
    || requestedSlugs.includes("photo-plaque")
    || hasLegacyAddon(rawProduct, "ceramic photo plaque");
  let photoCode;
  if (photoRequested) {
    if (!addons.some(addon => addon.slug === "photo-plaque")) {
      throw new QuotePricingError("The photo plaque option is unavailable");
    }
    photoCode = selectedPhotoCode(rawProduct);
    const photo = PHOTO_OPTIONS[photoCode];
    if (!photo) throw new QuotePricingError("The selected photo plaque is unavailable");
    lineItems.push({ name: `Ceramic Photo Plaque — ${photo.label}`, price: photo.price });
  }

  const gardenKerbAllowed = categorySlug !== "kerb-sets" && categorySlug !== "cremation-memorials";
  const gardenKerbRequested = rawProduct.gardenKerb === true
    || requestedSlugs.includes("garden-kerb")
    || requestedSlugs.includes("garden-kerb-surround")
    || hasLegacyAddon(rawProduct, "garden kerb surround");
  const gardenKerb = gardenKerbAllowed && gardenKerbRequested;
  if (gardenKerb) lineItems.push({ name: "Garden Kerb Surround", price: 350 });

  let infillType;
  let infillColour;
  if (categorySlug === "kerb-sets") {
    const requestedInfill = boundedText(rawProduct.infillType, 30).toLowerCase() || "chippings";
    if (!Object.hasOwn(INFILL_PRICES, requestedInfill)) {
      throw new QuotePricingError("The selected kerb infill is unavailable");
    }
    infillType = requestedInfill;
    infillColour = boundedText(rawProduct.infillColour, 40).toLowerCase() || "white";
    const infillPrice = INFILL_PRICES[infillType];
    if (infillPrice) {
      const typeLabel = infillType.charAt(0).toUpperCase() + infillType.slice(1);
      const colourLabel = infillColour.charAt(0).toUpperCase() + infillColour.slice(1);
      const suffix = infillType === "chippings" ? ` (${colourLabel})` : "";
      lineItems.push({ name: `Kerb Infill — ${typeLabel}${suffix}`, price: infillPrice });
    }
  }

  const inscription = boundedText(rawProduct.inscription, 1000);
  const includedCharacters = Math.max(0, Number(product.inscription_chars_included) || 80);
  const pricePerCharacter = money(product.inscription_price_per_char || 2.40);
  const extraCharacters = Math.max(0, inscription.length - includedCharacters);
  const letteringPrice = money(extraCharacters * pricePerCharacter);
  if (letteringPrice) lineItems.push({ name: "Extra Lettering", price: letteringPrice });

  const total = money(basePrice + lineItems.reduce((sum, item) => sum + item.price, 0));
  const canonical = {
    name: boundedText(product.name, 160),
    slug: product.slug,
    type: boundedText(category.name || "Memorial", 120),
    colour: boundedText(colour.name, 80),
    colourSlug: boundedText(colour.slug, 80),
    size: displaySize(size),
    sizeCode: boundedText(size?.size_code, 80),
    addons: lineItems.map(item => item.name),
    addonSlugs: selectedAddonSlugs,
    addonLineItems: lineItems,
    inscription,
    font: ["traditional", "script"].includes(rawProduct.font) ? rawProduct.font : "traditional",
    letterColour: ["gold", "white", "silver", "black"].includes(rawProduct.letterColour) ? rawProduct.letterColour : "gold",
    price: total,
    permit_fee: 0,
    image: boundedText(product.image_url, 500),
  };
  if (photoRequested) {
    canonical.photoActive = true;
    canonical.photoSize = photoCode;
  }
  if (gardenKerb) canonical.gardenKerb = true;
  if (infillType) {
    canonical.infillType = infillType;
    canonical.infillColour = infillColour;
  }
  return canonical;
}

async function getJson(response, errorMessage) {
  if (!response.ok) throw new QuotePricingError(errorMessage, 503);
  return response.json();
}

export async function canonicaliseQuoteProduct(env, rawProduct) {
  const slug = typeof rawProduct?.slug === "string" ? rawProduct.slug.toLowerCase().trim() : "";
  if (!SLUG_RE.test(slug)) throw new QuotePricingError("This memorial is not available for online quotes");

  const headers = supabaseHeaders(env);
  const base = env.SUPABASE_URL;
  const productParams = new URLSearchParams({
    slug: `eq.${slug}`,
    organization_id: `eq.${env.SM_ORG_ID}`,
    is_active: "eq.true",
    is_listed: "eq.true",
    category_id: "not.is.null",
    select: "id,name,slug,base_price,image_url,inscription_chars_included,inscription_price_per_char,product_categories(name,slug)",
    limit: "1",
  });
  const [products, colours, addons] = await Promise.all([
    fetch(`${base}/rest/v1/products?${productParams}`, { headers }).then(res => getJson(res, "Unable to verify this memorial")),
    fetch(`${base}/rest/v1/stone_colours?is_active=eq.true&select=name,slug,is_premium,tier&order=display_order.asc`, { headers })
      .then(res => getJson(res, "Unable to verify stone colours")),
    fetch(`${base}/rest/v1/product_addons?is_active=eq.true&select=name,slug,price&order=display_order.asc`, { headers })
      .then(res => getJson(res, "Unable to verify optional extras")),
  ]);
  const product = products[0];
  if (!product) throw new QuotePricingError("This memorial is not available for online quotes");
  const sizeParams = new URLSearchParams({
    product_id: `eq.${product.id}`,
    select: "size_name,size_code,dimensions,price_adjustment,is_default,display_order",
    order: "display_order.asc",
  });
  const sizesResponse = await fetch(`${base}/rest/v1/product_sizes?${sizeParams}`, { headers });
  const sizes = await getJson(sizesResponse, "Unable to verify memorial sizes");
  return calculateCanonicalQuoteProduct({ ...rawProduct, slug }, { product, sizes, colours, addons });
}
