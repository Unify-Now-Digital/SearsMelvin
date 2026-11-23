// Clarity loads only after analytics consent, with the id read from /api/config.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import vm from "node:vm";
import { clarityProjectId, onRequestGet } from "../functions/api/config.js";

const read = (p) => readFileSync(p, "utf8");
const DUMMY = "abcdefghij";

// --- config.js
for (const bad of [undefined, null, "", "PLACEHOLDER", "short", "has space12", "abc-defghij", "a".repeat(17), "a".repeat(40), 12345678901, "<script>x</script>"]) {
  assert.equal(clarityProjectId(bad), "", String(bad));
}
assert.equal(clarityProjectId(DUMMY), DUMMY);
const get = (headers, env) => onRequestGet({ request: new Request("https://www.searsmelvin.co.uk/api/config", { headers }), env });
let res = await get({ Origin: "https://www.searsmelvin.co.uk" }, { CLARITY_PROJECT_ID: DUMMY });
assert.equal(res.status, 200);
assert.equal((await res.json()).clarityProjectId, DUMMY);
res = await get({ Origin: "https://www.searsmelvin.co.uk" }, {});
assert.equal((await res.json()).clarityProjectId, "");
res = await get({ Origin: "https://evil.example" }, { CLARITY_PROJECT_ID: DUMMY });
assert.equal(res.status, 403);

// --- repo scan
const files = [];
const walk = (d) => {
  for (const e of readdirSync(d, { withFileTypes: true })) {
    if (e.name === ".git" || e.name === "node_modules") continue;
    const p = d === "." ? e.name : `${d}/${e.name}`;
    if (e.isDirectory()) walk(p);
    else if (/\.(html|js|mjs|json|jsonc|md|toml|css)$/.test(e.name) || e.name === "_headers") files.push(p);
  }
};
walk(".");
for (const f of files) {
  const s = read(f);
  for (const m of s.matchAll(/clarity\.ms\/tag\/["']?\s*([^"'\s+)]*)/g)) {
    assert.equal(m[1], "", `${f}: hardcoded clarity tag id`);
  }
  if (f !== "functions/api/config.js" && f !== "tests/clarity-consent.mjs") {
    assert.ok(!s.includes("CLARITY_PROJECT_ID"), `${f}: env name outside config.js`);
  }
}
const clientSrc = read("sm-clarity.js");
assert.ok(clientSrc.includes("clarityProjectId") && clientSrc.includes("/api/config"));
assert.ok(!/localStorage\.setItem|setAttribute\('data-clarity-id/.test(clientSrc));

// --- cookie-consent.js dispatches the event from pushUpdate
const cc = read("cookie-consent.js");
const pu = cc.slice(cc.indexOf("function pushUpdate"), cc.indexOf("function readStored"));
assert.ok(pu.includes("'sm-cookie-consent'") && pu.includes("dispatchEvent"));

// --- loader in vm
function makeEnv({ stored, cfg = { clarityProjectId: DUMMY }, ok = true, idle = true, path = "/", ready = "loading" }) {
  const log = { fetches: [], scripts: [], clarityCalls: [], idleOpts: null, timeouts: [] };
  const listeners = {};
  const attrs = new Map();
  const mk = (id) => ({ id, setAttribute(k, v) { attrs.set(id + k, v); }, getAttribute: () => null, closest: () => null });
  const els = {};
  let booting = true;
  const doc = {
    readyState: ready,
    addEventListener(n, f) { (listeners["doc:" + n] ||= []).push(f); },
    getElementById: (id) => (booting ? null : (els[id] ||= mk(id))),
    querySelectorAll(sel) {
      if (sel === "form") return [mk("f1")];
      return [{ getAttribute: () => "text", closest: () => null, setAttribute(k, v) { log.fieldMask = v; }, parentElement: mk("wrap") }];
    },
    createElement: () => ({}),
    getElementsByTagName: () => [{ parentNode: { insertBefore(el) { log.scripts.push(el.src); } } }],
  };
  const root = {
    document: doc,
    location: { pathname: path },
    localStorage: { getItem: () => (stored === undefined ? null : stored) },
    addEventListener(n, f) { (listeners[n] ||= []).push(f); },
    removeEventListener(n, f) { listeners[n] = (listeners[n] || []).filter((x) => x !== f); },
    setTimeout(f, ms) { log.timeouts.push([f, ms]); },
    fetch(url, opts) {
      log.fetches.push([url, opts]);
      return Promise.resolve({ ok, json: () => Promise.resolve(cfg) });
    },
    CustomEvent: class {},
  };
  if (idle) root.requestIdleCallback = (f, o) => { log.idleOpts = o; log.idleFn = f; };
  vm.createContext(root);
  vm.runInContext(read("cookie-consent.js"), root);
  booting = false;
  root.window = root;
  const fire = (n, detail) => (listeners[n] || []).forEach((f) => f({ detail }));
  const run = () => vm.runInContext(clientSrc, root);
  return { root, log, listeners, attrs, fire, run };
}
const tick = () => new Promise((r) => setImmediate(r));
const flush = async () => { for (let i = 0; i < 6; i++) await tick(); };
const store = (a, d) => JSON.stringify({ analytics: a, ads: d });

// default: nothing
let e = makeEnv({});
e.run();
e.fire("load");
await flush();
assert.equal(e.log.fetches.length, 0);
assert.equal(e.log.scripts.length, 0);
assert.equal(e.log.idleFn, undefined);
e.fire("doc:DOMContentLoaded");
assert.equal(e.attrs.get("contactFormdata-clarity-mask"), "True");
assert.equal(e.log.fieldMask, "True");

// reject and ads-only: nothing
for (const s of ["declined", store(false, false), store(false, true)]) {
  e = makeEnv({ stored: s });
  e.run(); e.fire("load"); await flush();
  assert.equal(e.log.fetches.length, 0, s);
  assert.equal(e.log.scripts.length, 0, s);
}

// stored accept: waits for load, then idle, then fetch, inject, consentv2
e = makeEnv({ stored: store(true, false) });
e.run();
await flush();
assert.equal(e.log.fetches.length, 0, "waits for load");
e.fire("load");
assert.equal(e.log.idleOpts.timeout, 3000);
assert.equal(e.log.fetches.length, 0, "waits for idle");
e.log.idleFn();
assert.equal(e.log.fetches[0][0], "/api/config");
assert.equal(e.log.fetches[0][1].credentials, "same-origin");
await flush();
assert.deepEqual(e.log.scripts, ["https://www.clarity.ms/tag/" + DUMMY]);
assert.equal(typeof e.root.clarity, "function");
const q = Array.from(e.root.clarity.q[0]);
assert.equal(q[0], "consentv2");
assert.deepEqual(JSON.parse(JSON.stringify(q[1])), { ad_Storage: "denied", analytics_Storage: "granted" });

// inject once; later events do not re-inject; later reject sends denied
e.fire("sm-cookie-consent", { analytics: true, ads: true });
await flush();
assert.equal(e.log.scripts.length, 1);
e.fire("sm-cookie-consent", { analytics: false, ads: false });
assert.equal(e.root.clarity.q.length, 3);
assert.equal(e.root.clarity.q[2][1].analytics_Storage, "denied");

// late accept in session, already-loaded page, no requestIdleCallback → setTimeout(1)
e = makeEnv({ ready: "complete", idle: false });
e.run();
e.fire("sm-cookie-consent", { analytics: true, ads: true });
assert.equal(e.log.timeouts.length, 1);
assert.equal(e.log.timeouts[0][1], 1);
e.log.timeouts[0][0]();
await flush();
assert.equal(e.log.scripts.length, 1);
assert.equal(e.root.clarity.q[0][1].ad_Storage, "granted");

// empty id / not ok: no inject
for (const o of [{ cfg: { clarityProjectId: "" } }, { cfg: {} }, { ok: false }]) {
  e = makeEnv({ stored: "accepted", ready: "complete", ...o });
  e.run();
  e.log.idleFn();
  await flush();
  assert.equal(e.log.fetches.length, 1);
  assert.equal(e.log.scripts.length, 0);
}

// accept, reject before idle completes, then accept again: must still load
e = makeEnv({ ready: "complete" });
e.run();
e.fire("sm-cookie-consent", { analytics: true, ads: false });
assert.equal(typeof e.log.idleFn, "function");
e.fire("sm-cookie-consent", { analytics: false, ads: false });
e.log.idleFn();
await flush();
assert.equal(e.log.scripts.length, 0);
assert.equal(e.log.fetches.length, 1);
e.fire("sm-cookie-consent", { analytics: true, ads: false });
assert.equal(typeof e.log.idleFn, "function");
e.log.idleFn();
await flush();
assert.deepEqual(e.log.scripts, ["https://www.clarity.ms/tag/" + DUMMY]);

// admin, partner, track and quote paths skip the loader (masking still runs)
for (const path of ["/admin", "/admin.html", "/admin-products", "/partner", "/track", "/track.html", "/quote", "/quote.html"]) {
  e = makeEnv({ stored: "accepted", ready: "complete", path });
  e.run();
  assert.equal(e.log.idleFn, undefined, path);
  assert.equal(e.log.fetches.length, 0, path);
  assert.equal(e.log.scripts.length, 0, path);
}
// other public pages still load
e = makeEnv({ stored: "accepted", ready: "complete", path: "/memorials" });
e.run();
assert.equal(typeof e.log.idleFn, "function");

// --- HTML contract
const pages = readdirSync(".").filter((f) => f.endsWith(".html") && read(f).includes("/cookie-consent.js"));
assert.ok(pages.length >= 15);
for (const p of pages) {
  const s = read(p);
  assert.match(s, /<script src="\/cookie-consent\.js\?v=20261123a"><\/script>\s*\n\s*<script src="\/sm-clarity\.js\?v=20261123b" defer><\/script>/, p);
}
const has = (f, re) => assert.match(read(f), re, f);
has("contact.html", /id="contactForm"[^>]*data-clarity-mask="True"/);
has("memorial.html", /id="quoteForm"[^>]*data-clarity-mask="True"/);
has("brochure.html", /id="brochureRequest"[^>]*data-clarity-mask="True"/);
has("index.html", /id="appointmentForm"[^>]*data-clarity-mask="True"/);
has("index.html", /id="apptFormFields"[^>]*data-clarity-mask="True"/);
has("memorials.html", /id="shortlistEnquiry"[^>]*data-clarity-mask="True"/);
has("track.html", /id="portalLookupForm"[^>]*data-clarity-mask="True"/);
has("track.html", /id="portalView"[^>]*data-clarity-mask="True"/);
has("track.html", /id="orderView"[^>]*data-clarity-mask="True"/);
has("quote.html", /id="emailLookup"[^>]*data-clarity-mask="True"/);
has("quote.html", /id="quotesListView"[^>]*data-clarity-mask="True"/);
has("quote.html", /id="singleQuoteView"[^>]*data-clarity-mask="True"/);
has("memorial.html", /id="qsInscription"[^>]*data-clarity-mask="True"/);
has("brochure.html", /id="brochureThanks"[^>]*data-clarity-mask="True"/);
const privacy = read("privacy.html");
assert.match(privacy, /Microsoft Clarity/);
assert.match(privacy, /session recordings and heatmaps/);
assert.match(privacy, /only after you accept analytics cookies/);
assert.match(privacy, /Form inputs and personal details are masked/);
assert.match(privacy, /https:\/\/www\.microsoft\.com\/privacy\/privacystatement/);

// --- CSP report-only carries Clarity hosts; enforced does not
const line = (n) => read("_headers").split("\n").find((l) => l.trim().startsWith(n + ":"));
const ro = line("Content-Security-Policy-Report-Only");
assert.match(ro, /script-src[^;]*https:\/\/\*\.clarity\.ms[^;]*https:\/\/c\.bing\.com/);
assert.match(ro, /connect-src[^;]*https:\/\/\*\.clarity\.ms[^;]*https:\/\/c\.bing\.com/);
assert.ok(!ro.includes("unsafe-eval"));
assert.ok(!line("Content-Security-Policy").includes("clarity"));

console.log("clarity-consent ok");
