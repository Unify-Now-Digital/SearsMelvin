/**
 * Dynamic sitemap.xml — pulls active products from Supabase so search engines
 * can crawl the catalogue without a manual rebuild on every product change.
 *
 * Path: /sitemap.xml (Cloudflare Pages routes the .js file to this URL).
 */

const BASE = "https://searsmelvin.co.uk";

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
  // Most Pages Functions configure SUPABASE_SERVICE_KEY for server-side use;
  // accept either that or SUPABASE_ANON_KEY (read-only) so we don't depend on
  // a separate env var that's easy to forget when provisioning a new env.
  const key = env.SUPABASE_SERVICE_KEY || env.SUPABASE_ANON_KEY;
  if (!env.SUPABASE_URL || !key) return [];
  try {
    const res = await fetch(
      `${env.SUPABASE_URL}/rest/v1/products?is_active=eq.true&select=slug,updated_at,created_at&order=display_order.asc`,
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
