import assert from "node:assert/strict";
import { productDescription, productTitle, typeWord } from "../product-copy.js";

const samples = [
  ["The Castell", "lawn-headstones", 1450, "headstone"],
  ["The Hartwell", "kerb-sets", 4140, "kerb set"],
  ["The Albury", "cremation-memorials", 1500, "cremation memorial"],
  ["The Goldstone", "childrens-memorials", 2370, "children's memorial"],
  ["The Hurstmonceux", "churchyard-memorials", 2650, "churchyard memorial"],
  ["The Twin Sweetheart", "heart-memorials", 2500, "heart memorial"],
  ["The Dalemain", "book-memorials", 4320, "book memorial"],
];

for (const [name, slug, price, word] of samples) {
  const product = { name, base_price: price, product_categories: { slug } };
  assert.equal(typeWord(slug), word);
  const title = productTitle(product);
  const description = productDescription(product);
  assert.ok(title.length <= 60, title);
  assert.ok(description.length >= 140 && description.length <= 155, `${description.length} ${description}`);
  assert.equal(description.includes("…"), false);
  assert.match(description, new RegExp(word.replace("'", "\\'")));
  assert.match(description, /from £/);
  assert.match(description, /UK-wide installation/);
  assert.match(description, /London/);
  assert.match(description, /cemetery permits/);
  assert.match(description, /\.$/);
}

console.log("product-copy: ok");
