// Option A phone trust bar: one 30px horizontally-scrolling row with short
// labels and a peek of the next item, on inner pages only. The home page
// keeps its 2x2 layout and full sentences at every width, and the
// single-product page never gets the one-row treatment. Full sentences move
// to a visually-hidden .sm-trust-sr span (not aria-label on the item, a
// plain div ARIA 1.2 won't expose) so screen readers are unaffected by the
// short labels, and the row gets tabindex/role=group/aria-label so keyboard
// users can reach items past the visible edge.
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
    const span = item.querySelector('span:not(.sm-trust-sr)');
    const sr = item.querySelector('.sm-trust-sr');
    return {
      left: r.left,
      right: r.right,
      width: r.width,
      text: span ? span.textContent.trim() : '',
      srText: sr ? sr.textContent.trim() : '',
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
    rowTabindex: row.getAttribute('tabindex'),
    rowRole: row.getAttribute('role'),
    rowAriaLabel: row.getAttribute('aria-label'),
    items,
  };
})()`;

// Focused-row read: outline-offset must be -2px (so the ring draws inside
// the 30px row, not under the fixed header) and the right-edge fade must
// hide while the row has the ring, or it paints over it.
const FOCUS_MEASURE = `(() => {
  const row = document.querySelector('.site-trust-row');
  const bar = document.querySelector('.site-trust-bar');
  const isRowFocused = document.activeElement === row;
  const focusVisible = row ? row.matches(':focus-visible') : false;
  const rowStyle = row ? getComputedStyle(row) : null;
  const afterStyle = bar ? getComputedStyle(bar, '::after') : null;
  return {
    isRowFocused,
    focusVisible,
    outlineOffset: rowStyle ? rowStyle.outlineOffset : null,
    afterDisplay: afterStyle ? afterStyle.display : null,
  };
})()`;

async function main() {
  const chrome = chromePath();
  assert.ok(chrome, "Chrome is required for tests/trust-bar-a.mjs. Set CHROME_PATH or install google-chrome.");

  const failures = [];

  // The global focus-ring rule sets outline-offset with !important, so the
  // row rule must also carry !important or the global one wins and the
  // ring draws outside the row. Lock that in the source directly.
  const cssSource = readFileSync(join(ROOT, "site-upgrades.css"), "utf8");
  if (!cssSource.includes("outline-offset: -2px !important")) {
    failures.push(`site-upgrades.css: missing "outline-offset: -2px !important" on the inner-page trust row focus rule`);
  }

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

    // Keyboard Tab presses (not a programmatic .focus()) so :focus-visible
    // applies the way it would for a real keyboard user.
    async function tabToRow(maxPresses = 60) {
      for (let i = 0; i < maxPresses; i++) {
        await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9 });
        await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9 });
        const onRow = await evalJson(`document.activeElement === document.querySelector('.site-trust-row')`);
        if (onRow) return true;
      }
      return false;
    }

    // /memorials at 390: one 30px row, short labels, full sentences in a
    // visually-hidden .sm-trust-sr span (not aria-label on the item), 3
    // items fully visible, a 4th peeking, no page scroll, and the row is
    // reachable/announced as a keyboard group.
    await open("/memorials.html");
    let row = await resize(390, true);
    if (Math.abs(row.barHeight - 30) > 2) failures.push(`/memorials 390: bar height ${row.barHeight}, expected ~30`);
    const shortLabels390 = row.items.map((it) => it.text);
    for (const label of ["30-year guarantee", "Fixing included", "Permit help", "1-day reply"]) {
      if (!shortLabels390.includes(label)) failures.push(`/memorials 390: missing short label "${label}" (have ${shortLabels390.join(", ")})`);
    }
    const srTexts390 = row.items.map((it) => it.srText);
    for (const sentence of ["30-year fixing guarantee", "fixing included", "we help with your permit", "we reply within one working day"]) {
      if (!srTexts390.some((text) => text.toLowerCase() === sentence)) failures.push(`/memorials 390: missing hidden sr text "${sentence}" (have ${srTexts390.join(" | ")})`);
    }
    if (row.items.some((it) => it.ariaLabel)) failures.push(`/memorials 390: items must not use aria-label for the full sentence (plain divs don't expose it)`);
    if (fullyVisibleCount(row) < 3) failures.push(`/memorials 390: only ${fullyVisibleCount(row)} items fully visible, expected >=3`);
    if (peekingCount(row) < 1) failures.push(`/memorials 390: no item peeks past the visible row`);
    if (row.docScrollWidth > row.docClientWidth + 1) failures.push(`/memorials 390: page scrolls sideways (${row.docScrollWidth} > ${row.docClientWidth})`);
    if (row.rowTabindex !== "0") failures.push(`/memorials 390: row tabindex is "${row.rowTabindex}", expected "0"`);
    if (row.rowRole !== "group") failures.push(`/memorials 390: row role is "${row.rowRole}", expected "group"`);
    if (row.rowAriaLabel !== "Our promises") failures.push(`/memorials 390: row aria-label is "${row.rowAriaLabel}", expected "Our promises"`);

    // /memorials at 390: reaching the row via Tab must give it a focus ring
    // that draws inside the 30px row (outline-offset -2px) with the
    // right-edge fade hidden, not painted over the ring.
    const reachedRow = await tabToRow();
    if (!reachedRow) failures.push(`/memorials 390: could not reach the trust row via Tab key`);
    const focusState = await evalJson(FOCUS_MEASURE);
    if (!focusState.focusVisible) failures.push(`/memorials 390: trust row is not :focus-visible after Tab (isRowFocused=${focusState.isRowFocused})`);
    if (focusState.outlineOffset !== "-2px") failures.push(`/memorials 390: focused row outline-offset is "${focusState.outlineOffset}", expected "-2px"`);
    if (focusState.afterDisplay !== "none") failures.push(`/memorials 390: trust bar ::after display is "${focusState.afterDisplay}" while row is focused, expected "none"`);
    await evalJson(`document.activeElement && document.activeElement.blur()`);
    const afterBlur = await evalJson(FOCUS_MEASURE);
    if (afterBlur.afterDisplay === "none") failures.push(`/memorials 390: trust bar ::after display is "none" after blur, expected the fade to come back`);

    // /memorials at 320: narrower phone, still one row, at least 2 full
    // labels visible plus a peek, no page scroll.
    row = await resize(320, true);
    if (Math.abs(row.barHeight - 30) > 2) failures.push(`/memorials 320: bar height ${row.barHeight}, expected ~30`);
    if (fullyVisibleCount(row) < 2) failures.push(`/memorials 320: only ${fullyVisibleCount(row)} items fully visible, expected >=2`);
    if (peekingCount(row) < 1) failures.push(`/memorials 320: no item peeks past the visible row`);
    if (row.docScrollWidth > row.docClientWidth + 1) failures.push(`/memorials 320: page scrolls sideways (${row.docScrollWidth} > ${row.docClientWidth})`);

    // Same tab, resize up to 1280: full sentences must come back, no
    // one-row short-label treatment, and the phone-only sr spans/keyboard
    // attrs must be gone.
    row = await resize(1280, false);
    const fullTexts1280 = row.items.map((it) => it.text);
    for (const sentence of ["30-year fixing guarantee", "We help with your permit", "We reply within one working day"]) {
      if (!fullTexts1280.includes(sentence)) failures.push(`/memorials 1280 (after resize from 390): sentence "${sentence}" not restored (have ${fullTexts1280.join(" | ")})`);
    }
    if (row.items.some((it) => it.ariaLabel)) failures.push(`/memorials 1280: aria-label should be cleared again on desktop`);
    if (row.items.some((it) => it.srText)) failures.push(`/memorials 1280: .sm-trust-sr should not remain on desktop`);
    if (row.rowTabindex !== null || row.rowRole !== null || row.rowAriaLabel !== null) {
      failures.push(`/memorials 1280: row keyboard attrs should be removed on desktop (tabindex=${row.rowTabindex}, role=${row.rowRole}, aria-label=${row.rowAriaLabel})`);
    }
    if (Math.abs(row.barHeight - 30) < 2) failures.push(`/memorials 1280: bar still looks like the 30px phone row (height ${row.barHeight})`);

    // Resize the same tab back down to 390: Option A must reapply cleanly
    // (idempotent — no duplicate icons/sr spans, short labels back).
    row = await resize(390, true);
    const reappliedShort = row.items.map((it) => it.text);
    for (const label of ["30-year guarantee", "Fixing included", "Permit help", "1-day reply"]) {
      if (!reappliedShort.includes(label)) failures.push(`/memorials 390 (reapplied): missing short label "${label}" (have ${reappliedShort.join(", ")})`);
    }
    if (row.items.some((it) => !it.srText)) failures.push(`/memorials 390 (reapplied): every item should have hidden sr text`);
    if (row.rowTabindex !== "0" || row.rowRole !== "group" || row.rowAriaLabel !== "Our promises") {
      failures.push(`/memorials 390 (reapplied): row keyboard attrs missing (tabindex=${row.rowTabindex}, role=${row.rowRole}, aria-label=${row.rowAriaLabel})`);
    }
    if (Math.abs(row.barHeight - 30) > 2) failures.push(`/memorials 390 (reapplied): bar height ${row.barHeight}, expected ~30`);

    // A fresh load at 1280 (not just a resize) also keeps full sentences
    // and never adds the phone-only sr spans/keyboard attrs.
    await open("/memorials.html");
    row = await resize(1280, false);
    const freshTexts1280 = row.items.map((it) => it.text);
    for (const sentence of ["30-year fixing guarantee", "We help with your permit", "We reply within one working day"]) {
      if (!freshTexts1280.includes(sentence)) failures.push(`/memorials 1280 (fresh load): sentence "${sentence}" missing (have ${freshTexts1280.join(" | ")})`);
    }
    if (row.items.some((it) => it.srText)) failures.push(`/memorials 1280 (fresh load): .sm-trust-sr should not be added on desktop`);
    if (row.rowTabindex !== null || row.rowRole !== null || row.rowAriaLabel !== null) {
      failures.push(`/memorials 1280 (fresh load): row should not get keyboard attrs on desktop`);
    }

    // Home page at 390: untouched 2x2, full sentences, ~97px bar, none of
    // Option A's sr spans / aria-label / row keyboard attrs.
    await open("/");
    row = await resize(390, true);
    if (Math.abs(row.barHeight - 97) > 8) failures.push(`/ 390: bar height ${row.barHeight}, expected ~97`);
    if (row.gridColumns.trim().split(/\s+/).length < 2) failures.push(`/ 390: trust row is not a 2-column grid (${row.gridColumns})`);
    const homeTexts390 = row.items.map((it) => it.text);
    for (const sentence of ["30-year fixing guarantee", "We help with your permit", "We reply within one working day"]) {
      if (!homeTexts390.includes(sentence)) failures.push(`/ 390: full sentence "${sentence}" missing (have ${homeTexts390.join(" | ")})`);
    }
    if (row.items.some((it) => it.ariaLabel)) failures.push(`/ 390: home page items should not get aria-label rewrites`);
    if (row.items.some((it) => it.srText)) failures.push(`/ 390: home page items should not get .sm-trust-sr rewrites`);
    if (row.rowRole === "group" || row.rowAriaLabel === "Our promises" || row.rowTabindex === "0") {
      failures.push(`/ 390: home page row should not pick up Option A's role=group/aria-label/tabindex`);
    }

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
