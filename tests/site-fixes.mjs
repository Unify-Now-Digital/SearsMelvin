// Pins the Nov 2026 public-site fixes: mobile quote link, share images,
// favicon set, sticky bar, and the thank-you redirect. Tracking events stay put.
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";

const read = (f) => readFileSync(f, "utf8");

const home = read("index.html");
assert.match(home, /class="nav-quote-mobile">Get a quote</);
assert.match(home, /class="btn btn-primary hero-quote-mobile">Get a quote</);
assert.match(home, /class="btn btn-primary hero-browse"/);
assert.match(home, /class="btn btn-secondary hero-touch">Get in Touch</);
assert.match(home, /class="nav-cta">Get a quote</);
assert.doesNotMatch(home, /property="og:image" content="[^"]*sm-logo\.svg"/);
assert.match(home, /images\/share\/og-home\.jpg/);
assert.match(home, /property="og:image:width" content="1200"/);
assert.match(home, /property="og:image:height" content="630"/);

const css = read("site-upgrades.css");
assert.match(css, /\.nav-quote-mobile \{ display: none; \}/);
assert.match(css, /\.hero-quote-mobile \{ display: none; \}/);
assert.match(css, /\.hero-buttons \.hero-touch \{ display: none; \}/);
assert.match(css, /\.sm-mobile-action-bar/);
assert.match(css, /body\.sm-mobile-action-visible/);

const globals = read("site-globals.js");
assert.match(globals, /Call 020 3835 2548/);
assert.match(globals, /href="tel:\+442038352548"/);
assert.match(globals, /memorial-page/);
assert.match(globals, /\/memorials\\\//);
assert.match(globals, /cookieBannerOpen|cookieConsent/);
assert.match(globals, /sm-hold-chat-greeting/);
assert.match(globals, /chatWidgetSeenAt/);
assert.doesNotMatch(globals, /\+44 20 3835 2548/);

const memorial = read("memorial.html");
assert.doesNotMatch(memorial, /nav-quote-mobile/, "product template keeps its own quote control");
assert.match(memorial, /sm-logo\.svg/, "product shell still has an image the rewriter replaces");
assert.match(memorial, /og-memorials\.jpg/);
assert.match(memorial, /location\.replace\('\/thank-you\?form=quote'\)/);
const q = memorial.slice(memorial.indexOf("if (result.ok) {", memorial.indexOf("channel:  'quote'")));
assert.ok(q.indexOf("event: 'sm_quote_submit'") < q.indexOf("quoteForm').style.display = 'none'"));
assert.ok(q.indexOf("location.replace") > q.indexOf("event: 'sm_quote_submit'"));

const contact = read("contact.html");
assert.match(contact, /placeholder="Your phone number"/);
assert.doesNotMatch(contact, /07123 456 789/);
assert.match(contact, /location\.replace\('\/thank-you\?form=contact'\)/);
const c = contact.slice(contact.indexOf("event: 'sm_lead_submit'"));
assert.ok(c.indexOf("event: 'sm_lead_submit'") < c.indexOf("contactForm').style.display = 'none'"));
assert.ok(c.indexOf("location.replace") > c.indexOf("contactForm').style.display = 'none'"));

const thanks = read("thank-you.html");
assert.match(thanks, /noindex, nofollow/);
assert.match(thanks, /event: 'sm_thank_you'/);
assert.match(thanks, /form_type: formType/);
assert.match(thanks, /Thank you for getting in touch/);
assert.match(thanks, /within one working day/);
assert.match(thanks, /Placeholder — Arin to confirm/);
assert.match(thanks, /GTM-KRDX4BQ5/);
assert.doesNotMatch(thanks, /property="og:image" content="[^"]*sm-logo\.svg"/);

assert.match(read("robots.txt"), /Disallow: \/thank-you\n/);
assert.doesNotMatch(read("functions/sitemap.xml.js"), /path:\s*"\/thank-you"/);
assert.match(read("functions/memorials/[slug].js"), /images\/share\/og-memorials\.jpg/);
assert.doesNotMatch(read("functions/memorials/[slug].js"), /FALLBACK_IMAGE = `\$\{BASE\}\/sm-logo\.svg`/);

for (const file of [
  "favicon.ico", "favicon.svg", "favicon-32.png", "apple-touch-icon.png",
  "icon-192.png", "icon-512.png", "site.webmanifest",
  "images/share/og-home.jpg", "images/share/og-about.jpg", "images/share/og-brochure.jpg",
  "images/share/og-memorials.jpg", "images/share/og-contact.jpg", "images/share/og-care.jpg",
  "images/share/og-faq.jpg", "images/share/og-resources.jpg",
]) {
  assert.ok(existsSync(file), file);
}
const manifest = JSON.parse(read("site.webmanifest"));
assert.ok(manifest.icons.some((icon) => icon.sizes === "192x192"));
assert.ok(manifest.icons.some((icon) => icon.sizes === "512x512"));

const pages = execSync("git ls-files '*.html'").toString().split("\n").filter(Boolean)
  .filter((f) => !["404.html", "admin.html", "admin-products.html", "memorial.html"].includes(f));
for (const f of pages) {
  const html = read(f);
  if (!html.includes("og:image")) continue;
  assert.doesNotMatch(html, /og:image" content="https:\/\/searsmelvin\.co\.uk\/sm-logo\.svg"/, `${f} still shares the SVG`);
  assert.match(html, /favicon\.svg/, `${f} keeps the SVG favicon`);
  assert.match(html, /apple-touch-icon\.png/, `${f} has an apple touch icon`);
}

assert.match(read("docs/TRACKING.md"), /sm_thank_you/);
assert.match(read("docs/TRACKING.md"), /Do not mark the new event as a GA4 key event/);
console.log("site-fixes: ok");
