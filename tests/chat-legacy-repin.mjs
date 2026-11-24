// After the 10s re-pin window, a late style rewrite on a legacy LeadConnector
// iframe must still be put back, and our own writes must not loop.
// Needs Chrome (google-chrome or CHROME_PATH).
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { launchChrome } from "./chrome-launch.mjs";

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

async function main() {
  const chromeBin = chromePath();
  assert.ok(chromeBin, "Chrome is required for tests/chat-legacy-repin.mjs. Set CHROME_PATH or install google-chrome.");
  const server = await startServer();
  const { port } = server.address();
  const origin = `http://127.0.0.1:${port}`;
  const debugPort = 9700 + Math.floor(Math.random() * 200);
  const { proc: chrome } = await launchChrome(chromeBin, [
    "--headless=new",
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--disable-gpu",
    `--remote-debugging-port=${debugPort}`,
    "--remote-allow-origins=*",
    `--user-data-dir=/tmp/chrome-chat-legacy-repin-${debugPort}`,
    "about:blank",
  ]);
  const version = JSON.parse(await (await fetch(`http://127.0.0.1:${debugPort}/json/version`)).text());
  let client;
  try {
    client = connect(version.webSocketDebuggerUrl);
    await client.ready;
    const { targetId } = await client.send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await client.send("Target.attachToTarget", { targetId, flatten: true });
    const send = (method, params) => client.send(method, params, sessionId);
    await send("Page.enable");
    await send("Runtime.enable");
    await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await send("Page.navigate", { url: origin + "/contact.html" });
    const evalJson = async (expression) => {
      const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || "page script failed");
      return result.result.value;
    };
    await evalJson(`new Promise((resolve) => {
      if (document.readyState === "complete") resolve();
      else addEventListener("load", () => resolve(), { once: true });
    })`);
    const skip = await evalJson(`({
      first: document.body.firstElementChild && document.body.firstElementChild.className,
      href: document.body.firstElementChild && document.body.firstElementChild.getAttribute("href")
    })`);
    assert.equal(skip.href, "#main", "skip link is the first element in the body");

    await evalJson(`(() => {
      const f = document.createElement("iframe");
      f.setAttribute("src", "https://example.leadconnectorhq.com/widget");
      f.id = "sm-legacy-chat-test";
      f.style.cssText = "position:fixed;bottom:20px;right:20px;width:60px;height:60px;border:0";
      document.body.appendChild(f);
    })()`);
    await evalJson(`new Promise((resolve) => setTimeout(resolve, 1500))`);
    const firstPin = await evalJson(`(() => {
      const f = document.getElementById("sm-legacy-chat-test");
      return { bottom: f.style.bottom, right: f.style.right };
    })()`);
    assert.notEqual(firstPin.bottom, "20px", "legacy iframe is pinned on insert, not left at 20px");
    assert.equal(firstPin.right, "24px", "legacy iframe right is 24px");

    await evalJson(`new Promise((resolve) => setTimeout(resolve, 11000))`);
    const idleMutations = await evalJson(`new Promise((resolve) => {
      const f = document.getElementById("sm-legacy-chat-test");
      let n = 0;
      const o = new MutationObserver((r) => { n += r.length; });
      o.observe(f, { attributes: true });
      setTimeout(() => { o.disconnect(); resolve(n); }, 1000);
    })`);
    assert.equal(idleMutations, 0, "no attribute loop while the pin is already correct");

    await evalJson(`(() => {
      const f = document.getElementById("sm-legacy-chat-test");
      f.style.setProperty("bottom", "5px", "important");
      f.style.setProperty("right", "5px", "important");
    })()`);
    await evalJson(`new Promise((resolve) => setTimeout(resolve, 500))`);
    const after = await evalJson(`(() => {
      const f = document.getElementById("sm-legacy-chat-test");
      return { bottom: f.style.bottom, right: f.style.right };
    })()`);
    assert.equal(after.bottom, firstPin.bottom, "late rewrite after the 10s window is re-pinned");
    assert.equal(after.right, "24px", "late rewrite restores right: 24px");

    const afterMutations = await evalJson(`new Promise((resolve) => {
      const f = document.getElementById("sm-legacy-chat-test");
      let n = 0;
      const o = new MutationObserver((r) => { n += r.length; });
      o.observe(f, { attributes: true });
      setTimeout(() => { o.disconnect(); resolve(n); }, 1000);
    })`);
    assert.equal(afterMutations, 0, "re-pin does not start an attribute loop");

    // Replacing the iframe must not keep the old node on the watch lists.
    // We cannot read the private arrays, but a second iframe must still pin,
    // and removing the first must not throw or loop.
    await evalJson(`document.getElementById("sm-legacy-chat-test").remove()`);
    await evalJson(`(() => {
      const f = document.createElement("iframe");
      f.setAttribute("src", "https://example.leadconnectorhq.com/widget");
      f.id = "sm-legacy-chat-test-2";
      f.style.cssText = "position:fixed;bottom:8px;right:8px;width:60px;height:60px;border:0";
      document.body.appendChild(f);
    })()`);
    await evalJson(`new Promise((resolve) => setTimeout(resolve, 1500))`);
    const second = await evalJson(`(() => {
      const f = document.getElementById("sm-legacy-chat-test-2");
      return { bottom: f.style.bottom, right: f.style.right };
    })()`);
    assert.equal(second.bottom, firstPin.bottom, "a replacement legacy iframe is also pinned");
    assert.equal(second.right, "24px");
    console.log("chat-legacy-repin: ok", firstPin);
  } finally {
    try { if (client) client.close(); } catch (e) {}
    try { chrome.kill("SIGKILL"); } catch (e) {}
    server.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
