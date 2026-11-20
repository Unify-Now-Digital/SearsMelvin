import assert from "node:assert/strict";
import { factsParagraph, productDescription, productTitle, stonePhrase, typeWord } from "../product-copy.js";

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
  assert.match(description, /Greater London and surrounds/);
  assert.doesNotMatch(description, /UK-wide/);
  assert.doesNotMatch(description, /North London/);
  assert.match(description, /cemetery permits/);
  assert.match(description, /\.$/);
}

const bedale = {
  name: "The Bedale",
  base_price: 2875,
  short_description: "Shown in bahama blue granite, with a heart-shaped tablet and two rearing horses.",
  description: "Shown in flowing bahama blue granite, the natural patterning continues through the sculptural composition.",
  product_categories: { slug: "heart-memorials" },
  included_features: ["Heart-shaped tablet", "Flower vase", "Twin flower vases", "Flower-vase area"],
};
assert.equal(stonePhrase(bedale), "bahama blue granite");
const facts = factsParagraph(bedale, [{ size_name: "Standard" }]);
assert.doesNotMatch(facts, /\bin in\b/);
assert.match(facts, /in bahama blue granite/);
assert.doesNotMatch(facts, /vase/i);
assert.match(facts, /Greater London and surrounds/);

for (const phrase of [
  "Shown in bahama blue granite",
  "Shown in the black granite",
  "Carved in of dark granite",
  "A memorial with honed slate",
]) {
  const product = { name: "Example", short_description: phrase, product_categories: { slug: "lawn-headstones" }, included_features: ["Flower vase"] };
  assert.doesNotMatch(factsParagraph(product), /\bin in\b/, phrase);
  assert.doesNotMatch(factsParagraph(product), /vase/i, phrase);
}

console.log("product-copy: ok");
