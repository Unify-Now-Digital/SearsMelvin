import { chromium } from "/workspace/bcn-trip/node_modules/playwright/index.mjs";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const OUT = "/workspace/brochure-emails-1120";
const REPO = "/workspace/smaudit/repo";
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".pdf": "application/pdf",
  ".ico": "image/x-icon",
};

function startServer(root, host = "127.0.0.1") {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const urlPath = decodeURIComponent((req.url || "/").split("?")[0]);
      let file = path.join(root, urlPath === "/" ? "index.html" : urlPath);
      if (!file.startsWith(root)) {
        res.writeHead(403);
        res.end();
        return;
      }
      fs.readFile(file, (err, data) => {
        if (err) {
          res.writeHead(404);
          res.end("not found");
          return;
        }
        res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
        res.end(data);
      });
    });
    server.listen(0, host, () => resolve({ server, port: server.address().port }));
  });
}

const THANKS_HTML = `
  <p class="sm-brochure-thanks-title">Thank you, Alex.</p>
  <p>Your brochure is ready. A copy is also on its way to your inbox.</p>
  <p><a href="/assets/sears-melvin-brochure.pdf?v=10.1" data-brochure-link download>Download the brochure</a></p>
  <p class="sm-brochure-thanks-note">Or <a href="/contact">request a quote</a>. You can also call us on <a href="tel:+442038352548">020 3835 2548</a>.</p>
`;

const THANKS_CSS = `
.sm-brochure-thanks {
  margin-top: 2rem;
  padding: 1.25rem 1.5rem;
  background: var(--color-warm, var(--sm-color-bg-panel-quiet));
  border: 1px solid var(--color-border, var(--sm-color-border-decorative));
  border-radius: var(--sm-radius-sm, 2px);
}
.sm-brochure-thanks-title {
  margin: 0 0 0.5rem;
  font-family: var(--font-display, serif);
  font-size: 1.35rem;
  font-weight: 500;
  color: var(--sm-color-text);
}
.sm-brochure-thanks p { margin: 0 0 0.75rem; }
.sm-brochure-thanks a { display: inline; padding: 0; margin: 0; background: none; color: var(--sm-color-link, #7A6449); text-decoration: underline; border-radius: 0; font-family: inherit; }
.sm-brochure-thanks a[data-brochure-link] {
  display: inline-flex;
  margin: 0.35rem 0 0.5rem;
  padding: 0.85rem 1.25rem;
  border-radius: var(--sm-radius-sm, 2px);
  background: var(--sm-color-action-primary-bg, #302C27);
  color: var(--sm-color-action-primary-text, #FBF9F5);
  text-decoration: none;
  text-transform: none;
  letter-spacing: 0;
  font-family: var(--sm-font-body, inherit);
  font-weight: 500;
}
.sm-brochure-thanks-note {
  margin: 0.85rem 0 0 !important;
  color: var(--sm-color-text-muted, #5C554C);
  font-size: 0.95rem;
}
`;

async function shotEmail(page, file, width, outName) {
  const html = fs.readFileSync(path.join(OUT, file), "utf8");
  await page.setViewportSize({ width, height: 900 });
  await page.setContent(html, { waitUntil: "networkidle", baseURL: "https://searsmelvin.co.uk" });
  await page.evaluate(async () => {
    await Promise.all(Array.from(document.images, (img) => {
      if (img.complete) return Promise.resolve();
      return new Promise((resolve) => {
        img.addEventListener("load", resolve, { once: true });
        img.addEventListener("error", resolve, { once: true });
      });
    }));
  });
  await page.waitForTimeout(400);
  const card = await page.$("body");
  await page.screenshot({ path: path.join(OUT, outName), fullPage: true });
  return card;
}

async function main() {
  const emails = startServer(OUT);
  const site = startServer(REPO);
  const [{ server: emailServer, port: emailPort }, { server: siteServer, port: sitePort }] = await Promise.all([emails, site]);

  const browser = await chromium.launch({
    executablePath: "/usr/bin/google-chrome",
    args: ["--no-sandbox"],
  });
  const context = await browser.newContext({ deviceScaleFactor: 2 });
  await context.route(/googletagmanager|google-analytics|analytics\.google|doubleclick\.net|googlesyndication|googleadservices|googleads\.g\.doubleclick|pagead2\.googlesyndication|facebook\.(net|com)|leadconnectorhq|msgsndr/, (route) => route.abort());

  const page = await context.newPage();
  const emailFiles = [
    "family-brochure-email.html",
    "staff-brochure-email.html",
    "family-enquiry-email.html",
  ];
  for (const file of emailFiles) {
    const base = file.replace(/\.html$/, "");
    await page.goto(`http://127.0.0.1:${emailPort}/${file}`, { waitUntil: "networkidle" });
    await page.evaluate(async () => {
      await Promise.all(Array.from(document.images, (img) => {
        if (img.complete) return Promise.resolve();
        return new Promise((resolve) => {
          img.addEventListener("load", resolve, { once: true });
          img.addEventListener("error", resolve, { once: true });
        });
      }));
      if (document.fonts && document.fonts.ready) await document.fonts.ready;
    });
    await page.waitForTimeout(500);
    async function shotEmail(width, outName) {
      await page.setViewportSize({ width, height: 1600 });
      const box = await page.locator('table[width="600"]').first().boundingBox();
      const pad = 24;
      const clip = {
        x: Math.max(0, box.x - pad),
        y: Math.max(0, box.y - pad),
        width: Math.min(width, box.width + pad * 2),
        height: box.height + pad * 2,
      };
      await page.screenshot({ path: path.join(OUT, outName), clip });
    }
    await shotEmail(800, `${base}-desktop.png`);
    await shotEmail(390, `${base}-390.png`);
  }

  // Success state on a local copy of the live brochure page.
  await context.addInitScript(() => {
    try { localStorage.setItem("cookieConsent", "accepted"); } catch (e) {}
  });
  const success = await context.newPage();
  await success.route(/googletagmanager|google-analytics|analytics\.google|doubleclick\.net|googlesyndication|googleadservices|googleads\.g\.doubleclick|pagead2\.googlesyndication|facebook\.(net|com)|leadconnectorhq|msgsndr/, (route) => route.abort());
  await success.goto(`http://127.0.0.1:${sitePort}/brochure.html`, { waitUntil: "domcontentloaded", timeout: 20000 });
  await success.waitForSelector("[data-brochure-thanks], form[data-brochure-request]", { timeout: 15000 });
  await success.addStyleTag({ content: THANKS_CSS + "#cookieConsent,.sm-brochure-fab,#chat-widget,#leadConnector-widget-iframe,iframe[src*='leadconnector']{display:none!important;}" });
  await success.evaluate(({ html }) => {
    const form = document.querySelector("form[data-brochure-request]");
    if (form) form.hidden = true;
    const thanks = document.querySelector("[data-brochure-thanks]");
    if (thanks) {
      thanks.hidden = false;
      thanks.innerHTML = html;
    }
    const card = document.getElementById("cookieConsent");
    if (card) card.style.display = "none";
  }, { html: THANKS_HTML });
  await success.waitForTimeout(600);

  await success.setViewportSize({ width: 1280, height: 1100 });
  await success.evaluate(() => window.scrollTo(0, 0));
  await success.screenshot({ path: path.join(OUT, "success-1280.png") });

  await success.setViewportSize({ width: 390, height: 844 });
  const thanksBox = success.locator("[data-brochure-thanks]");
  await thanksBox.scrollIntoViewIfNeeded();
  await success.waitForTimeout(200);
  await success.screenshot({ path: path.join(OUT, "success-390.png") });

  // Tight crop of the thanks card at both widths, for the brief.
  await success.setViewportSize({ width: 1280, height: 900 });
  await thanksBox.scrollIntoViewIfNeeded();
  await thanksBox.screenshot({ path: path.join(OUT, "success-card-1280.png") });
  await success.setViewportSize({ width: 390, height: 844 });
  await thanksBox.scrollIntoViewIfNeeded();
  await thanksBox.screenshot({ path: path.join(OUT, "success-card-390.png") });

  await browser.close();
  emailServer.close();
  siteServer.close();
  console.log("rendered");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
