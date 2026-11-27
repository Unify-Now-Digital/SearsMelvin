// Deferred GTM and chat. A click-id landing inserts gtm.js immediately.
// A plain landing waits. An early tel: tap still queues and navigates.
// /contact has no chat. Site code does not write _gcl_aw.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const contact = readFileSync("contact.html", "utf8");
assert.doesNotMatch(contact, /widgets\.leadconnectorhq\.com|data-widget-id/, "/contact has no chat loader");
assert.match(contact, /window\.__smChatHook = true/, "/contact still claims the legacy chat hook");
assert.match(contact, /GTM-KRDX4BQ5/, "/contact still loads GTM");

const home = readFileSync("index.html", "utf8");
assert.match(home, /html body::after\{content:"";display:block;height:16px;clear:both\}/, "16px footer spacer is in the first layout");
assert.match(home, /chat-widget\.css\?v=11" media="print" onload="this\.onload=null;this\.media='all'"/, "chat CSS is non-blocking");
assert.doesNotMatch(home, /_gcl_aw\s*=/, "home must not write _gcl_aw");
assert.doesNotMatch(readFileSync("site-upgrades.js", "utf8"), /_gcl_aw\s*=/, "site-upgrades must not write _gcl_aw");

function extract(html, marker) {
  const at = html.indexOf(marker);
  assert.ok(at > -1, marker);
  const open = html.lastIndexOf("<script>", at) + "<script>".length;
  return html.slice(open, html.indexOf("</script>", at));
}

const gtmScript = extract(home, "googletagmanager.com/gtm.js?id=GTM-KRDX4BQ5");

function boot(search) {
  const scripts = [];
  const listeners = [];
  const timers = [];
  let cookieJar = "";
  const store = new Map();
  const location = {
    search,
    pathname: "/",
    hostname: "searsmelvin.co.uk",
    protocol: "https:",
    href: "https://searsmelvin.co.uk/" + (search || ""),
  };
  const document = {
    referrer: "https://www.google.com/",
    readyState: "loading",
    documentElement: {},
    addEventListener(type, fn, opts) { listeners.push({ type, fn, opts, target: "document" }); },
    removeEventListener() {},
    getElementsByTagName() { return [{ parentNode: { insertBefore(node) { scripts.push(node); } } }]; },
    createElement(tag) { return { tag, async: false, src: "", onload: null, setAttribute() {} }; },
    querySelectorAll() { return []; },
    getElementById() { return null; },
  };
  Object.defineProperty(document, "cookie", {
    get() { return cookieJar; },
    set(value) {
      const pair = String(value).split(";")[0];
      cookieJar = cookieJar ? cookieJar + "; " + pair : pair;
    },
  });
  const context = {
    window: null,
    document,
    location,
    localStorage: {
      getItem(key) { return store.has(key) ? store.get(key) : null; },
      setItem(key, value) { store.set(key, value); },
      removeItem(key) { store.delete(key); },
    },
    sessionStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    navigator: {},
    fetch() { return Promise.resolve({ ok: false, json() { return Promise.resolve(null); } }); },
    setTimeout(fn, ms) { timers.push({ fn, ms }); return timers.length; },
    clearTimeout() {},
    requestIdleCallback(fn, opts) { timers.push({ fn, ms: opts && opts.timeout, idle: true }); return 1; },
    requestAnimationFrame(fn) { timers.push({ fn, ms: 0, raf: true }); return 1; },
    console,
  };
  context.window = context;
  context.globalThis = context;
  context.window.addEventListener = (type, fn, opts) => listeners.push({ type, fn, opts, target: "window" });
  context.window.removeEventListener = () => {};
  vm.createContext(context);
  vm.runInContext(gtmScript, context);
  return { scripts, listeners, timers, context, store, location, cookie: () => cookieJar };
}

function assertImmediate(search) {
  const booted = boot(search);
  assert.equal(booted.scripts.length, 1, `${search}: gtm.js must be inserted before the idle timer`);
  assert.match(booted.scripts[0].src, /gtm\.js\?id=GTM-KRDX4BQ5/);
  assert.equal(booted.context.window.__smChatHook, true, `${search}: __smChatHook is set`);
  const idle = booted.timers.find((timer) => timer.idle);
  assert.ok(idle, `${search}: the deferral is still armed for other visits`);
  idle.fn();
  assert.equal(booted.scripts.length, 1, `${search}: the idle timer must not insert a second gtm.js`);
}

for (const search of ["?gclid=test", "?gbraid=Br.1", "?wbraid=Wb.1", "?GCLID=MixedCase", "?utm_source=google&wbraid=Wide.1"]) {
  assertImmediate(search);
}

for (const search of ["", "?utm_medium=cpc", "?xgclid=1", "?foo=gclid"]) {
  const booted = boot(search);
  assert.equal(booted.scripts.length, 0, `${search || "(plain)"}: gtm.js stays deferred`);
  const idle = booted.timers.find((timer) => timer.idle);
  assert.ok(idle && idle.ms === 3500, `${search || "(plain)"}: idle cap is 3.5s`);
  idle.fn();
  assert.equal(booted.scripts.length, 1, `${search || "(plain)"}: idle still inserts gtm.js`);
}

const paid = boot("?gclid=EarlyGclid_1");
vm.runInContext(readFileSync("site-upgrades.js", "utf8"), paid.context);
const saved = JSON.parse(paid.store.get("sm_attr"));
assert.equal(saved.gclid, "EarlyGclid_1", "gclid is still stored in sm_attr when the script evaluates");
assert.match(paid.cookie(), /(?:^|;\s*)sm_ad=1(?:;|$)/, "sm_ad=1 is set on the ad landing");
assert.doesNotMatch(paid.cookie(), /_gcl_aw/, "the ad landing does not write _gcl_aw");

const plain = boot("");
assert.equal(plain.scripts.length, 0, "plain landing has not inserted gtm.js");
const click = plain.listeners.find((entry) => entry.type === "click" && entry.target === "document");
assert.ok(click, "tel hold is listening");
const anchor = {
  id: "call",
  href: "tel:+442038352548",
  getAttribute(name) { return name === "href" ? "tel:+442038352548" : ""; },
};
let prevented = false;
click.fn({
  target: { nodeType: 1, closest(sel) { return sel === "a[href]" ? anchor : null; } },
  button: 0,
  defaultPrevented: false,
  preventDefault() { prevented = true; },
});
assert.equal(prevented, true, "early tel tap is held");
assert.equal(plain.location.href.startsWith("tel:"), false, "the call is not started in the same turn");
const queued = plain.context.window.dataLayer.filter((entry) => entry && entry.event === "gtm.linkClick");
assert.equal(queued.length, 1, "early tel tap queues one gtm.linkClick");
assert.equal(queued[0]["gtm.elementUrl"], "tel:+442038352548");
assert.equal(queued[0].eventTimeout, 300);
assert.equal(plain.scripts.length, 1, "the tel tap inserts gtm.js");
assert.match(plain.scripts[0].src, /gtm\.js\?id=GTM-KRDX4BQ5/);
const gtmStart = plain.context.window.dataLayer.find((entry) => entry && entry.event === "gtm.js");
const linkAt = plain.context.window.dataLayer.indexOf(queued[0]);
const startAt = plain.context.window.dataLayer.indexOf(gtmStart);
assert.ok(startAt > -1 && startAt < linkAt, "gtm.js is queued before the tel event so the container can replay it");
const hold = plain.timers.find((timer) => timer.ms === 300 && !timer.idle);
assert.ok(hold, "navigation is released after 300ms");
hold.fn();
assert.equal(plain.location.href, "tel:+442038352548", "the call proceeds after the hold");
queued[0].eventCallback();
assert.equal(plain.location.href, "tel:+442038352548", "eventCallback does not navigate twice");

console.log("tracking-defer: ok");
