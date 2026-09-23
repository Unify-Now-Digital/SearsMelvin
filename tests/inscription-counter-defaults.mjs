import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const html = await readFile(new URL("../memorial.html", import.meta.url), "utf8");

// Empty / pre-product inscription labels match the catalogue defaults.
assert.match(html, /<span id="charCount">0<\/span> \/ 80 included/);
assert.match(html, /id="charCounter">80 characters included, then £2\.40 each</);
assert.doesNotMatch(html, /100 characters included, then £1\.95/);
assert.doesNotMatch(html, /\/ 100 included/);

assert.match(html, /let charsIncluded = 80;/);
assert.match(html, /let pricePerChar = 2\.40;/);

// Product rows still override the defaults.
assert.match(html, /charsIncluded = product\.inscription_chars_included \|\| 80;/);
assert.match(html, /pricePerChar = parseFloat\(product\.inscription_price_per_char\) \|\| 2\.40;/);

// Over-80 summing is unchanged: extra letters × rate, rounded to pence.
assert.match(html, /const extra = charCount - charsIncluded;/);
assert.match(html, /const cost\s+= parseFloat\(\(extra \* pricePerChar\)\.toFixed\(2\)\);/);

// Running total, quote-summary total, and the extra-lettering line keep two decimals.
assert.match(html, /const fmt\s+= formatGbp\(total\);/);
assert.match(html, /document\.getElementById\('qsTotal'\)\.textContent = formatGbp\(total\);/);
assert.match(html, /item\.name === 'Extra Lettering'[\s\S]{0,80}formatGbp\(item\.price\)/);

const helper = html.match(/function formatGbp\(amount\) \{([\s\S]*?)\n        \}/);
assert.ok(helper, "formatGbp helper missing");
const formatGbp = new Function("amount", helper[1]);
assert.equal(formatGbp(1452.4), "£1,452.40");
assert.equal(formatGbp(1450), "£1,450.00");
assert.equal(formatGbp(2.4), "£2.40");
