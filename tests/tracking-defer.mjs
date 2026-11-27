// Deferred GTM and chat. A click-id landing inserts gtm.js immediately.
// With ads consent, a missing _gcl_aw (gclid) or _gcl_gb (wbraid) is filled
// in Google's GCL format. gbraid is not written. A plain landing waits.
// An early tel: tap is queued and pushed once after GTM is ready, and the
// call is not held. /contact has no chat. site-upgrades.js does not write
// _gcl_aw; sm_attr stays the store.
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
assert.match(home, /writeGclCookie\('_gcl_aw', clickIdToken\(queryValue\('gclid'\)\)\)/, "home fills _gcl_aw from gclid only");
assert.doesNotMatch(home, /writeGclCookie\([^)]*gbraid/, "home must not write gbraid into a GCL cookie");
assert.doesNotMatch(readFileSync("site-upgrades.js", "utf8"), /_gcl_aw\s*=/, "site-upgrades must not write _gcl_aw");

function extract(html, marker) {
  const at = html.indexOf(marker);
  assert.ok(at > -1, marker);
  const open = html.lastIndexOf("<script>", at) + "<script>".length;
  return html.slice(open, html.indexOf("</script>", at));
}

const gtmScript = extract(home, "googletagmanager.com/gtm.js?id=GTM-KRDX4BQ5");

function boot(search, opts = {}) {
  const scripts = [];
  const listeners = [];
  const timers = [];
  const cookieWrites = [];
  let cookieJar = opts.cookie || "";
  const store = new Map();
  const hostname = opts.hostname || "searsmelvin.co.uk";
  const location = {
    search,
    pathname: "/",
    hostname,
    protocol: opts.protocol || "https:",
    href: "https://" + hostname + "/" + (search || ""),
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
      cookieWrites.push(String(value));
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
  if (opts.consent != null) store.set("cookieConsent", opts.consent);
  context.window = context;
  context.globalThis = context;
  context.window.addEventListener = (type, fn, opts) => listeners.push({ type, fn, opts, target: "window" });
  context.window.removeEventListener = () => {};
  vm.createContext(context);
  vm.runInContext(gtmScript, context);
  return { scripts, listeners, timers, context, store, location, cookieWrites, cookie: () => cookieJar };
}

function assertImmediate(search) {
  const booted = boot(search);
  assert.equal(booted.scripts.length, 1, `${search}: gtm.js must be inserted before the idle timer`);
  assert.match(booted.scripts[0].src, /gtm\.js\?id=GTM-KRDX4BQ5/);
  assert.equal(booted.context.window.__smChatHook, true, `${search}: __smChatHook is set`);
  assert.equal(typeof booted.context.window.clarity, "function", `${search}: Clarity queue exists before insert`);
  const load = booted.listeners.find((entry) => entry.type === "load" && entry.target === "window");
  assert.ok(load, `${search}: load is still listened for`);
  load.fn();
  assert.equal(booted.timers.some((timer) => timer.idle), false, `${search}: idle is not armed once gtm.js is in`);
  const cap = booted.timers.find((timer) => !timer.idle && timer.ms === 3500);
  assert.ok(cap, `${search}: the 3.5s cap is still armed`);
  cap.fn();
  assert.equal(booted.scripts.length, 1, `${search}: the cap must not insert a second gtm.js`);
}

for (const search of ["?gclid=test", "?gbraid=Br.1", "?wbraid=Wb.1", "?GCLID=MixedCase", "?utm_source=google&wbraid=Wide.1"]) {
  assertImmediate(search);
}

for (const search of ["", "?utm_medium=cpc", "?xgclid=1", "?foo=gclid"]) {
  const booted = boot(search);
  assert.equal(booted.scripts.length, 0, `${search || "(plain)"}: gtm.js stays deferred`);
  assert.equal(booted.timers.some((timer) => timer.idle), false, `${search || "(plain)"}: idle waits for load`);
  const cap = booted.timers.find((timer) => !timer.idle && timer.ms === 3500);
  assert.ok(cap, `${search || "(plain)"}: the 3.5s cap is armed from navigation`);
  const load = booted.listeners.find((entry) => entry.type === "load" && entry.target === "window");
  assert.ok(load, `${search || "(plain)"}: load listener is armed`);
  load.fn();
  const idle = booted.timers.find((timer) => timer.idle);
  assert.ok(idle && idle.ms == null, `${search || "(plain)"}: post-load idle has no forced timeout`);
  idle.fn();
  assert.equal(booted.scripts.length, 1, `${search || "(plain)"}: idle after load inserts gtm.js`);
  cap.fn();
  assert.equal(booted.scripts.length, 1, `${search || "(plain)"}: the cap does not insert a second gtm.js`);
}

const paid = boot("?gclid=EarlyGclid_1");
vm.runInContext(readFileSync("site-upgrades.js", "utf8"), paid.context);
const saved = JSON.parse(paid.store.get("sm_attr"));
assert.equal(saved.gclid, "EarlyGclid_1", "gclid is still stored in sm_attr when the script evaluates");
assert.match(paid.cookie(), /(?:^|;\s*)sm_ad=1(?:;|$)/, "sm_ad=1 is set on the ad landing");
assert.doesNotMatch(paid.cookie(), /_gcl_aw/, "without ads consent the ad landing does not write _gcl_aw");
assert.equal(paid.store.has("sm_attr"), true);

function gclValue(write, name) {
  assert.equal(write.startsWith(name + "=GCL."), true, write);
  const pair = write.split(";")[0];
  const raw = pair.slice(name.length + 1);
  const match = /^GCL\.(\d{1,16})\.([\w-]{1,200})$/.exec(raw);
  assert.ok(match, raw);
  const seconds = Number(match[1]);
  const now = Math.floor(Date.now() / 1000);
  assert.ok(Math.abs(now - seconds) < 5, "cookie timestamp is the moment it was written");
  assert.match(write, /Path=\//);
  assert.match(write, /Max-Age=7776000/);
  assert.match(write, /SameSite=Lax/);
  return match[2];
}

const consented = boot("?gclid=Cj0Consent_Gclid-1&utm_source=google", { consent: "accepted" });
assert.equal(consented.scripts.length, 1, "consented click-id landing still inserts gtm.js immediately");
assert.equal(consented.cookieWrites.length, 1, "one click cookie");
assert.equal(gclValue(consented.cookieWrites[0], "_gcl_aw"), "Cj0Consent_Gclid-1");
assert.match(consented.cookieWrites[0], /Domain=\.searsmelvin\.co\.uk/);
assert.match(consented.cookieWrites[0], /Secure/);
vm.runInContext(readFileSync("site-upgrades.js", "utf8"), consented.context);
const consentedSaved = JSON.parse(consented.store.get("sm_attr"));
assert.equal(consentedSaved.gclid, "Cj0Consent_Gclid-1", "sm_attr stays the URL gclid, not the cookie");
assert.equal(consentedSaved.utm_source, "google");
assert.equal(consented.cookieWrites.filter((write) => write.startsWith("_gcl_")).length, 1, "site-upgrades does not write another click cookie");

const adsOnly = boot("?gclid=AdsOnly_1", { consent: JSON.stringify({ analytics: false, ads: true }) });
assert.equal(gclValue(adsOnly.cookieWrites[0], "_gcl_aw"), "AdsOnly_1");
for (const consent of ["declined", JSON.stringify({ analytics: true, ads: false }), ""]) {
  const denied = boot("?gclid=Denied_1", { consent });
  assert.equal(denied.cookieWrites.length, 0, `no click cookie when consent is ${consent || "(empty)"}`);
}

const present = boot("?gclid=NewGclid_1", { consent: "accepted", cookie: "_gcl_aw=GCL.1700000000.KeepMe" });
assert.equal(present.cookieWrites.length, 0, "an existing _gcl_aw is not overwritten");
assert.match(present.cookie(), /KeepMe/);

const unsafe = boot("?gclid=" + encodeURIComponent("bad id;Domain=evil"), { consent: "accepted" });
assert.equal(unsafe.cookieWrites.length, 0, "a gclid outside the linker alphabet is not written");
const previewHost = boot("?gclid=PreviewGclid_1", { consent: "accepted", hostname: "preview.sears-melvin-memorials.pages.dev" });
assert.equal(gclValue(previewHost.cookieWrites[0], "_gcl_aw"), "PreviewGclid_1");
assert.doesNotMatch(previewHost.cookieWrites[0], /Domain=/, "a non-site host does not get the production cookie domain");

const braids = boot("?gbraid=Braid_1&wbraid=Wbraid_1", { consent: "accepted" });
assert.equal(braids.cookieWrites.length, 1, "wbraid writes one cookie and gbraid writes none");
assert.equal(gclValue(braids.cookieWrites[0], "_gcl_gb"), "Wbraid_1");
assert.doesNotMatch(braids.cookie(), /_gcl_aw|_gcl_ag/, "gbraid is not stored as _gcl_aw or _gcl_ag");
const dotted = boot("?wbraid=Wb.1", { consent: "accepted" });
assert.equal(dotted.cookieWrites.length, 0, "a dotted wbraid is left for the linker, which also rejects it");
assert.equal(dotted.scripts.length, 1, "the dotted wbraid landing still starts gtm.js immediately");

function telAnchor(href) {
  return {
    id: "call",
    href,
    getAttribute(name) { return name === "href" ? href : ""; },
  };
}
function tapTel(booted, href) {
  const click = booted.listeners.find((entry) => entry.type === "click" && entry.target === "document");
  assert.ok(click, "tel listener is registered");
  const anchor = telAnchor(href);
  let prevented = false;
  click.fn({
    target: { nodeType: 1, closest(sel) { return sel === "a[href]" ? anchor : null; } },
    button: 0,
    defaultPrevented: false,
    preventDefault() { prevented = true; },
  });
  return { prevented, anchor };
}
function linkClicks(booted) {
  return booted.context.window.dataLayer.filter((entry) => entry && entry.event === "gtm.linkClick");
}

const plain = boot("");
assert.equal(plain.scripts.length, 0, "plain landing has not inserted gtm.js");
const pageHref = plain.location.href;
const first = tapTel(plain, "tel:+442038352548");
assert.equal(first.prevented, false, "early tel tap is not cancelled");
assert.equal(plain.location.href, pageHref, "the page does not delay or rewrite the call");
assert.equal(linkClicks(plain).length, 0, "the tel event is not pushed before GTM is ready");
assert.equal(plain.timers.some((timer) => timer.ms === 300 && !timer.idle), false, "no 300ms hold is armed for the call");
const second = tapTel(plain, "tel:+442038352548");
assert.equal(second.prevented, false, "a second early tap is not cancelled either");
assert.equal(plain.scripts.length, 1, "the tel tap inserts gtm.js");
assert.match(plain.scripts[0].src, /gtm\.js\?id=GTM-KRDX4BQ5/);
plain.context.window.dataLayer.push({ event: "gtm.load" });
let queued = linkClicks(plain);
assert.equal(queued.length, 2, "each early tap is pushed once when gtm.load arrives");
assert.equal(queued[0]["gtm.elementUrl"], "tel:+442038352548");
assert.equal(queued[0]["gtm.triggers"], "");
assert.equal(queued[1]["gtm.elementUrl"], "tel:+442038352548");
plain.context.window.dataLayer.push({ event: "gtm.load" });
plain.scripts[0].onload();
assert.equal(linkClicks(plain).length, 2, "gtm.load plus the script load handler do not push the taps again");
const after = tapTel(plain, "tel:+442000000000");
assert.equal(after.prevented, false, "a tap after ready is not cancelled");
assert.equal(linkClicks(plain).length, 2, "a tap after ready is left to GTM and is not pushed again");
assert.equal(plain.location.href, pageHref, "the call is never navigated by the queue");

const byFlag = boot("");
tapTel(byFlag, "tel:+442038352549");
assert.equal(linkClicks(byFlag).length, 0, "flag path also waits");
byFlag.scripts[0].onload();
assert.equal(byFlag.context.window.__smGtmReady, true);
queued = linkClicks(byFlag);
assert.equal(queued.length, 1, "script onload, which sets __smGtmReady, pushes the tap once");
byFlag.scripts[0].onload();
assert.equal(linkClicks(byFlag).length, 1, "onload twice does not push the tap again");

const formBoot = boot("");
const submit = formBoot.listeners.find((entry) => entry.type === "submit" && entry.target === "document");
assert.ok(submit, "form hold is still listening");
let formPrevented = false;
const form = { tagName: "FORM", id: "contactForm", submitted: false, submit() { form.submitted = true; } };
submit.fn({
  target: form,
  defaultPrevented: false,
  preventDefault() { formPrevented = true; },
});
assert.equal(formPrevented, true, "a native submit before ready is still held");
assert.equal(form.submitted, false);
const formEvents = formBoot.context.window.dataLayer.filter((entry) => entry && entry.event === "gtm.formSubmit");
assert.equal(formEvents.length, 1);
assert.equal(formEvents[0].eventTimeout, 300);
const formHold = formBoot.timers.find((timer) => timer.ms === 300 && !timer.idle);
assert.ok(formHold, "form navigation is still released after 300ms");
formHold.fn();
assert.equal(form.submitted, true);

console.log("tracking-defer: ok");
