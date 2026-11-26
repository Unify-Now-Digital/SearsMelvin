// Contact page info cards (Call / Email / Showroom / Hours).
// Pins: multi-column layouts stack the icon above the text; card text never
// breaks mid-word; the email only breaks at <wbr> after @ / dots; resting
// border is the same on all four cards; tel / mailto / phone are unchanged.
// Source-only: no browser, no network.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const read = (f) => readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
const html = read("contact.html");
const upgrades = read("site-upgrades.css");

// Extract the body of an @media block by its query text (brace-balanced).
function mediaBlock(src, query) {
  const blocks = [];
  let from = 0;
  for (;;) {
    const at = src.indexOf(`@media ${query}`, from);
    if (at === -1) break;
    let i = src.indexOf("{", at) + 1;
    const start = i;
    let depth = 1;
    while (depth && i < src.length) {
      if (src[i] === "{") depth++;
      else if (src[i] === "}") depth--;
      i++;
    }
    blocks.push(src.slice(start, i - 1));
    from = i;
  }
  return blocks.join("\n");
}
function ruleFor(block, selector) {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = block.match(new RegExp(`(?:^|[\\s}])${esc}\\s*\\{([^}]*)\\}`));
  return m ? m[1] : "";
}

// (a) Multi-column layouts stack the icon above the text, centred.
for (const query of ["(max-width: 1024px)", "(max-width: 768px)"]) {
  const card = ruleFor(mediaBlock(html, query), ".contact-method");
  assert.match(card, /flex-direction:\s*column/, `contact.html ${query}: .contact-method must stack (column)`);
  assert.match(card, /align-items:\s*center/, `contact.html ${query}: icon must be centred`);
}
assert.match(ruleFor(mediaBlock(html, "(max-width: 1024px)"), ".contact-method-content"), /width:\s*100%/,
  "stacked card text must use the full card width");
const phone = ruleFor(mediaBlock(upgrades, "(max-width: 480px)"), ".contact-method");
assert.match(phone, /flex-direction:\s*column/, "site-upgrades 480px rule must keep the stacked layout");
assert.doesNotMatch(phone, /align-items:\s*flex-start/, "site-upgrades 480px rule must not fight the centred stack");
// Single-column desktop sidebar keeps the icon beside the text.
assert.match(html, /\n\s*\.contact-method \{[^}]*flex-direction:\s*row/, "desktop sidebar card keeps the row layout");

// (b) No mid-word breaking on the card text.
for (const m of upgrades.matchAll(/([^{}]*\.contact-method[^{}]*)\{([^}]*)\}/g)) {
  assert.doesNotMatch(m[2], /overflow-wrap:\s*anywhere|word-break:\s*break-all/, `no mid-word break on: ${m[1].trim()}`);
}
for (const m of html.matchAll(/([^{}]*\.contact-method[^{}]*)\{([^}]*)\}/g)) {
  assert.doesNotMatch(m[2], /overflow-wrap:\s*anywhere|word-break:\s*break-all/, `no mid-word break on: ${m[1].trim()}`);
}
assert.match(ruleFor(upgrades, "html body .contact-method-content p"), /overflow-wrap:\s*break-word[^}]*word-break:\s*normal[^}]*hyphens:\s*none/);

// (c) Visible email breaks only at <wbr> after @ and the dots.
assert.ok(html.includes("<p>info@<wbr>searsmelvin.<wbr>co.<wbr>uk</p>"), "visible email must carry <wbr> at @ and every .");

// (d) Links and visible phone unchanged.
assert.ok(html.includes('<a href="tel:+442038352548" class="contact-method">'), "tel link unchanged");
assert.ok(html.includes('<!--email_off--><a href="mailto:info@searsmelvin.co.uk" class="contact-method">'), "mailto + email_off unchanged");
assert.ok(html.includes("</a><!--/email_off-->"), "email_off close unchanged");
assert.ok(html.includes("<p>020 3835 2548</p>"), "visible phone unchanged");

// Resting state identical on all four cards: hover darkening is pointer-only,
// and focus/visited do not keep a darker border.
const hoverBlock = mediaBlock(html, "(hover: hover) and (pointer: fine)");
assert.match(hoverBlock, /\.contact-method:hover \{[^}]*border-color:\s*var\(--color-accent\)/);
assert.match(hoverBlock, /\.contact-method:hover \.contact-method-icon \{[^}]*var\(--color-stone\)/);
const outsideHover = html.replace(hoverBlock, "");
assert.doesNotMatch(outsideHover, /\.contact-method:hover/, "card hover must be gated to real pointers");
assert.doesNotMatch(html, /\.contact-method:(focus|visited|active)[^{]*\{[^}]*var\(--color-(accent|stone)\)/,
  "focus/visited must not darken a card");

// Cache buster: every page linking site-upgrades.css agrees on 20261126d.
const root = new URL("../", import.meta.url);
for (const f of readdirSync(root).filter((n) => n.endsWith(".html"))) {
  for (const m of read(f).matchAll(/site-upgrades\.css\?v=([\w]+)/g)) {
    assert.equal(m[1], "20261126d", `${f}: site-upgrades.css buster`);
  }
}

console.log("contact-method-cards: ok");
