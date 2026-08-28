/**
 * Dynamic sitemap.xml — pulls active products from Supabase so search engines
 * can crawl the catalogue without a manual rebuild on every product change.
 *
 * Path: /sitemap.xml (Cloudflare Pages routes the .js file to this URL).
 */

const BASE = "https://searsmelvin.co.uk";
const PUBLIC_SUPABASE_URL = "https://bfwohzcugtwbhhxdqgme.supabase.co";
const SM_ORG_ID = "3770972d-1bbd-417b-b413-297e844db285";
const PUBLIC_SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJmd29oemN1Z3R3YmhoeGRxZ21lIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjgyMDA0NTIsImV4cCI6MjA4Mzc3NjQ1Mn0.QbEq1y3hczoRzcCrdajPmpPNkeh5A7jkAsfHP9BSAGg";

// Static, hand-maintained set. Customer-facing only — never list /admin,
// /track, /partner, /quote (all noindex or login-gated).
const STATIC_PAGES = [
  { path: "/",                priority: "1.0",  changefreq: "weekly"  },
  { path: "/memorials",       priority: "0.9",  changefreq: "weekly"  },
  { path: "/contact",         priority: "0.8",  changefreq: "monthly" },
  { path: "/care-guide",      priority: "0.6",  changefreq: "monthly" },
  { path: "/faq",             priority: "0.6",  changefreq: "monthly" },
  { path: "/permit-checker",  priority: "0.5",  changefreq: "monthly" },
  { path: "/resources",       priority: "0.6",  changefreq: "monthly" },
  { path: "/areas/barnet",    priority: "0.8",  changefreq: "monthly" },
  { path: "/areas/brent",     priority: "0.8",  changefreq: "monthly" },
  { path: "/areas/camden",    priority: "0.8",  changefreq: "monthly" },
  { path: "/areas/enfield",   priority: "0.8",  changefreq: "monthly" },
  { path: "/areas/haringey",  priority: "0.8",  changefreq: "monthly" },
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
  const url = env.SUPABASE_URL || PUBLIC_SUPABASE_URL;
  const key = env.SUPABASE_ANON_KEY || PUBLIC_SUPABASE_KEY;
  try {
    const res = await fetch(
      `${url}/rest/v1/products?organization_id=eq.${encodeURIComponent(env.SM_ORG_ID || SM_ORG_ID)}&is_active=eq.true&is_listed=eq.true&category_id=not.is.null&select=slug,updated_at,created_at&order=display_order.asc`,
      {
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
        },
      },
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
