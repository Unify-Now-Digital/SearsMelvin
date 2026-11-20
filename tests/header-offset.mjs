// The fixed header and the trust bar share one height.
// At each public page and width, the trust bar's top is at or below the
// header's bottom. The header box itself stays on --header-height, so a
// taller logo cannot cover the trust line.
//
// Needs Chrome (google-chrome or CHROME_PATH). The GitHub workflow installs
// it before this file runs.

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const WIDTHS = [1280, 1440, 1680, 1920, 744, 375];
const ZOOMS = [1, 1.1];
const SKIP = new Set(["404.html", "admin.html", "admin-products.html", "styleguide.html", "track.html"]);

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".ico": "image/x-icon",
  ".json": "application/json",
  ".txt": "text/plain; charset=utf-8",
};

function chromePath() {
  const candidates = [
    process.env.CHROME_PATH,
    "/usr/local/bin/google-chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ].filter(Boolean);
  return candidates.find((path) => existsSync(path)) || "";
}

function publicPages() {
  return readdirSync(ROOT)
    .filter((name) => name.endsWith(".html") && !SKIP.has(name))
    .filter((name) => {
      const html = readFileSync(join(ROOT, name), "utf8");
      return html.includes('id="navbar"') && html.includes("site-trust-bar");
    })
    .sort();
}

function startServer() {
  const server = createServer((req, res) => {
    const url = new URL(req.url || "/", "http://127.0.0.1");
    let pathname = decodeURIComponent(url.pathname);
    if (pathname.endsWith("/")) pathname += "index.html";
    const file = normalize(join(ROOT, pathname));
    if (file !== ROOT && !file.startsWith(ROOT.endsWith(sep) ? ROOT : ROOT + sep)) {
      res.writeHead(403).end("Forbidden");
      return;
    }
    if (!existsSync(file) || !statSync(file).isFile()) {
      res.writeHead(404).end("Not found");
      return;
    }
    res.writeHead(200, { "Content-Type": TYPES[extname(file)] || "application/octet-stream", "Cache-Control": "no-store" });
    res.end(readFileSync(file));
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

async function waitForJson(port) {
  const deadline = Date.now() + 15000;
  let last = "";
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (res.ok) return res.json();
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Chrome debugger did not open (${last})`);
}

function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let next = 0;
  const pending = new Map();
  const opened = new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve);
    ws.addEventListener("error", () => reject(new Error("Chrome debugger socket failed")));
  });
  ws.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (!message.id || !pending.has(message.id)) return;
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) reject(new Error(message.error.message || "CDP error"));
    else resolve(message.result);
  });
  return {
    ready: opened,
    send(method, params = {}, sessionId) {
      const id = ++next;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        ws.send(JSON.stringify({ id, method, params, sessionId }));
      });
    },
    close() {
      ws.close();
    },
  };
}

const MEASURE = `(() => {
  const round = (n) => Math.round(n * 100) / 100;
  const nav = document.querySelector("#navbar");
  const bar = document.querySelector(".site-trust-bar");
  const img = nav && nav.querySelector(".logo img");
  const headerVar = getComputedStyle(document.documentElement).getPropertyValue("--header-height").trim();
  const navRect = nav.getBoundingClientRect();
  const barRect = bar.getBoundingClientRect();
  const imgRect = img ? img.getBoundingClientRect() : null;
  const barStyle = getComputedStyle(bar);
  return {
    headerVar,
    navH: round(navRect.height),
    navBottom: round(navRect.bottom),
    barTop: round(barRect.top),
    gap: round(barRect.top - navRect.bottom),
    display: barStyle.display,
    margin: barStyle.marginTop,
    logoW: imgRect ? round(imgRect.width) : 0,
    logoH: imgRect ? round(imgRect.height) : 0,
    logoTop: imgRect ? round(imgRect.top) : 0,
    logoBottom: imgRect ? round(imgRect.bottom) : 0,
    logoSrc: img ? (img.currentSrc || img.getAttribute("src") || "") : "",
    bodyDisplay: getComputedStyle(document.body).display,
  };
})()`;

async function main() {
  const chrome = chromePath();
  assert.ok(chrome, "Chrome is required for tests/header-offset.mjs. Set CHROME_PATH or install google-chrome.");
  const pages = publicPages();
  assert.ok(pages.length >= 12, `expected the public pages with a trust bar, found ${pages.join(", ")}`);

  const server = await startServer();
  const { port } = server.address();
  const origin = `http://127.0.0.1:${port}`;
  const debugPort = 9222 + Math.floor(Math.random() * 1000);
  const chromeProc = spawn(chrome, [
    "--headless=new",
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--disable-gpu",
    "--hide-scrollbars",
    `--remote-debugging-port=${debugPort}`,
    "--remote-allow-origins=*",
    `--user-data-dir=/tmp/chrome-header-offset-${debugPort}`,
    "about:blank",
  ], { stdio: "ignore" });

  const failures = [];
  let client;
  try {
    const version = await waitForJson(debugPort);
    client = connect(version.webSocketDebuggerUrl);
    await client.ready;
    const { targetId } = await client.send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await client.send("Target.attachToTarget", { targetId, flatten: true });
    const send = (method, params) => client.send(method, params, sessionId);
    await send("Page.enable");
    await send("Runtime.enable");
    await send("Page.addScriptToEvaluateOnNewDocument", {
      source: "try { localStorage.setItem('cookieConsent', 'accepted'); } catch (e) {}",
    });

    async function evalJson(expression) {
      const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
      if (result.exceptionDetails) {
        throw new Error(result.exceptionDetails.text || "page script failed");
      }
      return result.result.value;
    }

    async function open(path) {
      await send("Page.navigate", { url: origin + path });
      await evalJson(`new Promise((resolve) => {
        if (document.readyState === "complete") resolve();
        else addEventListener("load", () => resolve(), { once: true });
      })`);
      await evalJson(`Promise.race([
        (async () => {
          if (document.fonts && document.fonts.ready) await document.fonts.ready;
          const img = document.querySelector("#navbar .logo img");
          if (img && img.decode) await img.decode().catch(() => {});
        })(),
        new Promise((resolve) => setTimeout(resolve, 4000)),
      ])`);
      await evalJson(`new Promise((resolve) => setTimeout(resolve, 450))`);
    }

    for (const file of pages) {
      const path = file === "index.html" ? "/" : `/${file}`;
      await open(path);
      for (const width of WIDTHS) {
        for (const zoom of ZOOMS) {
          await send("Emulation.setDeviceMetricsOverride", {
            width,
            height: 900,
            deviceScaleFactor: 1,
            mobile: width < 769,
          });
          await evalJson(`document.documentElement.style.zoom = ${JSON.stringify(String(zoom))}`);
          await evalJson(`new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
          const row = await evalJson(MEASURE);
          const where = `${path} ${width}px zoom ${zoom}`;
          const expected = width <= 768 ? 68 : 80;
          if (row.display !== "none" && row.gap < -0.5) {
            failures.push(`${where}: trust top ${row.barTop} is above header bottom ${row.navBottom} (gap ${row.gap})`);
          }
          if (Math.abs(row.navH - expected * zoom) > 0.75) {
            failures.push(`${where}: header height ${row.navH}, expected ${expected} at zoom ${zoom} (var ${row.headerVar})`);
          }
          if (row.logoBottom - row.navBottom > 0.5 || row.navH && row.logoTop + 0.5 < row.navBottom - row.navH) {
            failures.push(`${where}: logo ${row.logoW}x${row.logoH} escapes the header (${row.logoTop}–${row.logoBottom}, header bottom ${row.navBottom})`);
          }
          if (width > 768 && zoom === 1 && !row.logoSrc.includes("sears-melvin-stacked-ink.svg")) {
            failures.push(`${where}: desktop logo is ${row.logoSrc}`);
          }
          if (width > 768 && zoom === 1 && row.logoSrc.includes("no-rules")) {
            failures.push(`${where}: wide desktop must keep the logo with rules`);
          }
          if (zoom === 1 && row.logoW + 0.5 < 240) {
            failures.push(`${where}: logo width ${row.logoW} is under 240`);
          }
          const again = await evalJson(MEASURE);
          if (Math.abs(again.navBottom - row.navBottom) > 0.5 || Math.abs(again.barTop - row.barTop) > 0.5) {
            failures.push(`${where}: header or trust bar moved after layout (nav ${row.navBottom}→${again.navBottom}, bar ${row.barTop}→${again.barTop})`);
          }
        }
      }
      if (file === "index.html") {
        await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
        await evalJson(`document.documentElement.style.zoom = "1"; window.scrollTo(0, 400);`);
        await evalJson(`new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
        const scrolled = await evalJson(MEASURE);
        const scrolledClass = await evalJson(`document.getElementById("navbar").classList.contains("scrolled")`);
        if (!scrolledClass || Math.abs(scrolled.navH - 80) > 0.75) {
          failures.push(`/ scrolled: class ${scrolledClass}, header ${scrolled.navH}`);
        }
      }
    }
  } finally {
    if (client) client.close();
    chromeProc.kill("SIGKILL");
    server.close();
  }

  assert.deepEqual(failures, [], failures.join("\n"));
  console.log(`header-offset OK: ${pages.length} pages, widths ${WIDTHS.join("/")}, zoom 100% and 110%`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
