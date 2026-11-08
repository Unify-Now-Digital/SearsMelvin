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

// Masks: none.
// The installations carousel is frozen at translate3d(0,0,0). It is not masked.
// The family quotes are static HTML. They are not masked.
// No Cloudflare beacon and no live review widget is painted on these pages.
const STABLE_CSS = `
  html { scroll-behavior: auto !important; }
  #cookieConsent,
  #scrollTopBtn,
  .scroll-top,
  iframe[title*="chat" i],
  #lc_text-widget,
  [class*="lc_text-widget"],
  .chat-widget {
    display: none !important;
  }
  *, *::before, *::after {
    animation: none !important;
    transition: none !important;
    caret-color: transparent !important;
  }
  .animate-in,
  .reveal,
  .reveal-left,
  .reveal-right,
  .reveal-stagger,
  .reveal-stagger > * {
    opacity: 1 !important;
    transform: none !important;
  }
  #installationsTrack {
    transform: translate3d(0, 0, 0) !important;
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
    host === "connect.facebook.net" ||
    host.endsWith("cloudflareinsights.com")
  );
}

function compressPng(file: string): void {
  // Lossless only. A lossy quantiser picks a new palette each run and
  // makes two identical pages fail a zero-pixel compare.
  try {
    execFileSync("optipng", ["-o1", "-quiet", file], { stdio: "ignore" });
  } catch {
    // Keep the Playwright PNG when optipng is missing.
  }
}

async function settle(page: Page, spec: PageSpec): Promise<void> {
  await page.waitForSelector(spec.ready, { timeout: 30_000 });
  if (spec.path === "/") {
    await page.waitForFunction(
      () => {
        const track = document.getElementById("installationsTrack");
        const cats = document.getElementById("categoriesGrid");
        return Boolean(track && track.querySelector("img") && cats && cats.children.length > 0);
      },
      { timeout: 30_000 },
    );
  }
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
        const text = document.body ? document.body.innerText : "";
        return Boolean(
          crumb &&
            name &&
            !String(crumb.textContent || "").includes("Loading") &&
            name.textContent &&
            name.textContent.trim() !== "Memorial" &&
            !text.includes("Loading colours") &&
            !text.includes("Loading extras"),
        );
      },
      { timeout: 30_000 },
    );
  }
  await page.addStyleTag({ content: STABLE_CSS });
  const pending = await page.evaluate(async () => {
    const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    const ready = (img: HTMLImageElement) => {
      const src = img.getAttribute("src") || "";
      if (!src) return true;
      return img.complete && img.naturalWidth > 0;
    };
    const arm = () => {
      for (const img of document.images) {
        img.loading = "eager";
        img.decoding = "sync";
      }
    };
    let lastHeight = -1;
    for (let pass = 0; pass < 6; pass++) {
      arm();
      const total = Math.max(document.body.scrollHeight, document.documentElement.scrollHeight);
      const step = Math.max(200, Math.floor(window.innerHeight * 0.6));
      for (let y = 0; y <= total; y += step) {
        window.scrollTo(0, y);
        await sleep(60);
      }
      window.scrollTo(0, total);
      await sleep(100);
      if (total === lastHeight) break;
      lastHeight = total;
    }
    window.scrollTo(0, 0);
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      arm();
      const waiting = [...document.images].filter((img) => !ready(img));
      if (waiting.length === 0) break;
      waiting[0].scrollIntoView({ block: "center", inline: "center" });
      await sleep(250);
    }
    window.scrollTo(0, 0);
    if (document.fonts && document.fonts.ready) await document.fonts.ready;
    const track = document.getElementById("installationsTrack");
    if (track) track.style.setProperty("transform", "translate3d(0,0,0)", "important");
    return [...document.images]
      .filter((img) => !ready(img))
      .map((img) => img.currentSrc || img.src)
      .slice(0, 8);
  });
  if (pending.length) {
    throw new Error(`images not loaded: ${pending.join(" | ")}`);
  }
  await page.waitForLoadState("networkidle", { timeout: 20_000 });
  await page.evaluate(() => window.scrollTo(0, 0));
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
      if (process.env.VISUAL_COMPRESS !== "0") compressPng(file);
    });
  }
}
