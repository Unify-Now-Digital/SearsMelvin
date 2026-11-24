/**
 * Product titles and meta descriptions, generated from catalogue fields.
 * Used by the product Function and by memorial.html so a rendered page
 * does not replace the server text with a different string.
 *
 * Titles stay within 60 characters. Descriptions stay within 140–155
 * characters, in whole sentences, with no ellipsis.
 */

export const SHARE_IMAGE = "https://searsmelvin.co.uk/images/brand/share-card.jpg";

const TYPE_WORD = {
  "lawn-headstones": "headstone",
  "kerb-sets": "kerb set",
  "cremation-memorials": "cremation memorial",
  "childrens-memorials": "children's memorial",
  "churchyard-memorials": "churchyard memorial",
  "heart-memorials": "heart memorial",
  "book-memorials": "book memorial",
};

const PLACE = "Installation across Greater London and surrounds.";
const PERMITS = "We help with cemetery permits.";

export function typeWord(categorySlug) {
  return TYPE_WORD[categorySlug] || "memorial";
}

export function guidePrice(value) {
  const price = Number(value);
  if (!Number.isFinite(price)) return "";
  return `£${Math.round(price).toLocaleString("en-GB")}`;
}

export function productTitle(product) {
  const name = String(product?.name || "Memorial").replace(/\s+/g, " ").trim() || "Memorial";
  const type = typeWord(product?.product_categories?.slug);
  const price = guidePrice(product?.base_price);
  const brand = "Sears Melvin";
  const withPrice = price ? `${name} ${type}, from ${price} | ${brand}` : "";
  const withType = `${name} ${type} | ${brand}`;
  const nameOnly = `${name} | ${brand}`;
  for (const title of [withPrice, withType, nameOnly]) {
    if (title && title.length <= 60) return title;
  }
  const suffix = ` | ${brand}`;
  const room = Math.max(1, 60 - suffix.length);
  return `${name.slice(0, room).trim()} | ${brand}`.slice(0, 60);
}

function coreDescription(name, type, price) {
  const from = price ? `from ${price}` : "with a guide price on request";
  return `${name} is a ${type} ${from}. ${PLACE} ${PERMITS}`;
}

const PADS = [
  "Stone, lettering and installation are included.",
  "The stone and lettering are included.",
  "Lettering is included.",
  "Installation is included.",
  "Stone included.",
  "Lettering included.",
];

export function productDescription(product) {
  const name = String(product?.name || "This memorial").replace(/\s+/g, " ").trim() || "This memorial";
  const type = typeWord(product?.product_categories?.slug);
  const price = guidePrice(product?.base_price);
  let text = coreDescription(name, type, price);
  if (text.length > 155) {
    const from = price ? `from ${price}` : "with a guide price on request";
    text = `${name} is a ${type} ${from}. Across Greater London and surrounds. ${PERMITS}`;
  }
  if (text.length > 155) {
    const from = price ? `From ${price}` : "A guide price is available on request";
    const label = type.charAt(0).toUpperCase() + type.slice(1);
    text = `${label} ${from.charAt(0).toLowerCase()}${from.slice(1)}. ${PLACE} ${PERMITS}`;
    if (!price) text = `${label}. ${PLACE} ${PERMITS}`;
  }
  if (text.length < 140) {
    for (const pad of PADS) {
      const next = `${text} ${pad}`;
      if (next.length >= 140 && next.length <= 155) return next;
    }
    for (const pad of PADS) {
      const next = `${text} ${pad}`;
      if (next.length <= 155 && next.length > text.length) text = next;
    }
  }
  if (text.length > 155) {
    text = `${type.charAt(0).toUpperCase()}${type.slice(1)} from ${price || "the guide price"}. ${PLACE} ${PERMITS}`;
  }
  return text;
}

const STONE_STOP = /^(?:in|of|with|and|the|a|an|shown)\s+/;

export function stonePhrase(product) {
  const text = `${product?.short_description || ""} ${product?.description || ""}`;
  const match = text.match(/\b((?:pale |dark |light |polished |honed )?(?:[a-z]+ ){0,3}(?:granite|marble|slate))\b/i);
  if (!match) return "";
  let phrase = match[1].replace(/\s+/g, " ").trim().toLowerCase();
  while (STONE_STOP.test(phrase)) phrase = phrase.replace(STONE_STOP, "");
  return phrase;
}

// The required pattern, plus the plural and hyphenated spellings in the catalogue.
const VASE_COPY = /\bflower vase\b|\bvase\b|\bvases\b|\bflower-vase\b|\bflower-vases\b/i;

export function visibleFeatures(features) {
  return (Array.isArray(features) ? features : [])
    .map((item) => String(item).replace(/\s+/g, " ").trim())
    .filter((item) => item && !VASE_COPY.test(item));
}

export function factsParagraph(product, sizes) {
  const name = String(product?.name || "This memorial").replace(/\s+/g, " ").trim();
  const type = typeWord(product?.product_categories?.slug);
  const price = guidePrice(product?.base_price);
  const stone = stonePhrase(product);
  const stoneBit = stone ? ` in ${stone}` : "";
  const priceBit = price ? ` from ${price}` : "";
  const features = visibleFeatures(product?.included_features).slice(0, 4);
  const featureBit = features.length ? ` Included: ${features.join(", ")}.` : "";
  return `${name} is a ${type}${stoneBit}${priceBit}. ${PLACE} ${PERMITS}${featureBit}`;
}

if (typeof window !== "undefined") {
  window.SMProductCopy = { typeWord, guidePrice, productTitle, productDescription, stonePhrase, factsParagraph, visibleFeatures, SHARE_IMAGE };
}
