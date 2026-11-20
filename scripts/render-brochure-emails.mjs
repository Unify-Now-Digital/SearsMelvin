// Renders brochure email and success-state PNGs. Sends no email and writes no enquiry.
import { spawn } from "node:child_process";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  brochureStaffStatusLine,
  familyBrochureEmail,
  familyEnquiryEmail,
  staffBrochureEmail,
} from "../functions/api/_email-brand.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = process.env.BROCHURE_RENDER_OUT || "/opt/cursor/artifacts";
const STAMP = new Date("2026-11-20T12:13:00Z");
const sentLine = brochureStaffStatusLine({ accepted: true, email: "alex@example.com", at: STAMP });
const failedLine = brochureStaffStatusLine({ accepted: false, email: "alex@example.com" });

fs.mkdirSync(OUT, { recursive: true });

const emails = {
  "family-brochure-email.html": familyBrochureEmail({ firstName: "Alex Taylor", source: "home" }).html,
  "family-enquiry-email.html": familyEnquiryEmail({
    name: "Alex Taylor",
    email: "alex@example.com",
    phone: "020 7946 0123",
    enquiryTypeLabel: "General enquiry",
    message: "I would like advice on a lawn memorial for a family grave in North London.",
  }).html,
  "staff-brochure-sent.html": staffBrochureEmail({
    name: "Alex Taylor",
    email: "alex@example.com",
    phone: "020 7946 0123",
    source: "home",
    page: "/",
    adLine: "Google Ads · memorials_search",
    submittedAt: "20 Nov 2026, 12:15",
    statusLine: sentLine,
    contactUrl: "https://app.gohighlevel.com/v2/location/loc-test/contacts/detail/sample-contact",
  }).html,
  "staff-brochure-failed.html": staffBrochureEmail({
    name: "Alex Taylor",
    email: "alex@example.com",
    phone: "020 7946 0123",
    source: "product",
    productName: "The Castell",
    page: "/memorials/the-castell",
    submittedAt: "20 Nov 2026, 12:15",
    statusLine: failedLine,
  }).html,
};

const tmp = fs.mkdtempSync("/tmp/brochure-render-");
for (const [name, html] of Object.entries(emails)) fs.writeFileSync(path.join(tmp, name), html);

function startServer(root) {
  const mime = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".woff2": "font/woff2" };
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const urlPath = decodeURIComponent((req.url || "/").split("?")[0]);
      const file = path.join(root, urlPath === "/" ? "index.html" : urlPath);
      if (!file.startsWith(root)) { res.writeHead(403); res.end(); return; }
      fs.readFile(file, (err, data) => {
        if (err) { res.writeHead(404); res.end("not found"); return; }
        res.writeHead(200, { "Content-Type": mime[path.extname(file)] || "application/octet-stream" });
        res.end(data);
      });
    });
    server.listen(0, "127.0.0.1", () => resolve({ server, port: server.address().port }));
  });
}

function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let body = "";
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => resolve(JSON.parse(body)));
    }).on("error", reject);
  });
}

const emailServer = await startServer(tmp);
const siteServer = await startServer(ROOT);
const chrome = spawn("/usr/bin/google-chrome", [
  "--headless=new", "--disable-gpu", "--no-sandbox", "--hide-scrollbars",
  "--remote-debugging-port=9333", `--user-data-dir=${tmp}/profile`, "about:blank",
], { stdio: "ignore" });

let version;
for (let i = 0; i < 40; i++) {
  try { version = await getJson("http://127.0.0.1:9333/json/version"); break; }
  catch { await new Promise((r) => setTimeout(r, 100)); }
}
if (!version) throw new Error("Chrome did not open a debugging port");

const targets = await getJson("http://127.0.0.1:9333/json/list");
const page = targets.find((target) => target.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  ws.addEventListener("open", resolve, { once: true });
  ws.addEventListener("error", reject, { once: true });
});

let seq = 0;
const pending = new Map();
ws.addEventListener("message", (event) => {
  const msg = JSON.parse(event.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) reject(new Error(msg.error.message));
    else resolve(msg.result);
  }
});
function cdp(method, params = {}) {
  const id = ++seq;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}

await cdp("Page.enable");
await cdp("Runtime.enable");

async function shot(url, width, file, { clipSelector, script } = {}) {
  await cdp("Emulation.setDeviceMetricsOverride", { width, height: 1400, deviceScaleFactor: 2, mobile: width < 500 });
  await cdp("Page.navigate", { url });
  await new Promise((resolve) => setTimeout(resolve, 700));
  if (script) await cdp("Runtime.evaluate", { expression: script });
  await new Promise((resolve) => setTimeout(resolve, 250));
  const box = await cdp("Runtime.evaluate", {
    expression: `(() => {
      const el = document.querySelector(${JSON.stringify(clipSelector)});
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y + window.scrollY, width: r.width, height: r.height };
    })()`,
    returnByValue: true,
  });
  const rect = box.result.value;
  const pad = 20;
  const clip = rect
    ? { x: Math.max(0, rect.x - pad), y: Math.max(0, rect.y - pad), width: rect.width + pad * 2, height: rect.height + pad * 2, scale: 1 }
    : { x: 0, y: 0, width, height: 900, scale: 1 };
  const png = await cdp("Page.captureScreenshot", { format: "png", clip, captureBeyondViewport: true });
  fs.writeFileSync(path.join(OUT, file), Buffer.from(png.data, "base64"));
  console.log(file, Math.round(clip.width), "x", Math.round(clip.height));
}

for (const [file, base] of [
  ["family-brochure-email.html", "family-brochure-email"],
  ["family-enquiry-email.html", "family-enquiry-email"],
  ["staff-brochure-sent.html", "staff-brochure-sent"],
  ["staff-brochure-failed.html", "staff-brochure-failed"],
]) {
  const url = `http://127.0.0.1:${emailServer.port}/${file}`;
  await shot(url, 800, `${base}-desktop.png`, { clipSelector: 'table[width="600"]' });
  await shot(url, 390, `${base}-390.png`, { clipSelector: 'table[width="600"]' });
}

const thanksScript = `(() => {
  const form = document.querySelector("form[data-brochure-request]");
  if (form) form.hidden = true;
  const thanks = document.querySelector("[data-brochure-thanks]");
  if (thanks) thanks.hidden = false;
  const title = document.querySelector("[data-brochure-thanks-title]");
  if (title) title.textContent = "Thank you, Alex.";
  const card = document.getElementById("cookieConsent");
  if (card) card.style.display = "none";
})()`;

await shot(`http://127.0.0.1:${siteServer.port}/brochure.html`, 1280, "success-1280.png", { clipSelector: "[data-brochure-thanks]", script: thanksScript });
await shot(`http://127.0.0.1:${siteServer.port}/brochure.html`, 744, "success-744.png", { clipSelector: "[data-brochure-thanks]", script: thanksScript });
await shot(`http://127.0.0.1:${siteServer.port}/brochure.html`, 390, "success-390.png", { clipSelector: "[data-brochure-thanks]", script: thanksScript });
await shot(`http://127.0.0.1:${siteServer.port}/brochure.html`, 375, "success-375.png", { clipSelector: "[data-brochure-thanks]", script: thanksScript });

ws.close();
chrome.kill();
emailServer.server.close();
siteServer.server.close();
console.log("rendered", OUT);
