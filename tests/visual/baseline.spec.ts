// Full-page reference shots for the design-system baseline.
// Run from the repo root:
//   npm --prefix tests/visual install
//   npx --prefix tests/visual playwright install chromium
//   npm --prefix tests/visual run baseline
//
// BASE_URL overrides the host. The default is https://searsmelvin.co.uk.
// VISUAL_OUT overrides the output folder. The default is tests/visual/baseline/.
// A preview run should set VISUAL_OUT so it does not replace the reference PNGs.
//
// The script does not submit a form. It does not change the site.

import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { test, type Page } from "@playwright/test";
import { PAGES, WIDTHS, type PageSpec } from "./pages";

const STABLE_CSS = `
  #cookieConsent,
  #scrollTopBtn,
  .scroll-top,
  iframe[title*="chat" i],
  #lc_text-widget,
  [class*="lc_text-widget"],
  .chat-widget {
    display: none !important;
  }
  .animate-in,
  .reveal,
  .reveal-left,
  .reveal-right,
  .reveal-stagger,
  .reveal-stagger > * {
    opacity: 1 !important;
    transform: none !important;
    animation: none !important;
    transition: none !important;
  }
`;

function outputDir(): string {
  if (process.env.VISUAL_OUT) return path.resolve(process.env.VISUAL_OUT);
  return path.resolve("baseline");
}

function blockNoise(host: string): boolean {
  return (
    host === "www.googletagmanager.com" ||
    host.endsWith(".googletagmanager.com") ||
    host === "www.google-analytics.com" ||
    host.endsWith(".google-analytics.com") ||
    host.endsWith("googleadservices.com") ||
    host.endsWith("doubleclick.net") ||
    host.endsWith("leadconnectorhq.com") ||
    host.endsWith("msgsndr.com") ||
    host === "connect.facebook.net"
  );
}

function compressPng(file: string): void {
  try {
    execFileSync(
      "pngquant",
      ["--force", "--skip-if-larger", "--quality=55-80", "--speed", "1", "--output", file, file],
      { stdio: "ignore" },
    );
  } catch {
    // Keep the Playwright PNG when pngquant is missing or declines the file.
  }
}

async function settle(page: Page, spec: PageSpec): Promise<void> {
  await page.waitForSelector(spec.ready, { timeout: 30_000 });
  if (spec.path === "/memorials") {
    await page.waitForFunction(
      () => document.querySelectorAll("a.product-card").length > 0 && !document.getElementById("productsLoading"),
      { timeout: 30_000 },
    );
  }
  if (spec.slug === "the-castell" || spec.slug === "the-hartwell" || spec.slug === "the-petworth-heart") {
    await page.waitForFunction(
      () => {
        const crumb = document.querySelector("#breadcrumb");
        const name = document.querySelector("#productName");
        const img = document.querySelector("#galleryMainImg") as HTMLImageElement | null;
        const text = document.body ? document.body.innerText : "";
        return Boolean(
          crumb &&
            name &&
            img &&
            !String(crumb.textContent || "").includes("Loading") &&
            name.textContent &&
            name.textContent.trim() !== "Memorial" &&
            !text.includes("Loading colours") &&
            !text.includes("Loading extras") &&
            img.complete &&
            img.naturalWidth > 0,
        );
      },
      { timeout: 30_000 },
    );
  }
  await page.addStyleTag({ content: STABLE_CSS });
  await page.evaluate(async () => {
    const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    const total = () => Math.max(document.body.scrollHeight, document.documentElement.scrollHeight);
    const step = Math.max(300, Math.floor(window.innerHeight * 0.85));
    for (let y = 0; y < total(); y += step) {
      window.scrollTo(0, y);
      await sleep(40);
    }
    window.scrollTo(0, 0);
    const pending = [...document.images].filter((img) => !img.complete);
    await Promise.race([
      Promise.all(
        pending.map(
          (img) =>
            new Promise((resolve) => {
              img.addEventListener("load", () => resolve(null), { once: true });
              img.addEventListener("error", () => resolve(null), { once: true });
            }),
        ),
      ),
      sleep(12_000),
    ]);
    if (document.fonts && document.fonts.ready) await document.fonts.ready;
  });
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try {
      localStorage.setItem("cookieConsent", "accepted");
    } catch (_e) {
      /* private mode */
    }
  });
  await page.route("**/*", (route) => {
    let host = "";
    try {
      host = new URL(route.request().url()).hostname;
    } catch (_e) {
      return route.continue();
    }
    if (blockNoise(host)) return route.abort();
    return route.continue();
  });
});

for (const spec of PAGES) {
  for (const size of WIDTHS) {
    test(`${spec.slug} at ${size.width}px`, async ({ page }) => {
      await page.setViewportSize({ width: size.width, height: size.height });
      const response = await page.goto(spec.path, { waitUntil: "domcontentloaded", timeout: 45_000 });
      if (!response || !response.ok()) {
        throw new Error(`${spec.path} returned HTTP ${response ? response.status() : "no response"}`);
      }
      await settle(page, spec);
      const dir = path.join(outputDir(), size.name);
      mkdirSync(dir, { recursive: true });
      const file = path.join(dir, `${spec.slug}.png`);
      await page.screenshot({
        path: file,
        fullPage: true,
        animations: "disabled",
        caret: "hide",
        scale: "css",
        type: "png",
      });
      compressPng(file);
    });
  }
}
