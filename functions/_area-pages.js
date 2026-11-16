/**
 * Borough cemetery pages at /areas and /areas/<slug>.
 * Copy comes from data/boroughs.json. The visible page uses the About
 * document as its shell so the header, footer, consent defaults, and
 * GTM container stay the same bytes as the rest of the site.
 * Pages _redirects do not run for a Function route, which is why these
 * URLs are listed in _routes.json and omitted from the /areas splat.
 */

import areaData from "../data/boroughs.cjs";
import { CATEGORIES } from "../data/categories.js";

const BASE = "https://searsmelvin.co.uk";
const PERMIT = "Most cemeteries need a permit before a memorial is placed. We handle the application with the cemetery for you.";
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

const AREA_CSS = `
.area-crumbs { margin: 0 auto 1.25rem; }
.area-crumbs ol { display: flex; flex-wrap: wrap; gap: 0.35rem 0.5rem; justify-content: center; list-style: none; margin: 0; padding: 0; }
.area-crumbs li:not(:last-child)::after { content: "/"; margin-left: 0.5rem; color: var(--color-text-muted); }
.area-list { list-style: none; margin: 0.5rem 0 1.5rem; padding: 0; }
.area-list > li { list-style: none; margin: 0; padding: 0 0 1.25rem; border-bottom: 1px solid var(--color-border); }
.area-cemetery h2 { margin: 1.25rem 0 0.35rem; }
.area-meta { margin: 0.15rem 0; color: var(--color-text-muted); }
.area-actions { display: flex; flex-wrap: wrap; gap: 0.25rem 1.25rem; margin: 0.35rem 0 0; }
.area-actions a { min-height: 44px; display: inline-flex; align-items: center; }
.area-boroughs a { display: flex; justify-content: space-between; gap: 0.35rem 1rem; align-items: baseline; flex-wrap: wrap; min-height: 44px; text-decoration: none; }
.area-note { color: var(--sm-color-text-muted); }
`;

export function visibleField(value) {
  const text = String(value == null ? "" : value).replace(/\s+/g, " ").trim();
  if (!text || /^(not checked|not stated)$/i.test(text)) return "";
  return text;
}

export function areaPaths() {
  return ["/areas", ...areaData.boroughs.map((borough) => `/areas/${borough.slug}`)];
}

export function boroughBySlug(slug) {
  return areaData.boroughs.find((borough) => borough.slug === slug) || null;
}

function escapeHtml(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

function jsonScript(data) {
  return `<script type="application/ld+json">${JSON.stringify(data).replace(/</g, "\\u003c")}</script>`;
}

function safeHttpUrl(value) {
  try {
    const url = new URL(String(value));
    if (url.protocol !== "https:" && url.protocol !== "http:") return "";
    if (url.username || url.password) return "";
    return url.href;
  } catch {
    return "";
  }
}

function mapsHref(name, postcode, boroughName) {
  const query = postcode ? `${name}, ${postcode}` : `${name}, ${boroughName}, London`;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

function checkedSentence() {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(visibleField(areaData.checked));
  if (!match) return "";
  const month = MONTHS[Number(match[2]) - 1];
  if (!month) return "";
  return `Official sites checked ${Number(match[3])} ${month} ${match[1]}.`;
}

function categoryLinks() {
  const slugs = Array.isArray(areaData.category_links) ? areaData.category_links : [];
  return slugs.map((slug) => {
    const category = CATEGORIES.find((item) => item.slug === slug);
    if (!category) return "";
    return `<li><a href="/memorials/type/${category.slug}">${escapeHtml(category.name)}</a></li>`;
  }).filter(Boolean).join("");
}

function cemeteryArticle(cemetery, boroughName) {
  const name = visibleField(cemetery.name);
  if (!name) return "";
  const postcode = visibleField(cemetery.postcode);
  const operator = visibleField(cemetery.operator);
  const burials = visibleField(cemetery.new_burials);
  const source = safeHttpUrl(cemetery.source);
  const lines = [
    postcode ? `<p class="area-meta">Postcode: ${escapeHtml(postcode)}</p>` : "",
    operator ? `<p class="area-meta">Operator: ${escapeHtml(operator)}</p>` : "",
    burials ? `<p class="area-meta">New burials: ${escapeHtml(burials)}</p>` : "",
  ].filter(Boolean).join("");
  const links = [
    `<a href="${escapeHtml(mapsHref(name, postcode, boroughName))}">Google Maps</a>`,
    source ? `<a href="${escapeHtml(source)}" rel="noopener noreferrer">Official site</a>` : "",
  ].filter(Boolean).join("");
  return `<li><article class="area-cemetery"><h2>${escapeHtml(name)}</h2>${lines}<p class="area-actions">${links}</p></article></li>`;
}

function closingSections() {
  const checked = checkedSentence();
  const links = categoryLinks();
  return [
    checked ? `<p class="area-note">${escapeHtml(checked)}</p>` : "",
    links ? `<h2>Memorial types</h2><ul class="area-types">${links}</ul>` : "",
    `<p>${escapeHtml(PERMIT)}</p>`,
    `<h2>Talk it through with us</h2>`,
    `<p>The Finchley showroom is open Monday to Friday, 10am to 3pm.</p>`,
    `<div class="sm-cta-row">`,
    `<a href="/contact" class="sm-btn sm-btn-primary">Request a quote</a>`,
    `<a href="tel:+442038352548" class="sm-btn sm-btn-secondary">020 3835 2548</a>`,
    `<a href="/contact" class="sm-btn sm-btn-secondary">Visit the showroom</a>`,
    `</div>`,
  ].join("");
}

function crumbsHtml(items) {
  const list = items.map((item, index) => {
    const last = index === items.length - 1;
    if (last) return `<li aria-current="page">${escapeHtml(item.name)}</li>`;
    return `<li><a href="${item.path}">${escapeHtml(item.name)}</a></li>`;
  }).join("");
  return `<nav class="area-crumbs" aria-label="Breadcrumb"><ol>${list}</ol></nav>`;
}

function pageModel(resolved) {
  if (resolved.kind === "hub") {
    const names = areaData.boroughs.map((borough) => borough.name);
    const listed = names.length === 1
      ? names[0]
      : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
    return {
      path: "/areas",
      title: "Cemeteries in London | Sears Melvin",
      description: `Cemeteries in ${listed}. Our Finchley showroom (NW11 6LB) serves families across London.`,
      h1: "Memorials for cemeteries in London",
      crumbs: [
        { name: "Home", path: "/" },
        { name: "Cemeteries", path: "/areas" },
      ],
      body: [
        `<p>Our Finchley showroom (NW11 6LB) serves families across London.</p>`,
        `<p>Choose a borough to see the cemeteries there.</p>`,
        `<p>Each page names the cemeteries, with the operator and the official site where those are published.</p>`,
        `<ul class="area-list area-boroughs">${areaData.boroughs.map((borough) => {
          const count = borough.cemeteries.length;
          const label = count === 1 ? "1 cemetery" : `${count} cemeteries`;
          return `<li><a href="/areas/${borough.slug}">Memorials for cemeteries in ${escapeHtml(borough.name)} <span class="area-meta">${label}</span></a></li>`;
        }).join("")}</ul>`,
        closingSections(),
      ].join(""),
    };
  }

  const borough = resolved.borough;
  const note = visibleField(borough.intro_note);
  return {
    path: `/areas/${borough.slug}`,
    title: `Memorials for cemeteries in ${borough.name} | Sears Melvin`,
    description: `Cemeteries in ${borough.name}, with the operator and official site where those are published. Our Finchley showroom (NW11 6LB) serves families across London.`,
    h1: `Memorials for cemeteries in ${borough.name}`,
    crumbs: [
      { name: "Home", path: "/" },
      { name: "Cemeteries", path: "/areas" },
      { name: borough.name, path: `/areas/${borough.slug}` },
    ],
    body: [
      `<p>Our Finchley showroom (NW11 6LB) serves families across London.</p>`,
      `<p>The cemeteries listed here are in ${escapeHtml(borough.name)}.</p>`,
      `<p>Where a postcode, an operator, or a new-burials statement is published, it is shown with a link to the official site.</p>`,
      note ? `<p>${escapeHtml(note)}</p>` : "",
      `<ul class="area-list">${borough.cemeteries.map((cemetery) => cemeteryArticle(cemetery, borough.name)).join("")}</ul>`,
      closingSections(),
    ].join(""),
  };
}

function replaceMeta(html, attr, value) {
  const pattern = new RegExp(`(<meta\\s+${attr}\\s+content=")[^"]*(")`, "i");
  if (!pattern.test(html)) throw new Error(`area shell missing meta ${attr}`);
  return html.replace(pattern, (_match, start, end) => `${start}${escapeHtml(value)}${end}`);
}

export function renderAreaPage(shellHtml, resolved) {
  const page = pageModel(resolved);
  const canonical = `${BASE}${page.path}`;
  let html = String(shellHtml || "");
  if (!/<header class="page-header about-hero">[\s\S]*?<\/main>/.test(html)) {
    throw new Error("area shell missing page header");
  }
  html = html.replace(/<title>[^<]*<\/title>/, `<title>${escapeHtml(page.title)}</title>`);
  html = replaceMeta(html, 'name="description"', page.description);
  html = replaceMeta(html, 'property="og:title"', page.title);
  html = replaceMeta(html, 'property="og:description"', page.description);
  html = replaceMeta(html, 'property="og:url"', canonical);
  html = replaceMeta(html, 'name="twitter:title"', page.title);
  html = replaceMeta(html, 'name="twitter:description"', page.description);
  html = html.replace(
    /<link rel="canonical" href="[^"]*">/,
    `<link rel="canonical" href="${canonical}">`,
  );
  const breadcrumbLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: page.crumbs.map((crumb, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: crumb.name,
      item: `${BASE}${crumb.path === "/" ? "/" : crumb.path}`,
    })),
  };
  if (!/<!-- Structured data: Breadcrumbs -->[\s\S]*?<\/script>/.test(html)) {
    throw new Error("area shell missing breadcrumb schema");
  }
  const breadcrumbBlock = `<!-- Structured data: Breadcrumbs -->\n    ${jsonScript(breadcrumbLd)}`;
  html = html.replace(/<!-- Structured data: Breadcrumbs -->[\s\S]*?<\/script>/, () => breadcrumbBlock);
  const pageBlock = `<header class="page-header">${crumbsHtml(page.crumbs)}<h1>${escapeHtml(page.h1)}</h1></header>\n    <main class="content area-page">${page.body}</main>`;
  html = html.replace(/<header class="page-header about-hero">[\s\S]*?<\/main>/, () => pageBlock);
  html = html.replaceAll('href="/about" class="active"', 'href="/about"');
  html = html.replace(/<span class="accred-note">[^<]*NAMM[^<]*<\/span>/g, "");
  html = html.replace(/\n\s*\{ q: "How much does a headstone cost\?"[\s\S]*?\},/, "");
  html = html.replace(/\n\s*\{ q: "How does payment work\?"[\s\S]*?\},/, "");
  html = html.replace(
    '<li><a href="/memorials">Memorials</a></li>\n                <li><a href="/memorials/type/lawn-headstones">Lawn headstones</a></li>',
    '<li><a href="/memorials">Memorials</a></li>\n                <li><a href="/areas">Cemeteries</a></li>\n                <li><a href="/memorials/type/lawn-headstones">Lawn headstones</a></li>',
  );
  if (!html.includes("</head>")) throw new Error("area shell missing head");
  html = html.replace("</head>", `<style>${AREA_CSS}</style>\n</head>`);
  if (!html.includes('class="content area-page"') || /<title>[^<]*About Us/.test(html)) {
    throw new Error("area page did not replace the shell");
  }
  return html;
}

export function resolveAreaPath(pathname) {
  let path = String(pathname || "");
  try {
    path = new URL(path, BASE).pathname;
  } catch {
    return { redirect: "/memorials" };
  }
  path = path.replace(/\/{2,}/g, "/");
  const trailing = path.length > 1 && path.endsWith("/");
  if (trailing) path = path.slice(0, -1);
  if (path === "/areas.html") return { redirect: "/areas" };
  if (path === "/areas") return trailing ? { redirect: "/areas" } : { kind: "hub" };
  if (!path.startsWith("/areas/")) return { redirect: "/memorials" };
  const rest = path.slice("/areas/".length);
  if (!rest || rest.includes("/")) return { redirect: "/memorials" };
  let slug = rest.toLowerCase();
  if (slug.endsWith(".html")) slug = slug.slice(0, -5);
  if (!/^[a-z0-9-]{1,120}$/.test(slug)) return { redirect: "/memorials" };
  const borough = boroughBySlug(slug);
  if (!borough) return { redirect: "/memorials" };
  if (trailing || rest !== slug) return { redirect: `/areas/${slug}` };
  return { kind: "borough", borough };
}

function unavailable() {
  return new Response("This page is temporarily unavailable.", {
    status: 503,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

export async function handleAreaRequest({ request, env }) {
  const url = new URL(request.url);
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: { Allow: "GET, HEAD", "Cache-Control": "no-store" },
    });
  }
  const resolved = resolveAreaPath(url.pathname);
  if (resolved.redirect) {
    return new Response(null, {
      status: 301,
      headers: {
        Location: resolved.redirect + url.search,
        "Cache-Control": "public, max-age=3600",
      },
    });
  }
  let shellHtml = "";
  try {
    const shell = await env.ASSETS.fetch(new URL("/about.html", url));
    if (!shell.ok) return unavailable();
    shellHtml = await shell.text();
  } catch {
    return unavailable();
  }
  let html;
  try {
    html = renderAreaPage(shellHtml, resolved);
  } catch {
    return unavailable();
  }
  return new Response(request.method === "HEAD" ? null : html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
