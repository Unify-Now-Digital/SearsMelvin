import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { countBillableInscriptionChars } from "../functions/api/_inscription-count.js";
import { calculateCanonicalQuoteProduct } from "../functions/api/_quote-pricing.js";

const html = await readFile(new URL("../memorial.html", import.meta.url), "utf8");
const helperSource = await readFile(new URL("../functions/api/_inscription-count.js", import.meta.url), "utf8");

function normalise(source) {
  return source.replace(/\s+/g, "");
}

const clientMatch = html.match(/function countBillableInscriptionChars\(text\) \{([\s\S]*?)\n        \}/);
assert.ok(clientMatch, "memorial.html is missing countBillableInscriptionChars");
const serverMatch = helperSource.match(/export function countBillableInscriptionChars\(text\) \{([\s\S]*?)\n\}/);
assert.ok(serverMatch, "server helper is missing countBillableInscriptionChars");
assert.equal(
  normalise(clientMatch[1]),
  normalise(serverMatch[1]),
  "UI and server billable-count copies have diverged",
);

const countFromPage = new Function("text", clientMatch[1]);

const examples = [
  ["", 0],
  ["Hello World", 10],
  ["José", 4],
  // A real newline. Four A's; space, newline, "!" and "." are free.
  // A typed backslash + n is five, because "n" is a letter and "\\" is not.
  ["A A\nA!A.", 4],
  ["A A\\nA!A.", 5],
  ["Mary-Jane", 8],
  ["Tom & Jerry", 8],
  ["Hello, World!", 10],
  ["١٢٣", 3],
  ["A👍B", 2],
];

for (const [text, expected] of examples) {
  assert.equal(countBillableInscriptionChars(text), expected, `server count for ${JSON.stringify(text)}`);
  assert.equal(countFromPage(text), expected, `page count for ${JSON.stringify(text)}`);
}

assert.match(html, /<span id="charCount">0<\/span> \/ 80 included/);
assert.match(html, /const charCount = countBillableInscriptionChars\(text\);/);
assert.match(html, /document\.getElementById\('charCount'\)\.textContent = charCount;/);
assert.match(html, /letters and numbers included, then £/);
assert.doesNotMatch(html, /characters included, then £/);
assert.doesNotMatch(html, /extra chars =/);
assert.doesNotMatch(html, /characters remaining/);

const catalogue = {
  product: {
    id: "product-1",
    name: "The Castell",
    slug: "the-castell",
    base_price: 1450,
    image_url: "/images/castell.jpg",
    inscription_chars_included: 80,
    inscription_price_per_char: 2.40,
    product_categories: { name: "Lawn Memorials", slug: "lawn-memorials" },
  },
  sizes: [
    { size_name: "Standard", size_code: "standard", dimensions: "30 × 24", price_adjustment: 0, is_default: true },
  ],
  colours: [{ name: "Black", slug: "black", is_premium: false }],
  addons: [],
};

function quote(inscription, productOverrides = {}) {
  return calculateCanonicalQuoteProduct({
    slug: "the-castell",
    colour: "Black",
    inscription,
  }, {
    ...catalogue,
    product: { ...catalogue.product, ...productOverrides },
  });
}

// Spaces, newlines, and punctuation do not create an extra-lettering charge.
{
  const spaced = `${"A ".repeat(50)}!\n& -`;
  assert.ok(spaced.length > 80, "raw length must exceed the allowance so the old counter would have billed");
  assert.equal(countBillableInscriptionChars(spaced), 50);
  const product = quote(spaced);
  assert.equal(product.inscription, spaced.trim());
  assert.equal(product.price, 1450);
  assert.deepEqual(product.addonLineItems, []);
}

// Only letters and digits above the allowance are billed, at the product rate.
{
  const inscription = `${"A".repeat(78)}José`;
  assert.equal(countBillableInscriptionChars(inscription), 82);
  const product = quote(inscription);
  assert.equal(product.price, 1454.8);
  assert.deepEqual(product.addonLineItems, [{ name: "Extra Lettering", price: 4.8 }]);
}

// A custom allowance and rate still come from the product row.
{
  const product = quote("A".repeat(10), {
    inscription_chars_included: 4,
    inscription_price_per_char: 1.5,
  });
  assert.equal(product.price, 1459);
  assert.deepEqual(product.addonLineItems, [{ name: "Extra Lettering", price: 9 }]);
}

// The locked examples stay under the default 80 and add nothing.
for (const sample of ["Hello World", "José", "A A\nA!A."]) {
  const product = quote(sample);
  assert.equal(product.price, 1450, sample);
  assert.equal(product.inscription, sample.trim());
}

console.log("inscription billable count tests passed");
