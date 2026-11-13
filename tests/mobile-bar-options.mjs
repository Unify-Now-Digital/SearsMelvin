// The phone bar follows the desktop summary when a priced option changes,
// and again when that option is put back. The bar rounds to the nearest pound.
//
// Serves this repo and the public catalogue config, then drives the real page.

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const PAGES = [
  { slug: "the-charnwood", colour: "Bahama Blue", bar: "£4,500" },
  { slug: "the-bath" },
  { slug: "the-alderley" },
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

function barPounds(summary) {
  const n = Number(String(summary).replace(/[£,\s]/g, ""));
  if (!Number.isFinite(n)) return summary;
  return "£" + Math.round(n).toLocaleString("en-GB");
}

function startServer(supabaseConfig) {
  const server = createServer((req, res) => {
    const url = new URL(req.url || "/", "http://127.0.0.1");
    let pathname = decodeURIComponent(url.pathname);
    if (pathname === "/supabase-config") {
      res.writeHead(200, { "Content-Type": "application/javascript; charset=utf-8", "Cache-Control": "no-store" });
      res.end(supabaseConfig);
      return;
    }
    if (/^\/memorials\/[^/]+$/.test(pathname)) pathname = "/memorial.html";
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
    close() { ws.close(); },
  };
}

const READ = `(() => {
  const deskEl = document.getElementById('priceTotal');
  const barEl = document.getElementById('mobileBarAmount');
  const fromEl = document.getElementById('mobileBarFrom');
  const desk = deskEl ? deskEl.textContent.trim() : '';
  const bar = barEl ? barEl.textContent.trim() : '';
  return {
    desk,
    bar,
    fromShown: !!(fromEl && !fromEl.hidden),
    name: (document.getElementById('productName') || {}).textContent || '',
    ready: /^£[\\d,]+(\\.\\d{2})?$/.test(desk) && bar.length > 0
  };
})()`;

function pickExpression(mode, colourName) {
  return `(() => {
    const inputs = [...document.querySelectorAll('input[name="colour"]')];
    const named = ${JSON.stringify(colourName || "")};
    let target = null;
    if (${JSON.stringify(mode)} === 'premium') {
      target = named ? inputs.find((el) => el.dataset.name === named) : null;
      if (!target) target = inputs.find((el) => Number(el.dataset.price) > 0);
    } else {
      target = inputs.find((el) => Number(el.dataset.price) === 0) || inputs.find((el) => el.defaultChecked);
    }
    if (!target) return { error: 'no matching colour' };
    target.checked = true;
    target.dispatchEvent(new Event('change', { bubbles: true }));
    return { name: target.dataset.name || '', price: target.dataset.price || '' };
  })()`;
}

async function main() {
  const chrome = chromePath();
  assert.ok(chrome, "Chrome is required for tests/mobile-bar-options.mjs");
  const configRes = await fetch("https://searsmelvin.co.uk/supabase-config");
  assert.equal(configRes.ok, true, "public catalogue config");
  const supabaseConfig = await configRes.text();
  assert.match(supabaseConfig, /SM_SUPABASE/);

  const server = await startServer(supabaseConfig);
  const { port } = server.address();
  const origin = `http://127.0.0.1:${port}`;
  const debugPort = 9600 + Math.floor(Math.random() * 200);
  const chromeProc = spawn(chrome, [
    "--headless=new",
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--disable-gpu",
    `--remote-debugging-port=${debugPort}`,
    "--remote-allow-origins=*",
    `--user-data-dir=/tmp/chrome-bar-options-${debugPort}`,
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
    await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });

    async function evaluate(expression) {
      const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || "page script failed");
      return result.result.value;
    }

    async function open(slug) {
      await send("Page.navigate", { url: `${origin}/memorials/${slug}` });
      const deadline = Date.now() + 20000;
      let row = null;
      while (Date.now() < deadline) {
        row = await evaluate(READ);
        if (row.ready) return row;
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      throw new Error(`${slug} did not reach a guide total: ${JSON.stringify(row)}`);
    }

    function expectMatch(where, row) {
      assert.equal(row.bar, barPounds(row.desk), `${where}: bar ${row.bar} vs summary ${row.desk}`);
      assert.doesNotMatch(row.bar, /\.00$/, `${where}: bar still shows pence`);
    }

    for (const page of PAGES) {
      const initial = await open(page.slug);
      expectMatch(`${page.slug} load`, initial);
      assert.equal(initial.fromShown, true, `${page.slug} keeps From on the guide price`);

      const chosen = await evaluate(pickExpression("premium", page.colour));
      assert.ok(!chosen.error, `${page.slug}: ${chosen.error || "colour"}`);
      const changed = await evaluate(READ);
      expectMatch(`${page.slug} ${chosen.name}`, changed);
      assert.notEqual(changed.desk, initial.desk, `${page.slug} summary should move`);
      assert.equal(changed.fromShown, false, `${page.slug} drops From on a chosen total`);
      if (page.bar) assert.equal(changed.bar, page.bar, `${page.slug} ${chosen.name}`);

      const back = await evaluate(pickExpression("standard"));
      assert.ok(!back.error, `${page.slug} revert: ${back.error || ""}`);
      const restored = await evaluate(READ);
      expectMatch(`${page.slug} restored`, restored);
      assert.equal(restored.desk, initial.desk, `${page.slug} summary returns`);
      assert.equal(restored.bar, initial.bar, `${page.slug} bar returns`);
      assert.equal(restored.fromShown, true, `${page.slug} From returns with the guide price`);
      console.log(`${page.slug}: ${initial.bar} -> ${changed.bar} (${chosen.name}) -> ${restored.bar}`);
    }
  } finally {
    if (client) client.close();
    chromeProc.kill("SIGKILL");
    server.close();
  }
  console.log("mobile-bar-options: ok");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
