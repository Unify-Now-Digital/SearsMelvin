/**
 * HTML shell for server-rendered catalogue pages.
 * The tracking and consent block is copied from memorials.html at request
 * time, so it stays the same bytes as the catalogue page.
 */

import { businessJsonLd } from "./_business-schema.js";
import { SHARE_IMAGE } from "../product-copy.js";
import { CATEGORIES, closingSentence, priceSentence } from "../data/categories.js";

const BASE = "https://searsmelvin.co.uk";

function sliceBetween(html, start, end) {
  const from = html.indexOf(start);
  const to = from < 0 ? -1 : html.indexOf(end, from);
  if (from < 0 || to < 0) return "";
  return html.slice(from, to + end.length);
}

export function shellParts(html) {
  return {
    trackingHead: sliceBetween(html, "<!-- Consent Mode default", "<!-- End Google Tag Manager + LeadConnector -->"),
    gtmNoscript: sliceBetween(html, "<!-- Google Tag Manager (noscript) -->", "<!-- End Google Tag Manager (noscript) -->"),
    cookie: sliceBetween(html, "<!-- Cookie Consent Banner -->", '<script src="/cookie-consent.js"></script>'),
  };
}

function escapeHtml(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

function jsonScript(data) {
  return `<script type="application/ld+json">${JSON.stringify(data).replace(/</g, "\\u003c")}</script>`;
}

function categoryList(currentSlug) {
  return CATEGORIES.map((category) => {
    const href = `/memorials/type/${category.slug}`;
    const here = category.slug === currentSlug ? ' aria-current="page"' : "";
    return `<li><a href="${href}"${here}>${escapeHtml(category.name)}</a></li>`;
  }).join("");
}

const PAGE_CSS = `
  *, *::before, *::after { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; max-width: 100%; }
  body { font-family: var(--sm-font-body); background: var(--sm-color-bg); color: var(--sm-color-text); line-height: 1.6; }
  img { max-width: 100%; height: auto; }
  a { color: var(--sm-color-link); }
  nav#navbar { display: flex; flex-wrap: wrap; gap: 0.75rem 1.25rem; align-items: center; justify-content: space-between; padding: 1rem; background: var(--sm-color-bg); }
  nav#navbar .logo { white-space: normal; }
  nav#navbar .logo img { height: 48px; width: auto; max-width: 62vw; }
  nav#navbar .nav-links { display: flex; flex-wrap: wrap; gap: 0.75rem 1rem; list-style: none; margin: 0; padding: 0; }
  nav#navbar .nav-links a { color: var(--sm-color-text); text-decoration: none; min-height: 44px; display: inline-flex; align-items: center; }
  .seo-wrap { width: min(72rem, calc(100% - 2rem)); margin: 0 auto; padding: 1.5rem 0 3rem; }
  .crumbs { font-size: 0.9rem; margin: 0 0 1rem; }
  .crumbs ol { display: flex; flex-wrap: wrap; gap: 0.35rem 0.5rem; list-style: none; margin: 0; padding: 0; }
  h1, h2 { font-family: var(--sm-font-display); font-weight: 500; color: var(--sm-color-text); line-height: 1.2; }
  h1 { font-size: clamp(2rem, 6vw, 3rem); margin: 0 0 1rem; }
  .type-intro p { margin: 0 0 1rem; color: var(--sm-color-text-muted); max-width: 42rem; }
  .type-grid { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: 1fr; gap: 0; }
  .type-grid a { display: flex; justify-content: space-between; gap: 1rem; flex-wrap: wrap; padding: 0.85rem 0; border-bottom: 1px solid var(--sm-color-border-decorative); color: var(--sm-color-text); text-decoration: none; }
  .type-grid a span { color: var(--sm-color-text-muted); }
  .type-faqs { margin: 2rem 0; }
  .type-faqs details { border-bottom: 1px solid var(--sm-color-border-decorative); padding: 0.75rem 0; }
  .type-faqs summary { cursor: pointer; font-weight: 500; }
  a.seo-cta { display: inline-flex; align-items: center; min-height: 44px; margin-top: 0.5rem; padding: 0.75rem 1.25rem; background: var(--sm-color-action-primary-bg); color: var(--sm-color-action-primary-text); border-radius: var(--sm-radius-sm); text-decoration: none; }
  a.seo-cta:hover { background: var(--sm-color-ink-hover); }
  .type-browse-note { margin: 2rem 0 0; }
`;

export function renderCategoryPage({ shellHtml, category, products }) {
  const parts = shellParts(shellHtml);
  const canonical = `${BASE}/memorials/type/${category.slug}`;
  const prices = products.map((product) => Number(product.base_price)).filter((price) => Number.isFinite(price) && price >= 0);
  const min = prices.length ? Math.min(...prices) : null;
  const priceLabel = min == null ? "" : `£${Math.round(min).toLocaleString("en-GB")}`;
  const paragraphs = [...category.paragraphs, priceSentence(priceLabel), closingSentence()];
  const intro = paragraphs.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join("");
  const cards = products.map((product) => {
    const slug = String(product.slug || "").toLowerCase();
    if (!/^[a-z0-9-]{1,120}$/.test(slug)) return "";
    const name = String(product.name || "Memorial").replace(/\s+/g, " ").trim();
    const amount = Number(product.base_price);
    const price = Number.isFinite(amount) ? `From £${Math.round(amount).toLocaleString("en-GB")}` : "Guide price on request";
    return `<li><a href="/memorials/${slug}">${escapeHtml(name)} <span>${escapeHtml(price)}</span></a></li>`;
  }).join("");
  const faqs = category.faqs.map((faq) =>
    `<details><summary>${escapeHtml(faq.q)}</summary><p>${escapeHtml(faq.a)}</p></details>`
  ).join("");
  const crumbs = [
    { "@type": "ListItem", position: 1, name: "Home", item: `${BASE}/` },
    { "@type": "ListItem", position: 2, name: "Memorials", item: `${BASE}/memorials` },
    { "@type": "ListItem", position: 3, name: category.name, item: canonical },
  ];
  const itemList = products.filter((product) => /^[a-z0-9-]{1,120}$/.test(String(product.slug || "").toLowerCase())).map((product, index) => ({
    "@type": "ListItem",
    position: index + 1,
    name: product.name,
    url: `${BASE}/memorials/${String(product.slug).toLowerCase()}`,
  }));
  const faqLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: category.faqs.map((faq) => ({
      "@type": "Question",
      name: faq.q,
      acceptedAnswer: { "@type": "Answer", text: faq.a },
    })),
  };

  return `<!DOCTYPE html>
<html lang="en">
<head>
    ${parts.trackingHead}
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${escapeHtml(category.title)}</title>
    <meta name="description" content="${escapeHtml(category.meta)}">
    <link rel="canonical" href="${canonical}">
    <link rel="icon" href="/favicon.ico" sizes="48x48">
    <link rel="icon" href="/favicon.svg">
    <meta property="og:type" content="website">
    <meta property="og:site_name" content="Sears Melvin Memorials">
    <meta property="og:title" content="${escapeHtml(category.title)}">
    <meta property="og:description" content="${escapeHtml(category.meta)}">
    <meta property="og:url" content="${canonical}">
    <meta property="og:image" content="${SHARE_IMAGE}">
    <meta property="og:locale" content="en_GB">
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:title" content="${escapeHtml(category.title)}">
    <meta name="twitter:description" content="${escapeHtml(category.meta)}">
    <meta name="twitter:image" content="${SHARE_IMAGE}">
    <link rel="stylesheet" href="/tokens.css">
    <link rel="stylesheet" href="/site-upgrades.css">
    <link rel="stylesheet" href="/cookie-consent.css">
    <link rel="stylesheet" href="/accreditations.css">
    <style>${PAGE_CSS}</style>
    <!-- Showroom coordinates from https://api.postcodes.io/postcodes/NW116LB, rounded to 5 decimal places. -->
    ${jsonScript(businessJsonLd())}
    ${jsonScript({ "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: crumbs })}
    ${jsonScript({ "@context": "https://schema.org", "@type": "ItemList", name: category.h1, itemListElement: itemList })}
    ${jsonScript(faqLd)}
</head>
<body>
    ${parts.gtmNoscript}
    <nav id="navbar">
        <a href="/" class="logo"><img src="/images/brand/logo/sears-melvin-stacked-ink.svg" alt="Sears Melvin Memorials" width="262" height="66"></a>
        <ul class="nav-links">
            <li><a href="/memorials">Memorials</a></li>
            <li><a href="/about">About</a></li>
            <li><a href="/contact">Get a quote</a></li>
            <li><a href="tel:+442038352548">020 3835 2548</a></li>
        </ul>
    </nav>
    <main class="seo-wrap">
        <nav class="crumbs" aria-label="Breadcrumb">
            <ol>
                <li><a href="/">Home</a></li>
                <li><a href="/memorials">Memorials</a></li>
                <li>${escapeHtml(category.name)}</li>
            </ol>
        </nav>
        <h1>${escapeHtml(category.h1)}</h1>
        <div class="type-intro">${intro}</div>
        <ul class="type-grid">${cards}</ul>
        <section class="type-faqs" aria-label="Questions">
            <h2>Questions</h2>
            ${faqs}
        </section>
        <p><a class="seo-cta" href="/contact">Request a quote</a></p>
    </main>
    <footer class="footer-b">
        <div class="footer-container">
            <div class="footer-brand">
                <img class="footer-logo" src="/images/brand/logo/sears-melvin-stacked-soft-bronze.svg" alt="Sears Melvin Memorials" width="262" height="66">
                <div class="footer-contact">
                    <a href="tel:+442038352548">020 3835 2548</a>
                    <a href="mailto:info@searsmelvin.co.uk">info@searsmelvin.co.uk</a>
                    <span>Installation across Greater London and surrounds</span>
                </div>
            </div>
            <div class="footer-explore">
                <h2 class="footer-heading">Explore</h2>
                <ul class="footer-links">
                    <li><a href="/memorials">Memorials</a></li>
                    ${categoryList(category.slug)}
                    <li><a href="/about">About</a></li>
                    <li><a href="/contact">Contact</a></li>
                    <li><a href="/faq">FAQ</a></li>
                    <li><a href="/brochure">Brochure</a></li>
                    <li><a href="/terms">Terms</a></li>
                    <li><a href="/privacy">Privacy</a></li>
                    <li><a href="#cookie-settings" class="sm-cookie-settings">Cookie settings</a></li>
                </ul>
            </div>
            <div class="footer-showroom">
                <h2 class="footer-heading">Visit our Finchley showroom</h2>
                <p>1 The Market Place, Falloden Way, London NW11 6LB</p>
                <p class="footer-hours">Monday to Friday, 10am to 3pm</p>
            </div>
            <div class="footer-base">
                <p class="footer-copy">Sears Melvin Ltd. Registered in England &amp; Wales, company no. 16191330. Registered office: Unit 16, Dorewards Hall, Dorewards Chase, Braintree CM7 5LS, United Kingdom. Trading as Sears Melvin Memorials.</p>
            </div>
        </div>
    </footer>
    ${parts.cookie}
    <script src="/site-globals.js" defer></script>
    <script src="/site-upgrades.js" defer></script>
</body>
</html>`;
}
