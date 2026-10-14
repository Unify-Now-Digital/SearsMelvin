#!/usr/bin/env node
// Read-only live tracking check for searsmelvin.co.uk. See docs/TRACKING.md.
//
//   node scripts/tracking-check.mjs                    # check live site, exit 1 on any failure
//   node scripts/tracking-check.mjs --update-snapshot  # rewrite docs/gtm-snapshot.json from live gtm.js
//   node scripts/tracking-check.mjs --base https://<preview>.pages.dev   # check another host
//   node scripts/tracking-check.mjs --json             # machine-readable result
//
// Checks: GTM-KRDX4BQ5 on every sitemap page; phone format "020 3835 2548"
// (never "+44 20 3835 2548"); chat hook on every page; sm_lead_submit on /contact
// and sm_quote_submit on a product page; required tags/labels in the live
// gtm.js; and GTM drift against the committed docs/gtm-snapshot.json.
// Needs Node 18+ (global fetch). No dependencies, no writes except --update-snapshot.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

export const GTM_ID = "GTM-KRDX4BQ5";
export const GA4_ID = "G-RF3LYJMFVE";
export const ADS_ID = "AW-16866941615";
export const PHONE = "020 3835 2548";
export const BAD_PHONE = "+44 20 3835 2548";
// Tags that must exist in the live container: [function, id (event name / label / tag id), trigger must mention]
export const REQUIRED_TAGS = [
  ["__googtag", GA4_ID, "gtm.init"],
  ["__googtag", ADS_ID, "gtm.init"],
  ["__gaawe", "generate_lead", "sm_lead_submit"],
  ["__awct", "_M8_CK2IrYkcEK-15Oo-", "sm_lead_submit"],          // Ads generate_lead
  ["__gaawe", "request_quote", "sm_quote_submit"],               // GTM v21+ (was #quoteSuccessMsg visibility)
  ["__awct", "l5TiCLCIrYkcEK-15Oo-", "sm_quote_submit"],         // Ads request_quote
  ["__gaawe", "ghl_chat_submission", "sm_chat_submit"],
  ["__awct", "MipOCNXwuLscEK-15Oo-", "sm_chat_submit"],          // Ads Chat start
  ["__awct", "okRkCPGTqJsdEK-15Oo-", "gtm.linkClick"],          // Ads tel-link click-to-call
  ["__awcc", "K1otCIWr1JodEK-15Oo-", "gtm.js"],                  // Google forwarding number swap
  ["__gaawe", "brochure_download", "brochure_download"],
];

export const BEACON_EVENTS = ["generate_lead", "request_quote"];

const here = dirname(fileURLToPath(import.meta.url));
export const SNAPSHOT_PATH = join(here, "..", "docs", "gtm-snapshot.json");

// ---- gtm.js -> normalised snapshot --------------------------------------
export function parseGtm(js) {
  const m = js.match(/var data = (\{[\s\S]*?\});\s*\n/);
  if (!m) throw new Error("could not find container data in gtm.js");
  const r = JSON.parse(m[1]).resource;
  const macro = (a) => {
    if (!Array.isArray(a) || a[0] !== "macro") return a;
    const mc = r.macros[a[1]] || {};
    return `{{${mc.function}${mc.vtp_name ? ":" + mc.vtp_name : mc.vtp_component ? ":" + mc.vtp_component : ""}}}`;
  };
  const pred = (i) => { const p = r.predicates[i]; return `${p.function}(${macro(p.arg0)},${p.arg1})`; };
  const tags = r.tags.map((t, n) => {
    const rules = r.rules.filter((ru) => ru.some((x) => x[0] === "add" && x.slice(1).includes(n)));
    const triggers = rules.map((ru) => ru.filter((x) => x[0] === "if" || x[0] === "unless")
      .map((x) => `${x[0]} ${x.slice(1).map(pred).join(" && ")}`).join(" ; ")).sort();
    return {
      function: t.function,
      id: t.vtp_eventName || t.vtp_conversionLabel || t.vtp_tagId || null,
      value: Array.isArray(t.vtp_conversionValue) ? "{{variable}}" : (t.vtp_conversionValue ?? null),
      params: Object.fromEntries((t.vtp_eventSettingsTable || []).slice(1).filter((r) => Array.isArray(r))
        .map((r) => [r[2], Array.isArray(r[4]) ? (r[4][0] === "macro" ? "{{variable}}" : JSON.stringify(r[4])) : r[4]])),
      triggers,
    };
  });
  tags.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return { container: GTM_ID, version: (js.match(/"version":"(\d+)"/) || [])[1] || null, tags };
}

export function requiredTagProblems(snap) {
  const out = [];
  for (const [fn, id, trig] of REQUIRED_TAGS) {
    const ts = snap.tags.filter((x) => x.function === fn && x.id === id);
    if (!ts.length) { out.push(`GTM tag missing: ${fn} ${id}`); continue; }
    if (trig && !ts.some((t) => t.triggers.some((s) => s.includes(trig)))) out.push(`GTM tag ${fn} ${id} no longer triggers on ${trig}`);
  }
  for (const ev of BEACON_EVENTS) {
    if (!snap.tags.some((t) => t.function === "__gaawe" && t.id === ev && t.params?.transport_type === "beacon"))
      out.push(`GA4 ${ev} tag lost transport_type=beacon`);
  }
  return out;
}

export function driftProblems(committed, live) {
  const key = (t) => JSON.stringify(t);
  const a = new Set(committed.tags.map(key)), b = new Set(live.tags.map(key));
  return [
    ...[...a].filter((k) => !b.has(k)).map((k) => `GTM drift: tag changed/removed since snapshot: ${k}`),
    ...[...b].filter((k) => !a.has(k)).map((k) => `GTM drift: new/changed tag not in snapshot: ${k}`),
  ];
}

// ---- page checks ---------------------------------------------------------
export function pageProblems(path, html) {
  const out = [];
  if (!html.includes(GTM_ID)) out.push(`${path}: GTM ${GTM_ID} missing`);
  if (html.includes(BAD_PHONE)) out.push(`${path}: phone shown as "${BAD_PHONE}" (must be "${PHONE}")`);
  if (!html.includes(PHONE)) out.push(`${path}: phone "${PHONE}" not found`);
  if (!/registerBeforeSubmit\(chatSubmitted\)/.test(html)) out.push(`${path}: chat beforeSubmit hook missing`);
  for (const m of html.matchAll(/<a[^>]*href="tel:[^"]+"[^>]*>([\s\S]*?)<\/a>/g)) {
    if (!m[1].replace(/<[^>]+>/g, "").includes(PHONE)) { out.push(`${path}: tel: link without visible "${PHONE}"`); break; }
  }
  if (/href=["'](\/|https?:\/\/(www\.)?searsmelvin\.co\.uk)[^"']*utm_/i.test(html)) out.push(`${path}: internal link with utm_*`);
  return out;
}

async function get(url) {
  const res = await fetch(url, { headers: { "User-Agent": "sm-tracking-check/1.0" }, redirect: "follow" });
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return res.text();
}

async function main() {
  const args = process.argv.slice(2);
  const base = (args.includes("--base") ? args[args.indexOf("--base") + 1] : "https://searsmelvin.co.uk").replace(/\/$/, "");
  const live = parseGtm(await get(`https://www.googletagmanager.com/gtm.js?id=${GTM_ID}`));
  if (args.includes("--update-snapshot")) {
    writeFileSync(SNAPSHOT_PATH, JSON.stringify(live, null, 2) + "\n");
    console.log(`wrote ${SNAPSHOT_PATH} (${live.tags.length} tags)`);
    return;
  }
  const problems = [...requiredTagProblems(live)];
  try { problems.push(...driftProblems(JSON.parse(readFileSync(SNAPSHOT_PATH, "utf8")), live)); }
  catch (e) { problems.push(`snapshot unreadable: ${e.message}`); }

  const sitemap = await get(`${base}/sitemap.xml`);
  const paths = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => new URL(m[1]).pathname);
  if (!paths.length) problems.push("sitemap.xml has no URLs");
  let checked = 0, productPath = null;
  const queue = [...new Set(paths)];
  await Promise.all(Array.from({ length: 6 }, async () => {
    while (queue.length) {
      const p = queue.shift();
      try {
        const html = await get(base + p);
        checked++;
        problems.push(...pageProblems(p, html));
        if (p === "/contact" && !/event: 'sm_lead_submit'/.test(html)) problems.push("/contact: sm_lead_submit push missing");
        if (p.startsWith("/memorials/")) {
          productPath ||= p;
          if (!/event: 'sm_quote_submit'/.test(html)) problems.push(`${p}: sm_quote_submit push missing`);
        }
      } catch (e) { problems.push(String(e.message || e)); }
    }
  }));
  if (!productPath) problems.push("no /memorials/<product> page in sitemap to check sm_quote_submit");
  const result = { ok: problems.length === 0, base, gtm_version: live.version, pages_checked: checked, problems };
  if (args.includes("--json")) console.log(JSON.stringify(result, null, 2));
  else {
    console.log(`tracking-check ${result.ok ? "OK" : "FAILED"}: ${checked} pages, GTM version ${live.version}, ${problems.length} problem(s)`);
    for (const p of problems) console.log(" - " + p);
  }
  process.exitCode = result.ok ? 0 : 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => { console.error("tracking-check error:", e.message || e); process.exitCode = 2; });
}
