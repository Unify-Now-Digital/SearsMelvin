// The chat bubble and its greeting must not cover a quote button.
// Hit the left, centre, and right of every visible "Get a quote" and
// "Request your quote" control. Widths are the desktop sizes from the
// review. Needs Chrome, and the LeadConnector widget must load.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { launchChrome } from "./chrome-launch.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const WIDTHS = (process.env.CHAT_HIT_WIDTHS || "360,390,414,768,1280,1440").split(",").map((n) => Number(n.trim())).filter(Boolean);
const HEIGHTS = { 360: 800, 390: 844, 414: 896, 768: 1024, 1280: 900, 1440: 900 };
const PAGES = [
  // Product pages (memorial.html) and /contact load no chat widget
  // (docs/TRACKING.md rule 6).
  ["home", "/"],
  ["memorials", "/memorials.html"],
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
    const root = ROOT.endsWith(sep) ? ROOT : ROOT + sep;
    if (file !== ROOT && !file.startsWith(root)) {
      res.writeHead(403).end("Forbidden");
      return;
    }
    if (!existsSync(file) || !statSync(file).isFile()) {
      res.writeHead(404).end("Not found");
      return;
    }
    res.writeHead(200, {
      "Content-Type": TYPES[extname(file)] || "application/octet-stream",
      "Cache-Control": "no-store",
    });
    res.end(readFileSync(file));
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
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
  const round = (n) => Math.round(n);
  const host = document.querySelector("chat-widget");
  const hostStyle = host ? getComputedStyle(host) : null;
  function shown(el) {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden" || r.width < 2 || r.height < 2) return null;
    if (r.bottom <= 0 || r.top >= innerHeight) return null;
    return r;
  }
  function tag(el) {
    if (!el) return "";
    return el.tagName + (el.id ? "#" + el.id : "");
  }
  const buttons = [...document.querySelectorAll("a, button")].filter((el) => {
    const text = (el.textContent || "").replace(/\\s+/g, " ").trim();
    return text === "Request your quote" || text === "Get a quote";
  });
  const hits = [];
  for (const el of buttons) {
    const r = shown(el);
    if (!r) continue;
    const y = Math.min(innerHeight - 2, Math.max(2, r.top + r.height / 2));
    const points = [
      ["left", r.left + Math.min(8, r.width / 4)],
      ["centre", r.left + r.width / 2],
      ["right", r.right - Math.min(8, r.width / 4)],
    ];
    for (const [name, rawX] of points) {
      const x = Math.min(innerWidth - 2, Math.max(2, rawX));
      const top = document.elementsFromPoint(x, y)[0];
      hits.push({
        text: (el.textContent || "").replace(/\\s+/g, " ").trim(),
        w: round(r.width),
        h: round(r.height),
        name,
        top: tag(top),
        covered: !!(top && top.tagName === "CHAT-WIDGET"),
      });
    }
  }
  let bubble = false;
  if (hostStyle && hostStyle.display !== "none" && hostStyle.opacity !== "0") {
    for (let y = innerHeight - 24; y > innerHeight * 0.35; y -= 16) {
      const top = document.elementsFromPoint(innerWidth - 40, y)[0];
      if (top && top.tagName === "CHAT-WIDGET") { bubble = true; break; }
    }
  }
  return {
    ready: !!host,
    position: host && host.position ? String(host.position) : "",
    opacity: hostStyle ? hostStyle.opacity : "",
    pointer: hostStyle ? hostStyle.pointerEvents : "",
    display: hostStyle ? hostStyle.display : "",
    bottom: hostStyle ? hostStyle.bottom : "",
    bubble,
    prompt: host ? host.showPrompt !== false : false,
    hits,
  };
})()`;

async function main() {
  const chrome = chromePath();
  assert.ok(chrome, "Chrome is required for tests/chat-quote-hits.mjs");
  const server = await startServer();
  const { port } = server.address();
  const origin = `http://127.0.0.1:${port}`;
  const debugPort = 9400 + Math.floor(Math.random() * 400);
  const { proc: chromeProc, version } = await launchChrome(chrome, [
    "--headless=new",
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--disable-gpu",
    "--hide-scrollbars",
    `--remote-debugging-port=${debugPort}`,
    "--remote-allow-origins=*",
    `--user-data-dir=/tmp/chrome-chat-hits-${debugPort}`,
    "about:blank",
  ]);

  const failures = [];
  let client;
  try {
    client = connect(version.webSocketDebuggerUrl);
    await client.ready;
    const { targetId } = await client.send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await client.send("Target.attachToTarget", { targetId, flatten: true });
    const send = (method, params) => client.send(method, params, sessionId);
    await send("Page.enable");
    await send("Runtime.enable");

    async function evalJson(expression) {
      const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || "page script failed");
      return result.result.value;
    }

    async function settle(width, height) {
      await send("Emulation.setDeviceMetricsOverride", {
        width, height, deviceScaleFactor: 1, mobile: width <= 768,
      });
      // The loader starts on a real interaction. A scripted PointerEvent is
      // untrusted and must not mount the widget. Shift does not activate a control.
      await send("Input.dispatchKeyEvent", {
        type: "keyDown",
        key: "Shift",
        code: "ShiftLeft",
        windowsVirtualKeyCode: 16,
        nativeVirtualKeyCode: 16,
      });
      await send("Input.dispatchKeyEvent", {
        type: "keyUp",
        key: "Shift",
        code: "ShiftLeft",
        windowsVirtualKeyCode: 16,
        nativeVirtualKeyCode: 16,
      });
      const appeared = await evalJson(`new Promise((resolve) => {
        const start = Date.now();
        (function tick() {
          if (document.querySelector("chat-widget")) resolve(true);
          else if (Date.now() - start > 15000) resolve(false);
          else setTimeout(tick, 200);
        })();
      })`);
      if (!appeared) return null;
      await evalJson(`new Promise((resolve) => setTimeout(resolve, 1300))`);
      return evalJson(MEASURE);
    }

    for (const [name, path] of PAGES) {
      for (const width of WIDTHS) {
        const height = HEIGHTS[width] || (width <= 768 ? 844 : 900);
        await send("Page.navigate", { url: origin + path });
        await evalJson(`new Promise((resolve) => {
          if (document.readyState === "complete") resolve();
          else addEventListener("load", () => resolve(), { once: true });
        })`);
        try { await evalJson(`localStorage.removeItem("cookieConsent")`); } catch (e) {}
        await send("Page.reload");
        await evalJson(`new Promise((resolve) => {
          if (document.readyState === "complete") resolve();
          else addEventListener("load", () => resolve(), { once: true });
        })`);
        const sample = await settle(width, height);
        const label = `${name} ${width}`;
        if (!sample) {
          failures.push(`${label}: chat widget did not load`);
          continue;
        }
        if (sample.display === "none") failures.push(`${label}: chat is hidden`);
        if (Number(sample.opacity) < 0.99) failures.push(`${label}: opacity ${sample.opacity} after 1.3s`);
        if (sample.pointer !== "auto") failures.push(`${label}: pointer-events ${sample.pointer}`);
        if (sample.position && sample.position !== "bottom-right") failures.push(`${label}: position ${sample.position}`);
        if (!sample.bubble) failures.push(`${label}: bubble is not hit-testable`);
        for (const hit of sample.hits) {
          if (hit.covered) failures.push(`${label}: ${hit.text} ${hit.w}x${hit.h} ${hit.name} hit ${hit.top}`);
        }
        console.log(`${label}: opacity ${sample.opacity}, pointer ${sample.pointer}, position ${sample.position || "-"}, bottom ${sample.bottom}, bubble ${sample.bubble}, prompt ${sample.prompt}, buttons ${sample.hits.length / 3}`);
      }
    }
  } finally {
    if (client) client.close();
    chromeProc.kill();
    server.close();
  }

  assert.deepEqual(failures, [], failures.join("\n"));
  console.log(`chat-quote-hits: ok (${PAGES.length} pages, ${WIDTHS.join("/")}px)`);
}

main();
