import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const swatches = require("../data/stone-colour-swatches.js");
const upgrades = require("../site-upgrades.js");

const BLACK = {
  id: "d00e0d6c-ec8a-4008-b392-a176b02e9d1c",
  slug: "black",
  name: "Black",
  image_url: null,
};
const BLACK_PHOTO = "https://bfwohzcugtwbhhxdqgme.supabase.co/storage/v1/object/public/product-images/stone-colours/black.webp";
const REAL = "https://bfwohzcugtwbhhxdqgme.supabase.co/storage/v1/object/public/product-images/stone-colours/from-the-row.webp";

assert.equal(swatches.previewSwatchCount, 10);

const hosts = [
  "searsmelvin.co.uk",
  "www.searsmelvin.co.uk",
  "SEARSMELVIN.CO.UK.",
  "searsmelvin.pages.dev",
  "9fd844a7.searsmelvin.pages.dev",
  "cursor-stone-colour-swatches-62d4.searsmelvin.pages.dev",
  "localhost",
  "127.0.0.1",
  "preview.workers.dev",
  "evil.example",
  "",
];
for (const host of hosts) {
  assert.equal(swatches.isProductionHost(host), upgrades.isProductionHost(host), host);
}

assert.equal(swatches.stoneColourImageUrl(BLACK, "searsmelvin.co.uk"), "", "production host ignores the preview map");
assert.equal(swatches.stoneColourImageUrl(BLACK, "www.searsmelvin.co.uk"), "");
assert.equal(swatches.stoneColourImageUrl(BLACK, "searsmelvin.pages.dev"), "", "apex pages.dev stays on the gradient");
assert.equal(swatches.stoneColourImageUrl(BLACK, "not-a-preview.example"), "");
assert.equal(swatches.stoneColourImageUrl(BLACK, ""), "");
assert.equal(swatches.stoneColourImageUrl(BLACK, "9fd844a7.searsmelvin.pages.dev"), BLACK_PHOTO);
assert.equal(swatches.stoneColourImageUrl(BLACK, "localhost"), BLACK_PHOTO);
assert.equal(swatches.stoneColourImageUrl({ ...BLACK, image_url: REAL }, "searsmelvin.co.uk"), REAL, "a real image_url wins on production");
assert.equal(swatches.stoneColourImageUrl({ ...BLACK, image_url: REAL }, "localhost"), REAL, "a real image_url wins over the preview map");
assert.equal(swatches.stoneColourImageUrl({ ...BLACK, slug: "grey" }, "localhost"), "", "id/slug mismatch does not borrow a photo");
assert.equal(swatches.stoneColourImageUrl({ id: "nope", slug: "black" }, "localhost"), "");
assert.equal(swatches.stoneColourImageUrl({ ...BLACK, image_url: "javascript:alert(1)" }, "searsmelvin.co.uk"), "");
assert.equal(swatches.stoneColourImageUrl({ ...BLACK, image_url: "javascript:alert(1)" }, "localhost"), BLACK_PHOTO);
assert.equal(swatches.stoneColourImageUrl({ ...BLACK, image_url: "/images/black.webp" }, "searsmelvin.co.uk"), "/images/black.webp");

const memorial = readFileSync(new URL("../memorial.html", import.meta.url), "utf8");
assert.match(memorial, /src="\/data\/stone-colour-swatches\.js"/);
assert.match(memorial, /stoneColourImageUrl\(c,\s*location\.hostname\)/);
assert.match(memorial, /id="stoneColourPreview"/);
assert.match(memorial, /role="radiogroup"/);
assert.match(memorial, /aria-labelledby="stoneColourLabel"/);
assert.match(memorial, /class="colour-swatch-photo"/);
assert.match(memorial, /object-fit:\s*cover/);
assert.match(memorial, /input:focus-visible \+ \.colour-wrapper \.colour-swatch/);
assert.match(memorial, /classList\.remove\(\\'has-photo\\'\);this\.remove\(\)/);
assert.doesNotMatch(memorial, /stone-colours\/black\.webp/, "preview URLs stay in the swatch module");
assert.match(memorial, /state\.colourPrice = parseInt\(input\.dataset\.price\) \|\| 0/);
assert.match(memorial, /if \(slug === 'kerb-sets'\) return 550;/);
assert.match(memorial, /if \(slug === 'cremation-memorials'\) return 90;/);
assert.match(memorial, /return 200;/);
assert.match(memorial, /event: 'sm_quote_submit'/);
assert.match(memorial, /GTM-KRDX4BQ5/);
assert.match(memorial, /020 3835 2548/);

const sql = readFileSync(new URL("../sql/NOT-APPLIED-stone-colour-image-urls.sql", import.meta.url), "utf8");
const rollback = readFileSync(new URL("../sql/NOT-APPLIED-stone-colour-image-urls-rollback.sql", import.meta.url), "utf8");
assert.match(sql, /NOT APPLIED/);
assert.match(rollback, /NOT APPLIED/);
assert.match(sql, /SET image_url = v\.image_url/);
assert.match(rollback, /SET image_url = NULL/);
assert.equal((sql.match(/stone-colours\/[a-z0-9-]+\.webp/g) || []).length, 10);
assert.equal((rollback.match(/stone-colours\/[a-z0-9-]+\.webp/g) || []).length, 10);

console.log("stone-colour-swatches: ok");
