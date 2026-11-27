// Deferred GTM and chat. gclid is stored before gtm.js is inserted, an early
// tel: tap queues gtm.linkClick and still navigates, and /contact has no chat.
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

function extract(html, marker) {
  const at = html.indexOf(marker);
  assert.ok(at > -1, marker);
  const open = html.lastIndexOf("<script>", at) + "<script>".length;
  return html.slice(open, html.indexOf("</script>", at));
}

const store = new Map();
const scripts = [];
const listeners = [];
const timers = [];
let cookieJar = "";
const location = {
  search: "?gclid=EarlyGclid_1&utm_medium=cpc",
  pathname: "/",
  hostname: "searsmelvin.co.uk",
  protocol: "https:",
  href: "https://searsmelvin.co.uk/?gclid=EarlyGclid_1&utm_medium=cpc",
};
const document = {
  referrer: "https://www.google.com/",
  readyState: "loading",
  documentElement: {},
  addEventListener(type, fn, opts) { listeners.push({ type, fn, opts, target: "document" }); },
  removeEventListener() {},
  getElementsByTagName() { return [{ parentNode: { insertBefore(node) { scripts.push(node); } } }]; },
  createElement(tag) {
    return { tag, async: false, src: "", onload: null, setAttribute() {} };
  },
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

const gtmScript = extract(home, "googletagmanager.com/gtm.js?id=GTM-KRDX4BQ5");
vm.runInContext(gtmScript, context);
assert.equal(scripts.length, 0, "evaluating the head script must not insert gtm.js yet");
assert.equal(context.window.__smChatHook, true, "__smChatHook is set before gtm.js");
assert.ok(Array.isArray(context.window.dataLayer), "dataLayer exists before gtm.js");
const idle = timers.find((timer) => timer.idle);
assert.ok(idle && idle.ms === 3500, "GTM hard timeout is 3.5s");

vm.runInContext(readFileSync("site-upgrades.js", "utf8"), context);
const saved = JSON.parse(store.get("sm_attr"));
assert.equal(saved.gclid, "EarlyGclid_1", "gclid is in sm_attr before gtm.js");
assert.match(cookieJar, /(?:^|;\s*)sm_ad=1(?:;|$)/, "sm_ad=1 is set before gtm.js");
assert.equal(scripts.length, 0, "gclid capture does not insert gtm.js");
assert.match(readFileSync("site-upgrades.js", "utf8"), /_gcl_aw/, "click-id capture still reads _gcl_aw in the synchronous script");

const click = listeners.find((entry) => entry.type === "click" && entry.target === "document");
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
assert.equal(location.href.startsWith("tel:"), false, "the call is not started in the same turn");
const queued = context.window.dataLayer.filter((entry) => entry && entry.event === "gtm.linkClick");
assert.equal(queued.length, 1, "early tel tap queues one gtm.linkClick");
assert.equal(queued[0]["gtm.elementUrl"], "tel:+442038352548");
assert.equal(queued[0].eventTimeout, 300);
assert.equal(scripts.length, 1, "the tel tap inserts gtm.js");
assert.match(scripts[0].src, /gtm\.js\?id=GTM-KRDX4BQ5/);
const gtmStart = context.window.dataLayer.find((entry) => entry && entry.event === "gtm.js");
const linkAt = context.window.dataLayer.indexOf(queued[0]);
const startAt = context.window.dataLayer.indexOf(gtmStart);
assert.ok(startAt > -1 && startAt < linkAt, "gtm.js is queued before the tel event so the container can replay it");
const hold = timers.find((timer) => timer.ms === 300 && !timer.idle);
assert.ok(hold, "navigation is released after 300ms");
hold.fn();
assert.equal(location.href, "tel:+442038352548", "the call proceeds after the hold");
queued[0].eventCallback();
assert.equal(location.href, "tel:+442038352548", "eventCallback does not navigate twice");

console.log("tracking-defer: ok");
