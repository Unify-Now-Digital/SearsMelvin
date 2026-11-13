import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { calculateCanonicalQuoteProduct } from "../functions/api/_quote-pricing.js";

const catalogue = {
  product: {
    id: "product-1",
    name: "The Castell",
    slug: "the-castell",
    base_price: 1450,
    image_url: "/images/castell.jpg",
    inscription_chars_included: 80,
    inscription_price_per_char: 1.95,
    product_categories: { name: "Lawn Memorials", slug: "lawn-memorials" },
  },
  sizes: [
    { size_name: "Standard", size_code: "standard", dimensions: "30 × 24", price_adjustment: 0, is_default: true },
  ],
  colours: [
    { name: "Black", slug: "black", is_premium: false },
    { name: "Black Galaxy", slug: "black-galaxy", is_premium: true },
  ],
  addons: [
    { name: "Ceramic Photo Plaque", slug: "photo-plaque", price: 160 },
    { name: "Flower Vase", slug: "flower-vase", price: 85 },
    { name: "Custom Motif", slug: "custom-motif", price: 120 },
  ],
};
const SM_ORG_ID = "3770972d-1bbd-417b-b413-297e844db285";

// A non-kerb memorial can never acquire the configurator's default £250 infill.
{
  const product = calculateCanonicalQuoteProduct({
    slug: "the-castell",
    colour: "Black",
    sizeCode: "standard",
    addonSlugs: ["flower-vase"],
    infillType: "chippings",
    infillColour: "black",
    price: "1",
    permit_fee: 999,
  }, catalogue);
  // The flower vase is retired: an old request for it is ignored, not charged.
  assert.equal(product.price, 1450);
  assert.equal(product.permit_fee, 0);
  assert.deepEqual(product.addonLineItems, []);
  assert.equal(product.infillType, undefined);
}

// Public catalogue reads are tenant-scoped and exclude unlisted/uncategorized rows.
{
  const publicSearchFiles = [
    "index.html", "contact.html", "terms.html", "privacy.html",
    "memorials.html", "quote.html", "resources.html", "care-guide.html", "faq.html",
    "memorial.html",
  ];
  for (const file of publicSearchFiles) {
    const html = await readFile(new URL(`../${file}`, import.meta.url), "utf8");
    assert.ok(html.includes(`products?organization_id=eq.${SM_ORG_ID}&is_active=eq.true&is_listed=eq.true&category_id=not.is.null&or=`), `${file} search is not catalogue-scoped`);
  }
  const catalogueHtml = await readFile(new URL("../memorials.html", import.meta.url), "utf8");
  assert.match(catalogueHtml, /organization_id:\s*'eq\.' \+ SM_ORG_ID, is_active:\s*'eq\.true', is_listed:\s*'eq\.true', category_id:\s*'not\.is\.null'/);
  const productRoute = await readFile(new URL("../functions/memorials/[slug].js", import.meta.url), "utf8");
  assert.match(productRoute, /organization_id=eq\..*is_listed=eq\.true&category_id=not\.is\.null/);
}

const hartwell = {
  ...catalogue,
  product: {
    ...catalogue.product,
    name: "The Hartwell",
    slug: "the-hartwell",
    base_price: 4140,
    product_categories: { name: "Kerb Sets", slug: "kerb-sets" },
  },
};

// A stored infill choice still prices, including when the browser total is stale.
{
  const product = calculateCanonicalQuoteProduct({
    slug: "the-hartwell",
    colour: "Black",
    sizeCode: "standard",
    infillType: "chippings",
    infillColour: "black",
    price: "4140",
  }, hartwell);
  assert.equal(product.price, 4390);
  assert.equal(product.infillType, "chippings");
  assert.equal(product.infillColour, "black");
  assert.deepEqual(product.addonLineItems, [
    { name: "Kerb Infill — Chippings (Black)", price: 250 },
  ]);
}

// A new kerb quote omits infill fields. The server adds no infill line and
// no £250, and it does not write infillType or infillColour onto the quote.
{
  const charnwood = {
    ...hartwell,
    product: {
      ...hartwell.product,
      name: "The Charnwood",
      slug: "the-charnwood",
      base_price: 3950,
    },
  };
  const product = calculateCanonicalQuoteProduct({
    slug: "the-charnwood",
    colour: "Black",
    sizeCode: "standard",
    price: "1",
  }, charnwood);
  assert.equal(product.price, 3950);
  assert.equal(product.infillType, undefined);
  assert.equal(product.infillColour, undefined);
  assert.deepEqual(product.addonLineItems, []);
}

// An old quote that chose no infill stays at the base price.
{
  const product = calculateCanonicalQuoteProduct({
    slug: "the-hartwell",
    colour: "Black",
    sizeCode: "standard",
    infillType: "none",
    price: "9999",
  }, hartwell);
  assert.equal(product.price, 4140);
  assert.equal(product.infillType, "none");
  assert.deepEqual(product.addonLineItems, []);
}

// Photo size is a stable code, not a shape name, so the label and price agree.
{
  const product = calculateCanonicalQuoteProduct({
    slug: "the-castell",
    colour: "Black",
    photoActive: true,
    photoSize: "rectangle",
  }, catalogue);
  assert.equal(product.price, 1650);
  assert.deepEqual(product.addonLineItems, [
    { name: "Ceramic Photo Plaque — Rectangle", price: 200 },
  ]);
}

// Size and premium-colour adjustments are derived from the catalogue, not trusted input.
{
  const product = calculateCanonicalQuoteProduct({
    slug: "the-castell",
    colour: "Black Galaxy",
    sizeCode: "large",
    price: "0",
  }, {
    ...catalogue,
    sizes: [
      ...catalogue.sizes.map(size => ({ ...size, is_default: false })),
      { size_name: "Large", size_code: "large", dimensions: "36 × 30", price_adjustment: 300, is_default: true },
    ],
  });
  assert.equal(product.price, 1950);
  assert.deepEqual(product.addonLineItems, [
    { name: "Large size adjustment", price: 300 },
    { name: "Additional stone colour — Black Galaxy", price: 200 },
  ]);
}

// The browser source must carry structured choices and must not expose a dead edit link.
{
  const html = await readFile(new URL("../memorial.html", import.meta.url), "utf8");
  assert.match(html, /infillType:\s*'none'/);
  assert.match(html, /infillPrice:\s*0/);
  assert.doesNotMatch(html, /state\.infillPrice = INFILL_PRICES\.chippings/);
  assert.match(html, /Excludes the cemetery permit fee, if one applies\./);
  assert.match(html, /whole \? 0 : 2/);
  assert.match(html, /#infillOptionGroup, #qsInfillRow \{ display: none !important; \}/);
  assert.doesNotMatch(html, /infillType:\s*state\.infillType/);
  assert.doesNotMatch(html, /infillColour:\s*state\.infillColour/);
  assert.doesNotMatch(html, /value="extra-lettering"/);
  assert.match(html, /addonSlugs:\s*getSelectedAddonSlugs\(\)/);
  assert.match(html, /sizeCode:\s*state\.selectedSize/);
  assert.match(html, /PHOTO_SIZE_LABEL\s*=\s*\{\s*oval:\s*'Oval',\s*rectangle:\s*'Rectangle',\s*heart:\s*'Heart'\s*\}/);
  assert.doesNotMatch(html, /View & edit your quote/);
  assert.doesNotMatch(html, /Ceramic Photo Plaque — undefined/);
}

// Legacy quote edits must also recalculate and persist the canonical total.
{
  const api = await readFile(new URL("../functions/api/quotes.js", import.meta.url), "utf8");
  const html = await readFile(new URL("../quote.html", import.meta.url), "utf8");
  assert.match(api, /canonicaliseQuoteProduct/);
  assert.match(api, /updates\.value\s*=\s*safeProduct\.price/);
  assert.match(api, /product:\s*safeProduct/);
  assert.doesNotMatch(html, /Photo Plaque', price: 175/);
  assert.doesNotMatch(html, /Flower Vase/);
  const memorialHtml = await readFile(new URL("../memorial.html", import.meta.url), "utf8");
  assert.match(memorialHtml, /a\.slug !== 'flower-vase'/);
  assert.match(html, /Custom Motif'.*price: 120/);
  assert.match(html, /var showInfillEditor = false/);
  assert.match(html, /id="editInfillType"/);
  assert.match(html, /addonItems\.forEach/);
  assert.match(html, /class="quote-permit-line">Excludes the cemetery permit fee, if one applies\./);
  assert.doesNotMatch(html, /calculateCanonicalQuoteProduct|canonicaliseQuoteProduct/);
  const submit = await readFile(new URL("../functions/api/submit.js", import.meta.url), "utf8");
  assert.equal(
    (submit.match(/Excludes the cemetery permit fee, if one applies\./g) || []).length,
    2,
    "both quote emails carry the permit line under the guide total",
  );
}

console.log("pricing integrity tests passed");
