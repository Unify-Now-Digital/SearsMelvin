import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const swatches = require("../data/stone-colour-swatches.js");

const BLACK = {
  id: "d00e0d6c-ec8a-4008-b392-a176b02e9d1c",
  slug: "black",
  name: "Black",
  image_url: null,
};
const REAL = "https://bfwohzcugtwbhhxdqgme.supabase.co/storage/v1/object/public/product-images/stone-colours/black.webp";
const source = readFileSync(new URL("../data/stone-colour-swatches.js", import.meta.url), "utf8");

assert.equal(swatches.stoneColourImageUrl(BLACK), "");
assert.equal(swatches.stoneColourImageUrl({ ...BLACK, image_url: REAL }), REAL);
assert.equal(swatches.stoneColourImageUrl({ ...BLACK, image_url: "javascript:alert(1)" }), "");
assert.equal(swatches.stoneColourImageUrl({ ...BLACK, image_url: "/images/black.webp" }), "/images/black.webp");
assert.equal(swatches.isProductionHost, undefined);
assert.equal(swatches.previewSwatchCount, undefined);
assert.doesNotMatch(source, /PREVIEW_SWATCHES/);
assert.doesNotMatch(source, /searsmelvin\.pages\.dev/);

const memorial = readFileSync(new URL("../memorial.html", import.meta.url), "utf8");
assert.match(memorial, /src="\/data\/stone-colour-swatches\.js"/);
assert.match(memorial, /stoneColourImageUrl\(c\)/);
assert.doesNotMatch(memorial, /stoneColourImageUrl\(c,\s*location\.hostname\)/);

const listing = readFileSync(new URL("../memorials.html", import.meta.url), "utf8");
assert.match(listing, /src="\/data\/stone-colour-swatches\.js"/);
assert.match(listing, /stoneColourImageUrl\(colour\)/);
assert.doesNotMatch(listing, /stoneColourImageUrl\(colour,\s*location\.hostname\)/);
assert.match(listing, /class="colour-swatch-photo"/);
assert.match(listing, /object-fit:\s*cover/);
assert.match(listing, /classList\.remove\(\\'has-photo\\'\);this\.remove\(\)/);
assert.match(listing, /linear-gradient\(145deg, ' \+ primaryHex \+ ', ' \+ secondaryHex \+ '\)/);
assert.doesNotMatch(listing, /stone-colours\/black\.webp/, "preview URLs stay in the swatch module");
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
assert.match(rollback, /previous_image_url/);
assert.match(rollback, /NULL::text/);
assert.equal((sql.match(/stone-colours\/[a-z0-9-]+\.webp/g) || []).length, 19);
assert.equal((rollback.match(/stone-colours\/[a-z0-9-]+\.webp/g) || []).length, 19);

console.log("stone-colour-swatches: ok");
