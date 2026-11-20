// The phone cookie strip must not cover a quote button.
// Widths are the ones measured on 20 November 2026. First load, the
// in-page control in the lower viewport, and the footer.
// Needs Chrome (google-chrome or CHROME_PATH).
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SIZES = [
  { w: 360, h: 800 },
  { w: 375, h: 812 },
  { w: 390, h: 844 },
  { w: 414, h: 896 },
  { w: 768, h: 1024 },
];
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
    const root = ROOT.endsWith(sep) ? ROOT : ROOT + sep;
    if (file !== ROOT && !file.startsWith(root)) {
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
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
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
    close() { ws.close(); },
  };
}

const MEASURE = `(() => {
  const round = (n) => Math.round(n * 10) / 10;
  function box(el) {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden" || !r.width || !r.height) return null;
    return { top: round(r.top), bottom: round(r.bottom), left: round(r.left), right: round(r.right), w: round(r.width), h: round(r.height) };
  }
  function overlap(a, b) {
    if (!a || !b) return 0;
    return round(Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)));
  }
  const cookieEl = document.getElementById("cookieConsent");
  const cookie = box(cookieEl);
  const intro = box(document.querySelector("#quoteIntro button, #quoteIntro .btn"));
  const barBtn = box(document.querySelector(".mobile-bottom-bar.is-visible .btn-primary"));
  const bar = box(document.querySelector(".mobile-bottom-bar.is-visible"));
  const accept = document.getElementById("cookieAccept");
  const reject = document.getElementById("cookieReject");
  const acceptBox = box(accept);
  const rejectBox = box(reject);
  const acceptStyle = accept ? getComputedStyle(accept) : null;
  const rejectStyle = reject ? getComputedStyle(reject) : null;
  return {
    vw: innerWidth,
    vh: innerHeight,
    scrollY: Math.round(scrollY),
    cookie,
    cookieBottom: cookieEl ? getComputedStyle(cookieEl).bottom : null,
    gap: cookie && intro ? round(intro.top - cookie.bottom) : null,
    introOverlap: overlap(cookie, intro),
    barBtnOverlap: overlap(cookie, barBtn),
    barOverlap: overlap(cookie, bar),
    introTop: intro ? intro.top : null,
    barVisible: !!bar,
    accept: acceptBox,
    reject: rejectBox,
    sameSize: !!(acceptBox && rejectBox && Math.abs(acceptBox.w - rejectBox.w) < 1 && Math.abs(acceptBox.h - rejectBox.h) < 1),
    sameStyle: !!(acceptStyle && rejectStyle && acceptStyle.backgroundColor === rejectStyle.backgroundColor && acceptStyle.color === rejectStyle.color && acceptStyle.fontWeight === rejectStyle.fontWeight),
    privacy: !!(cookieEl && cookieEl.querySelector('a[href="/privacy"]')),
    manage: !!document.getElementById("cookieManage"),
  };
})()`;

async function main() {
  const chromeBin = chromePath();
  assert.ok(chromeBin, "Chrome is required for tests/cookie-strip-overlap.mjs. Set CHROME_PATH or install google-chrome.");
  const server = await startServer();
  const { port } = server.address();
  const origin = `http://127.0.0.1:${port}`;
  const debugPort = 9600 + Math.floor(Math.random() * 200);
  const chrome = spawn(chromeBin, [
    "--headless=new",
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--disable-gpu",
    "--hide-scrollbars",
    `--remote-debugging-port=${debugPort}`,
    "--remote-allow-origins=*",
    `--user-data-dir=/tmp/chrome-cookie-strip-${debugPort}`,
    "about:blank",
  ], { stdio: "ignore" });

  const failures = [];
  const rows = [];
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
      source: "try { localStorage.removeItem('cookieConsent'); } catch (e) {}",
    });

    async function evalJson(expression) {
      const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || "page script failed");
      return result.result.value;
    }

    async function settle() {
      await evalJson(`document.fonts && document.fonts.ready ? document.fonts.ready.catch(() => {}) : null`);
      await evalJson(`new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
      await evalJson(`new Promise((resolve) => setTimeout(resolve, 300))`);
    }

    async function open(path, size) {
      await send("Emulation.setDeviceMetricsOverride", {
        width: size.w,
        height: size.h,
        deviceScaleFactor: 1,
        mobile: size.w <= 768,
      });
      await send("Page.navigate", { url: origin + path });
      await evalJson(`new Promise((resolve) => {
        if (document.readyState === "complete") resolve();
        else addEventListener("load", () => resolve(), { once: true });
      })`);
      await settle();
    }

    function check(label, row) {
      rows.push({ label, ...row, cookieH: row.cookie && row.cookie.h });
      if (!row.cookie || row.cookie.h < 40) failures.push(`${label}: cookie strip missing`);
      if (row.introOverlap > 0) failures.push(`${label}: Request your quote overlap ${row.introOverlap}px`);
      if (row.barBtnOverlap > 0) failures.push(`${label}: Get a quote overlap ${row.barBtnOverlap}px`);
      if (row.barOverlap > 0) failures.push(`${label}: phone bar overlap ${row.barOverlap}px`);
      if (!row.sameSize || !row.sameStyle) failures.push(`${label}: Accept and Reject differ`);
      if (!row.privacy || !row.manage) failures.push(`${label}: privacy link or Manage choices missing`);
      if (row.cookie && row.cookie.left > 1) failures.push(`${label}: strip is not full width (left ${row.cookie.left})`);
    }

    for (const size of SIZES) {
      const name = `${size.w}x${size.h}`;
      await open("/memorial.html", size);
      // The static product file does not finish its quote-bar script (it
      // needs live product data). Show and hide the bar the same way that
      // script does, so the strip is measured against both states.
      await evalJson(`document.querySelector('.mobile-bottom-bar').classList.add('is-visible')`);
      await settle();
      check(`${name} first load`, await evalJson(MEASURE));
      await evalJson(`(() => {
        document.querySelector('.mobile-bottom-bar').classList.remove('is-visible');
        const btn = document.querySelector("#quoteIntro button, #quoteIntro .btn");
        if (!btn) return;
        const top = btn.getBoundingClientRect().top + window.scrollY;
        window.scrollTo(0, Math.max(0, top - (window.innerHeight - 80)));
      })()`);
      await settle();
      check(`${name} lower`, await evalJson(MEASURE));
      await evalJson(`(() => {
        window.scrollTo(0, document.documentElement.scrollHeight);
        document.querySelector('.mobile-bottom-bar').classList.add('is-visible');
      })()`);
      await settle();
      check(`${name} footer`, await evalJson(MEASURE));
    }

    await open("/index.html", { w: 1280, h: 800 });
    await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
    await settle();
    const desk = await evalJson(MEASURE);
    rows.push({ label: "1280 desktop home", ...desk });
    if (!desk.cookie || desk.cookie.left < 16 || desk.cookie.w > 480) {
      failures.push(`desktop home card moved (left ${desk.cookie && desk.cookie.left}, width ${desk.cookie && desk.cookie.w})`);
    }

    await open("/memorial.html", { w: 1280, h: 800 });
    await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
    await settle();
    const deskProduct = await evalJson(MEASURE);
    rows.push({ label: "1280 desktop product", ...deskProduct });
    if (!deskProduct.cookie || deskProduct.cookie.left < 16 || deskProduct.cookie.w > 480) {
      failures.push(`desktop product card moved (left ${deskProduct.cookie && deskProduct.cookie.left}, width ${deskProduct.cookie && deskProduct.cookie.w})`);
    }
  } finally {
    if (client) client.close();
    chrome.kill("SIGKILL");
    server.close();
  }

  for (const row of rows) {
    console.log(`${row.label}: intro ${row.introOverlap}px, bar button ${row.barBtnOverlap}px, bar ${row.barOverlap}px, strip ${row.cookieH}px, bottom ${row.cookieBottom}, bar visible ${row.barVisible}`);
  }
  assert.deepEqual(failures, [], failures.join("\n"));
  console.log("cookie-strip-overlap: ok");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
