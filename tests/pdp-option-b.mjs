// Option B (phones): static contract for the guided product-page layout.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { factsParagraph } from "../product-copy.js";

const html = readFileSync("memorial.html", "utf8");
const css = readFileSync("memorial-option-b.css", "utf8");
const js = readFileSync("memorial-option-b.js", "utf8");
const clarity = readFileSync("sm-clarity.js", "utf8");

assert.match(html, /<link rel="stylesheet" href="\/memorial-option-b\.css">/);
assert.match(html, /<script src="\/memorial-option-b\.js\?v=[^"]+" defer><\/script>/);

for (const tab of ["Details", "Included", "Guarantees", "Permits"]) {
  assert.match(html, new RegExp(`role="tab"[^>]*>${tab}<\\/button>`));
}

const nrStart = html.indexOf('class="pdp-b-notready"');
const notReady = html.slice(nrStart, html.indexOf("</section>", nrStart));
assert.ok(nrStart > 0, "the Not ready to decide block exists");
assert.match(notReady, /href="tel:\+442038352548"[\s\S]*>020 3835 2548</);
assert.match(notReady, /href="\/brochure"/);
assert.match(notReady, /href="\/contact"/);
assert.match(notReady, /href="https:\/\/wa\.me\/442038352548"/);

const bar = html.slice(html.indexOf('class="mobile-bottom-bar"'), html.indexOf('class="save-toast"'));
assert.match(bar, /href="https:\/\/wa\.me\/442038352548"[^>]*data-sm-whatsapp="pdp_sticky"/);
assert.match(js, /event:\s*'whatsapp_click'/);
// Desktop: the Your choices card and the desktop price bar carry WhatsApp too.
const waLinks = [...html.matchAll(/<a [^>]*href="https:\/\/wa\.me\/442038352548"[^>]*data-sm-whatsapp="([a-z_]+)"/g)].map((m) => m[1]).sort();
assert.deepEqual(waLinks, ["pdp_choices", "pdp_desktop_bar", "pdp_not_ready", "pdp_sticky"], "four tagged WhatsApp links");
assert.equal((js.match(/'whatsapp_click'/g) || []).length, 1, "a single push site for whatsapp_click");
const priceActions = html.slice(html.indexOf('<div class="price-actions">'), html.indexOf('</div>', html.indexOf('<div class="price-actions">')));
assert.match(priceActions, /data-sm-whatsapp="pdp_desktop_bar"/);
assert.match(priceActions, /onclick="openQuoteModal\(\)"/, "desktop quote button unchanged");
assert.match(css, /@media \(min-width: 768px\)[\s\S]*\.pdp-b-choices \{/, "the card has a desktop style");
assert.doesNotMatch(css, /^\.pdp-b-choices,$/m, "the card is no longer hidden on desktop");
assert.match(js, /link_location:\s*link\.dataset\.smWhatsapp/);
const waHandler = js.slice(js.indexOf("closest('a[data-sm-whatsapp]')"), js.indexOf("closest('a[data-sm-whatsapp]')") + 400);
assert.ok(waHandler.length > 0, "the WhatsApp click handler exists");
assert.doesNotMatch(waHandler.split("});")[0], /preventDefault/, "the WhatsApp click is never blocked");

assert.match(css, /\.quote-config-row\[hidden\] \{ display: none; \}/, "the quote Size row stays hidden");
assert.match(html, /<div class="quote-config-row" hidden><span>Size<\/span>/);
assert.doesNotMatch(factsParagraph({ name: "Test" }, [{ size_name: "Standard" }]), /Sizes include/);
assert.match(clarity, /wa\.me/);
assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/);
assert.equal((html.match(/GTM-KRDX4BQ5/g) || []).length, 2, "GTM loader and noscript ids remain unchanged");

console.log("pdp-option-b: ok");
