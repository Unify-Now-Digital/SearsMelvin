// Option A phone trust bar: one 30px horizontally-scrolling row with short
// labels and a peek of the next item, on inner pages only. The home page
// keeps its 2x2 layout and full sentences at every width, and the
// single-product page never gets the one-row treatment. Full sentences
// move to aria-label so screen readers are unaffected by the short labels.
//
// Needs Chrome (google-chrome or CHROME_PATH). Modelled on
// tests/header-offset.mjs (same local static server + CDP pattern).

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

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

// Item rects are absolute viewport coordinates; the row's own visible
// window is [rowRect.left, rowRect.right]. "Fully visible" means an item's
// rect sits entirely inside that window; "peeking" means it starts inside
// the window but is cut off, or starts right at the edge.
const MEASURE = `(() => {
  const bar = document.querySelector('.site-trust-bar');
  const row = document.querySelector('.site-trust-row');
  if (!bar || !row) return { noBar: true };
  const barRect = bar.getBoundingClientRect();
  const rowRect = row.getBoundingClientRect();
  const barStyle = getComputedStyle(bar);
  const rowStyle = getComputedStyle(row);
  const items = [...document.querySelectorAll('.site-trust-item')].map((item) => {
    const r = item.getBoundingClientRect();
    const span = item.querySelector('span');
    return {
      left: r.left,
      right: r.right,
      width: r.width,
      text: span ? span.textContent.trim() : '',
      ariaLabel: item.getAttribute('aria-label') || '',
    };
  });
  return {
    barHeight: Math.round(barRect.height * 100) / 100,
    barDisplay: barStyle.display,
    rowDisplay: rowStyle.display,
    gridColumns: rowStyle.gridTemplateColumns,
    windowLeft: rowRect.left,
    windowRight: rowRect.right,
    docScrollWidth: document.documentElement.scrollWidth,
    docClientWidth: document.documentElement.clientWidth,
    items,
  };
})()`;

async function main() {
  const chrome = chromePath();
  assert.ok(chrome, "Chrome is required for tests/trust-bar-a.mjs. Set CHROME_PATH or install google-chrome.");

  const server = await startServer();
  const { port } = server.address();
  const origin = `http://127.0.0.1:${port}`;
  const debugPort = 9500 + Math.floor(Math.random() * 400);
  const chromeProc = spawn(chrome, [
    "--headless=new",
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--disable-gpu",
    "--hide-scrollbars",
    `--remote-debugging-port=${debugPort}`,
    "--remote-allow-origins=*",
    `--user-data-dir=/tmp/chrome-trust-bar-a-${debugPort}`,
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
      await evalJson(`new Promise((resolve) => setTimeout(resolve, 150))`);
    }

    async function resize(width, mobile) {
      await send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile });
      await evalJson(`new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
      await evalJson(`new Promise((resolve) => setTimeout(resolve, 250))`);
      return evalJson(MEASURE);
    }

    function fullyVisibleCount(row) {
      return row.items.filter((it) => it.left >= row.windowLeft - 0.5 && it.right <= row.windowRight + 0.5).length;
    }

    function peekingCount(row) {
      return row.items.filter((it) => it.left < row.windowRight - 0.5 && it.right > row.windowRight + 0.5).length;
    }

    // /memorials at 390: one 30px row, short labels, full sentences in
    // aria-label, 3 items fully visible, a 4th peeking, no page scroll.
    await open("/memorials.html");
    let row = await resize(390, true);
    if (Math.abs(row.barHeight - 30) > 2) failures.push(`/memorials 390: bar height ${row.barHeight}, expected ~30`);
    const shortLabels390 = row.items.map((it) => it.text);
    for (const label of ["30-year guarantee", "Fixing included", "Permit help", "1-day reply"]) {
      if (!shortLabels390.includes(label)) failures.push(`/memorials 390: missing short label "${label}" (have ${shortLabels390.join(", ")})`);
    }
    const ariaLabels390 = row.items.map((it) => it.ariaLabel);
    for (const sentence of ["30-year fixing guarantee", "We help with your permit", "We reply within one working day"]) {
      if (!ariaLabels390.includes(sentence)) failures.push(`/memorials 390: missing aria-label "${sentence}" (have ${ariaLabels390.join(" | ")})`);
    }
    if (fullyVisibleCount(row) < 3) failures.push(`/memorials 390: only ${fullyVisibleCount(row)} items fully visible, expected >=3`);
    if (peekingCount(row) < 1) failures.push(`/memorials 390: no item peeks past the visible row`);
    if (row.docScrollWidth > row.docClientWidth + 1) failures.push(`/memorials 390: page scrolls sideways (${row.docScrollWidth} > ${row.docClientWidth})`);

    // /memorials at 320: narrower phone, still one row, at least 2 full
    // labels visible plus a peek, no page scroll.
    row = await resize(320, true);
    if (Math.abs(row.barHeight - 30) > 2) failures.push(`/memorials 320: bar height ${row.barHeight}, expected ~30`);
    if (fullyVisibleCount(row) < 2) failures.push(`/memorials 320: only ${fullyVisibleCount(row)} items fully visible, expected >=2`);
    if (peekingCount(row) < 1) failures.push(`/memorials 320: no item peeks past the visible row`);
    if (row.docScrollWidth > row.docClientWidth + 1) failures.push(`/memorials 320: page scrolls sideways (${row.docScrollWidth} > ${row.docClientWidth})`);

    // Same tab, resize up to 1280: full sentences must come back, no
    // one-row short-label treatment.
    row = await resize(1280, false);
    const fullTexts1280 = row.items.map((it) => it.text);
    for (const sentence of ["30-year fixing guarantee", "We help with your permit", "We reply within one working day"]) {
      if (!fullTexts1280.includes(sentence)) failures.push(`/memorials 1280 (after resize from 390): sentence "${sentence}" not restored (have ${fullTexts1280.join(" | ")})`);
    }
    if (row.items.some((it) => it.ariaLabel)) failures.push(`/memorials 1280: aria-label should be cleared again on desktop`);
    if (Math.abs(row.barHeight - 30) < 2) failures.push(`/memorials 1280: bar still looks like the 30px phone row (height ${row.barHeight})`);

    // A fresh load at 1280 (not just a resize) also keeps full sentences.
    await open("/memorials.html");
    row = await resize(1280, false);
    const freshTexts1280 = row.items.map((it) => it.text);
    for (const sentence of ["30-year fixing guarantee", "We help with your permit", "We reply within one working day"]) {
      if (!freshTexts1280.includes(sentence)) failures.push(`/memorials 1280 (fresh load): sentence "${sentence}" missing (have ${freshTexts1280.join(" | ")})`);
    }

    // Home page at 390: untouched 2x2, full sentences, ~97px bar.
    await open("/");
    row = await resize(390, true);
    if (Math.abs(row.barHeight - 97) > 8) failures.push(`/ 390: bar height ${row.barHeight}, expected ~97`);
    if (row.gridColumns.trim().split(/\s+/).length < 2) failures.push(`/ 390: trust row is not a 2-column grid (${row.gridColumns})`);
    const homeTexts390 = row.items.map((it) => it.text);
    for (const sentence of ["30-year fixing guarantee", "We help with your permit", "We reply within one working day"]) {
      if (!homeTexts390.includes(sentence)) failures.push(`/ 390: full sentence "${sentence}" missing (have ${homeTexts390.join(" | ")})`);
    }
    if (row.items.some((it) => it.ariaLabel)) failures.push(`/ 390: home page items should not get aria-label rewrites`);

    // Product page (memorial.html): Option A must not apply even though
    // the shared markup and script are present.
    await open("/memorial.html");
    row = await resize(390, true);
    const productTexts390 = row.items.map((it) => it.text);
    if (productTexts390.includes("Permit help")) failures.push(`/memorial.html 390: product page picked up the short "Permit help" label`);
    if (Math.abs(row.barHeight - 30) < 2 && row.barDisplay !== "none") {
      failures.push(`/memorial.html 390: product page rendered the 30px one-row phone bar`);
    }
  } finally {
    if (client) client.close();
    chromeProc.kill("SIGKILL");
    server.close();
  }

  assert.deepEqual(failures, [], failures.join("\n"));
  console.log("trust-bar-a OK: /memorials (390, 320, 1280), home 2x2 unaffected, product page unaffected");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
