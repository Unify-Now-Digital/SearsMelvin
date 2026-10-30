/**
 * Dynamic sitemap.xml — pulls active products from Supabase so search engines
 * can crawl the catalogue without a manual rebuild on every product change.
 *
 * Path: /sitemap.xml (Cloudflare Pages routes the .js file to this URL).
 */

import { publishableKey, publicSupabaseUrl, supabaseKeyHeaders } from "./api/_supabase-keys.js";

const BASE = "https://searsmelvin.co.uk";
const SM_ORG_ID = "3770972d-1bbd-417b-b413-297e844db285";

// Static, hand-maintained set. Customer-facing only — never list /admin,
// /track, /quote (noindex or login-gated). /partner 301s off-site.
const STATIC_PAGES = [
  { path: "/",                priority: "1.0",  changefreq: "weekly"  },
  { path: "/memorials",       priority: "0.9",  changefreq: "weekly"  },
  { path: "/contact",         priority: "0.8",  changefreq: "monthly" },
  { path: "/about",           priority: "0.7",  changefreq: "monthly" },
  { path: "/brochure",        priority: "0.6",  changefreq: "monthly" },
  { path: "/care-guide",      priority: "0.6",  changefreq: "monthly" },
  { path: "/faq",             priority: "0.6",  changefreq: "monthly" },
  { path: "/resources",       priority: "0.6",  changefreq: "monthly" },
  { path: "/terms",           priority: "0.3",  changefreq: "yearly"  },
  { path: "/privacy",         priority: "0.3",  changefreq: "yearly"  },
];

function escXml(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

async function fetchProducts(env) {
  // Public crawler route: use only the same public anon role as the catalogue,
  // never the all-powerful service-role key.
  const url = publicSupabaseUrl(env);
  try {
    const res = await fetch(
      `${url}/rest/v1/products?organization_id=eq.${encodeURIComponent(env.SM_ORG_ID || SM_ORG_ID)}&is_active=eq.true&is_listed=eq.true&category_id=not.is.null&select=slug,updated_at,created_at&order=display_order.asc`,
      { headers: supabaseKeyHeaders(publishableKey(env)) },
    );
    if (!res.ok) return [];
    return await res.json();
  } catch {
    return [];
  }
}

function todayIso() {
  return new Date().toISOString().split("T")[0];
}

function urlEntry({ loc, lastmod, priority, changefreq }) {
  return [
    "  <url>",
    `    <loc>${escXml(loc)}</loc>`,
    lastmod ? `    <lastmod>${escXml(lastmod)}</lastmod>` : null,
    changefreq ? `    <changefreq>${escXml(changefreq)}</changefreq>` : null,
    priority ? `    <priority>${escXml(priority)}</priority>` : null,
    "  </url>",
  ].filter(Boolean).join("\n");
}

export async function onRequestGet({ env }) {
  const products = await fetchProducts(env);
  const today = todayIso();

  const staticEntries = STATIC_PAGES.map((p) =>
    urlEntry({
      loc: BASE + p.path,
      lastmod: today,
      priority: p.priority,
      changefreq: p.changefreq,
    }),
  );

  const productEntries = products.map((p) =>
    urlEntry({
      loc: `${BASE}/memorials/${encodeURIComponent(p.slug)}`,
      lastmod: (p.updated_at || p.created_at || today).split("T")[0],
      priority: "0.7",
      changefreq: "monthly",
    }),
  );

  const xml =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    [...staticEntries, ...productEntries].join("\n") +
    `\n</urlset>\n`;

  return new Response(xml, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      // Pages caches for an hour at the edge; products won't change that often.
      "Cache-Control": "public, max-age=3600",
    },
  });
}
