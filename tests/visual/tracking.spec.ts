// Live tracking smoke test for the design-system baseline.
// It does not submit a form. Requests to /api/submit, /api/brochure,
// /api/quotes, /api/click-intent, and /api/upload-photo are aborted.
// On 8 November 2026 the live site did not push view_item_list,
// select_item, or filter_select. Those three checks fail.
// Leave the site pages unchanged. Record the result in
// docs/design-system/baseline.md.
//
//   npm --prefix tests/visual run tracking
//   BASE_URL=https://<preview> npm --prefix tests/visual run tracking

import { spawnSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page, type Response } from "@playwright/test";
import { GA4_ID, GTM_ID, PAGES, PHONE_TEXT } from "./pages";

type Check = { name: string; pass: boolean; detail: string };

const BLOCKED_APIS = ["/api/submit", "/api/brochure", "/api/quotes", "/api/click-intent", "/api/upload-photo"];

function phoneDigits(href: string): string {
  return href.replace(/\D/g, "");
}

function phoneHrefOk(href: string): boolean {
  const digits = phoneDigits(href);
  return digits === "442038352548" || digits === "02038352548";
}

function parserPath(): string {
  let dir = process.cwd();
  for (let i = 0; i < 4; i++) {
    const candidate = path.join(dir, "scripts", "tracking-check.mjs");
    if (existsSync(candidate)) return candidate;
    dir = path.dirname(dir);
  }
  throw new Error("scripts/tracking-check.mjs was not found");
}

function clickToCallValues(gtmJs: string): { version: string | null; ads: string | null; ga4: string | null; currency: string | null } {
  const esm = `
    import { readFileSync } from "node:fs";
    import { parseGtm } from ${JSON.stringify(parserPath())};
    const live = parseGtm(readFileSync(0, "utf8"));
    const ads = live.tags.find((tag) => tag.function === "__awct" && tag.id === "okRkCPGTqJsdEK-15Oo-");
    const ga4 = live.tags.find((tag) => tag.function === "__gaawe" && tag.id === "click_to_call");
    process.stdout.write(JSON.stringify({
      version: live.version,
      ads: ads ? ads.value : null,
      ga4: ga4 && ga4.params ? ga4.params.value : null,
      currency: ga4 && ga4.params ? ga4.params.currency : null,
    }));
  `;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", esm], {
    input: gtmJs,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || "could not parse gtm.js").trim());
  }
  return JSON.parse(result.stdout);
}

test("tracking smoke checks", async ({ page }) => {
  test.setTimeout(240_000);
  const checks: Check[] = [];
  const blockedHits: string[] = [];

  function record(name: string, pass: boolean, detail: string) {
    checks.push({ name, pass, detail });
    expect.soft(pass, `${name}. ${detail}`).toBe(true);
  }

  await page.addInitScript(() => {
    try {
      localStorage.setItem("cookieConsent", "accepted");
    } catch (_e) {
      /* private mode */
    }
  });

  await page.route("**/*", (route) => {
    const url = route.request().url();
    let host = "";
    try {
      host = new URL(url).hostname;
    } catch (_e) {
      return route.continue();
    }
    if (host.endsWith("leadconnectorhq.com") || host.endsWith("msgsndr.com")) return route.abort();
    if (BLOCKED_APIS.some((api) => url.includes(api))) {
      blockedHits.push(`${route.request().method()} ${url}`);
      return route.abort();
    }
    return route.continue();
  });

  async function eventsOf(current: Page): Promise<string[]> {
    return current.evaluate(() => {
      const dl = (window as unknown as { dataLayer?: unknown[] }).dataLayer || [];
      const out: string[] = [];
      for (const entry of dl) {
        if (!entry || typeof entry !== "object") continue;
        const record = entry as { event?: unknown; 0?: unknown; 1?: unknown };
        if (typeof record.event === "string") out.push(record.event);
        if ((record[0] === "event" || record[0] === "config") && typeof record[1] === "string") {
          out.push(`${record[0]}:${record[1]}`);
        }
      }
      return out;
    });
  }

  async function hasEvent(current: Page, eventName: string): Promise<boolean> {
    const events = await eventsOf(current);
    return events.some((event) => event === eventName || event === `event:${eventName}`);
  }

  async function waitForEvent(current: Page, eventName: string, timeoutMs: number): Promise<string[]> {
    const start = Date.now();
    let events: string[] = [];
    while (Date.now() - start < timeoutMs) {
      events = await eventsOf(current);
      if (events.some((event) => event === eventName || event === `event:${eventName}`)) return events;
      await current.waitForTimeout(250);
    }
    return events;
  }

  const gtmFailures: string[] = [];
  const telFailures: string[] = [];
  const quoteFormFailures: string[] = [];
  let gtmSource = "";
  let ga4Detail = "";
  let ga4Pass = false;
  const seenGa4: string[] = [];

  async function visit(path: string): Promise<Response | null> {
    const gtmResponse = page
      .waitForResponse((res) => res.url().includes("gtm.js") && res.url().includes(GTM_ID), { timeout: 25_000 })
      .catch(() => null);
    const response = await page.goto(path, { waitUntil: "domcontentloaded", timeout: 45_000 });
    const gtm = await gtmResponse;
    if (gtm && gtm.status() === 200 && !gtmSource) {
      try {
        gtmSource = await gtm.text();
      } catch (_e) {
        gtmSource = "";
      }
    }
    const sourceHasId = (await page.content()).includes(GTM_ID);
    if (!sourceHasId || !gtm || gtm.status() !== 200) {
      gtmFailures.push(
        `${path}: source ${sourceHasId ? "has" : "lacks"} ${GTM_ID}; gtm.js status ${gtm ? gtm.status() : "missing"}`,
      );
    }
    const tel = await page.evaluate((phone) => {
      function textNodes(root: Node): string[] {
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        const out: string[] = [];
        let current = walker.nextNode();
        while (current) {
          out.push(current.textContent || "");
          current = walker.nextNode();
        }
        return out;
      }
      return [...document.querySelectorAll('a[href^="tel:"]')].map((node) => {
        const anchor = node as HTMLAnchorElement;
        const nodes = textNodes(anchor);
        return {
          href: anchor.getAttribute("href") || "",
          unbroken: nodes.some((text) => text.includes(phone)),
        };
      });
    }, PHONE_TEXT);
    if (tel.length === 0) telFailures.push(`${path}: no tel link`);
    for (const link of tel) {
      if (!phoneHrefOk(link.href) || !link.unbroken) {
        telFailures.push(`${path}: href ${link.href || "(empty)"}; unbroken text ${link.unbroken}`);
      }
    }
    return response;
  }

  page.on("response", (res) => {
    const url = res.url();
    if (url.includes(GA4_ID)) seenGa4.push(url.split("?")[0]);
  });

  await page.setViewportSize({ width: 1280, height: 800 });

  await visit("/");
  const ga4Start = Date.now();
  while (Date.now() - ga4Start < 15_000) {
    const inLayer = await page.evaluate((id) => {
      const dl = (window as unknown as { dataLayer?: unknown[] }).dataLayer || [];
      try {
        if (JSON.stringify(dl).includes(id)) return true;
      } catch (_e) {
        /* ignore */
      }
      const entries = performance.getEntriesByType("resource").map((entry) => entry.name);
      return entries.some((name) => name.includes(id));
    }, GA4_ID);
    if (inLayer || seenGa4.length > 0) {
      ga4Pass = true;
      break;
    }
    await page.waitForTimeout(400);
  }
  ga4Detail = ga4Pass
    ? `GA4 ${GA4_ID} was configured on the home page.`
    : `GA4 ${GA4_ID} was not seen in network requests, resource timing, or dataLayer.`;

  const homeBrochure = await page.locator("a[data-brochure-source]").count();

  await visit("/memorials");
  await page.waitForFunction(
    () => document.querySelectorAll("a.product-card").length > 0 && !document.getElementById("productsLoading"),
    { timeout: 30_000 },
  );

  const formCount = await page.locator("form").count();
  const listingBrochure = await page.locator("a[data-brochure-source]").count();
  const shortlist = await page.evaluate(() => {
    const buttons = [...document.querySelectorAll("[class*='shortlist-btn-']")];
    return {
      count: buttons.length,
      copy: Boolean(document.querySelector(".shortlist-btn-copy")),
      email: Boolean(document.querySelector(".shortlist-btn-email")),
      bad: buttons
        .filter((node) => ![...node.classList].some((name) => name.startsWith("shortlist-btn-")))
        .map((node) => node.className),
    };
  });

  const listEvents = await waitForEvent(page, "view_item_list", 5_000);
  const listPass = listEvents.some((event) => event === "view_item_list" || event === "event:view_item_list");

  const card = page.locator("a.product-card:not(.hidden)").first();
  await card.scrollIntoViewIfNeeded();
  await card.evaluate((node) => {
    node.addEventListener(
      "click",
      (event) => {
        event.preventDefault();
      },
      true,
    );
  });
  await card.click({ timeout: 10_000 });
  const selectEvents = await waitForEvent(page, "select_item", 5_000);
  const selectPass = selectEvents.some((event) => event === "select_item" || event === "event:select_item");

  const filter = page.locator("#typeFilters label.filter-option").first();
  await filter.scrollIntoViewIfNeeded();
  await filter.click({ timeout: 10_000 });
  const filterEvents = await waitForEvent(page, "filter_select", 5_000);
  const filterPass = filterEvents.some((event) => event === "filter_select" || event === "event:filter_select");

  for (const spec of PAGES.filter((item) => item.slug.startsWith("the-"))) {
    await visit(spec.path);
    const count = await page.locator("#quoteForm").count();
    if (count !== 1) quoteFormFailures.push(`${spec.path}: #quoteForm count ${count}`);
  }

  for (const spec of PAGES.filter((item) => ["quote", "contact", "about"].includes(item.slug))) {
    await visit(spec.path);
  }

  await visit("/brochure");
  const brochureLink = await page.locator("[data-brochure-link]").count();
  const brochureEmail = await page.locator("form[data-brochure-email-form]").count();

  const unique = (events: string[]) => [...new Set(events)].slice(0, 24).join(", ") || "(none)";

  record(
    "GTM-KRDX4BQ5 loads",
    gtmFailures.length === 0,
    gtmFailures.length === 0
      ? `gtm.js?id=${GTM_ID} returned HTTP 200 on the 8 pages and on /brochure.`
      : gtmFailures.join(" "),
  );
  record("GA4 G-RF3LYJMFVE is configured", ga4Pass, ga4Detail);
  let callValuePass = false;
  let callValueDetail = "The live gtm.js response was not captured.";
  if (gtmSource) {
    try {
      const live = clickToCallValues(gtmSource);
      callValuePass = live.ads === "150" && live.ga4 === "150" && live.currency === "GBP";
      callValueDetail = callValuePass
        ? `Live GTM v${live.version} sends 150 for the Ads click-to-call tag and 150 GBP for the GA4 click_to_call event. The test did not click a tel link.`
        : `Ads click-to-call value is ${live.ads}. GA4 click_to_call value is ${live.ga4} ${live.currency}. Expected 150 GBP.`;
    } catch (error) {
      callValueDetail = error instanceof Error ? error.message : String(error);
    }
  }
  record("click-to-call value is 150", callValuePass, callValueDetail);
  record(
    "view_item_list on /memorials",
    listPass,
    listPass
      ? "dataLayer received view_item_list after the product grid rendered."
      : `dataLayer did not receive view_item_list. Events seen: ${unique(listEvents)}.`,
  );
  record(
    "select_item on product card click",
    selectPass,
    selectPass
      ? "dataLayer received select_item after a product card click. The click did not open the product page."
      : `dataLayer did not receive select_item. Events seen: ${unique(selectEvents)}.`,
  );
  record(
    "filter_select on a filter change",
    filterPass,
    filterPass
      ? "dataLayer received filter_select after a type filter change."
      : `dataLayer did not receive filter_select. Events seen: ${unique(filterEvents)}.`,
  );
  record(
    "shortlist-btn- classes",
    shortlist.copy && shortlist.email && shortlist.bad.length === 0,
    shortlist.copy && shortlist.email && shortlist.bad.length === 0
      ? `Found .shortlist-btn-copy and .shortlist-btn-email (${shortlist.count} matching elements).`
      : `copy ${shortlist.copy}; email ${shortlist.email}; bad classes ${shortlist.bad.join(", ") || "(none)"}.`,
  );
  record(
    "tel links show 020 3835 2548 as unbroken text",
    telFailures.length === 0,
    telFailures.length === 0
      ? `Every tel link on the checked pages points at ${PHONE_TEXT} and contains that text in one text node.`
      : telFailures.join(" "),
  );
  const hooksPass =
    quoteFormFailures.length === 0 && homeBrochure > 0 && listingBrochure > 0 && brochureLink > 0 && brochureEmail > 0;
  record(
    "#quoteForm and the brochure hooks exist",
    hooksPass,
    hooksPass
      ? "#quoteForm is on the three product pages. Brochure hooks are on the home page, /memorials, and /brochure."
      : `quoteForm ${quoteFormFailures.join("; ") || "ok"}; home brochure links ${homeBrochure}; listing brochure links ${listingBrochure}; brochure download links ${brochureLink}; brochure email forms ${brochureEmail}.`,
  );
  record(
    "/memorials has no form",
    formCount === 0,
    formCount === 0 ? "The memorials list has 0 form elements after the grid renders." : `The memorials list has ${formCount} form elements.`,
  );

  writeFileSync("tracking-results.json", JSON.stringify({ checks, blockedHits }, null, 2) + "\n");
  console.log(JSON.stringify({ checks, blockedHits }, null, 2));
  expect(blockedHits, "a blocked API was called; the test must not submit a form").toEqual([]);
});
