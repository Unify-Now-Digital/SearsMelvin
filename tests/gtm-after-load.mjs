// GTM insert timing approved 27 Nov 2026. A plain visit waits for the first
// idle after load, with a 3.5s cap from navigation. A click id, a key, a
// scroll, a tap, or a tel: inserts immediately. The tel queue flushes once
// on __smGtmReady or gtm.load, including when the page is already hidden.
// Consent defaults are not pushed again. One gtm.js means one page view.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const home = readFileSync("index.html", "utf8");
const pages = ["index.html", "memorials.html", "memorial.html", "contact.html", "about.html", "faq.html", "brochure.html", "quote.html", "track.html", "privacy.html", "terms.html", "resources.html", "care-guide.html"];

function extract(html) {
  const at = html.indexOf("googletagmanager.com/gtm.js?id=GTM-KRDX4BQ5");
  assert.ok(at > -1);
  const open = html.lastIndexOf("<script>", at) + "<script>".length;
  return html.slice(open, html.indexOf("</script>", at));
}

const gtmScript = extract(home);

for (const name of pages) {
  const html = readFileSync(name, "utf8");
  const defaults = html.match(/gtag\('consent', 'default'/g) || [];
  assert.equal(defaults.length, 1, `${name}: consent default is pushed once`);
  const defAt = html.indexOf("gtag('consent', 'default'");
  const updateAt = html.indexOf("gtag('consent', 'update'");
  const loaderAt = html.indexOf("function loadGtm");
  assert.ok(defAt > -1 && updateAt > defAt && loaderAt > updateAt, `${name}: stored choice stays before the loader`);
  assert.equal(extract(html), gtmScript, `${name}: GTM loader matches home`);
  assert.doesNotMatch(extract(html), /gtag\('consent'/, `${name}: loader does not push consent`);
}

assert.match(readFileSync("docs/TRACKING.md", "utf8"), /okRkCPGTqJsdEK-15Oo-/);
assert.match(readFileSync("docs/TRACKING.md", "utf8"), /_M8_CK2IrYkcEK-15Oo-/);
assert.match(readFileSync("contact.html", "utf8"), /event: 'sm_lead_submit'/);
assert.match(readFileSync("memorial.html", "utf8"), /event: 'sm_quote_submit'/);
assert.match(readFileSync("site-globals.js", "utf8"), /window\.__smQueueChatOpen/);

function boot(search, opts = {}) {
  const scripts = [];
  const listeners = [];
  const timers = [];
  const existing = opts.existingSrc
    ? [{ src: opts.existingSrc, getAttribute() { return opts.existingSrc; } }]
    : [];
  const document = {
    referrer: "",
    readyState: opts.readyState || "loading",
    hidden: false,
    visibilityState: "visible",
    documentElement: {},
    addEventListener(type, fn, opts) { listeners.push({ type, fn, opts, target: "document" }); },
    removeEventListener() {},
    getElementsByTagName() { return existing.concat([{ parentNode: { insertBefore(node) { scripts.push(node); } } }]); },
    createElement(tag) { return { tag, async: false, src: "", onload: null, setAttribute() {} }; },
    querySelectorAll() { return []; },
    getElementById() { return null; },
  };
  const context = {
    window: null,
    document,
    location: { search, pathname: "/", hostname: "searsmelvin.co.uk", protocol: "https:", href: "https://searsmelvin.co.uk/" + (search || "") },
    localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    sessionStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    navigator: {},
    setTimeout(fn, ms) { timers.push({ fn, ms }); return timers.length; },
    clearTimeout() {},
    requestIdleCallback(fn, opts) { timers.push({ fn, ms: opts && opts.timeout, idle: true }); return 1; },
    performance: {},
    Date,
    console,
  };
  if (opts.elapsed != null) context.performance.timeOrigin = Date.now() - opts.elapsed;
  context.window = context;
  context.globalThis = context;
  context.window.addEventListener = (type, fn, opts) => listeners.push({ type, fn, opts, target: "window" });
  context.window.removeEventListener = () => {};
  vm.createContext(context);
  vm.runInContext(gtmScript, context);
  return { scripts, listeners, timers, context, document };
}

function events(booted, name) {
  return booted.context.window.dataLayer.filter((entry) => entry && entry.event === name);
}
function fire(booted, type, target) {
  const found = booted.listeners.filter((entry) => entry.type === type && (!target || entry.target === target));
  assert.ok(found.length, type);
  for (const entry of found) entry.fn({ type, isTrusted: true });
}
function cap(booted) {
  return booted.timers.find((timer) => !timer.idle && timer.fn && timer.ms != null && timer.ms <= 3500 && timer.ms !== 300);
}
function telAnchor(href) {
  return { id: "call", href, getAttribute(name) { return name === "href" ? href : ""; } };
}
function tapTel(booted, href) {
  const click = booted.listeners.find((entry) => entry.type === "click" && entry.target === "document");
  const anchor = telAnchor(href);
  let prevented = false;
  click.fn({
    target: { nodeType: 1, closest(sel) { return sel === "a[href]" ? anchor : null; } },
    button: 0,
    defaultPrevented: false,
    preventDefault() { prevented = true; },
  });
  return prevented;
}
function hide(booted) {
  booted.document.hidden = true;
  booted.document.visibilityState = "hidden";
  fire(booted, "visibilitychange", "document");
  fire(booted, "pagehide", "window");
}

for (const elapsed of [500, 1500, 3000, 3400]) {
  const booted = boot("", { elapsed });
  assert.equal(booted.scripts.length, 0, `${elapsed}ms: still waiting`);
  const remain = cap(booted);
  assert.ok(remain, `${elapsed}ms: cap is armed`);
  assert.ok(Math.abs(remain.ms - (3500 - elapsed)) < 50, `${elapsed}ms: cap is ${remain.ms}, expected about ${3500 - elapsed}`);
  assert.equal(tapTel(booted, "tel:+442038352548"), false, `${elapsed}ms: tel tap is not cancelled`);
  assert.equal(booted.scripts.length, 1, `${elapsed}ms: tel tap inserts gtm.js immediately`);
  assert.equal(events(booted, "gtm.linkClick").length, 0, `${elapsed}ms: the call waits for GTM`);
  hide(booted);
  assert.equal(events(booted, "gtm.linkClick").length, 0, `${elapsed}ms: hiding does not flush early`);
  booted.scripts[0].onload();
  assert.equal(events(booted, "gtm.linkClick").length, 1, `${elapsed}ms: one call after the script loads while hidden`);
  booted.context.window.dataLayer.push({ event: "gtm.load" });
  hide(booted);
  booted.scripts[0].onload();
  assert.equal(events(booted, "gtm.linkClick").length, 1, `${elapsed}ms: still one call conversion`);
  assert.equal(events(booted, "gtm.js").length, 1, `${elapsed}ms: one page-view insert`);
}

for (const elapsed of [1000, 3000]) {
  const booted = boot("", { elapsed });
  hide(booted);
  assert.equal(booted.scripts.length, 0, `bounce at ${elapsed}ms does not insert gtm.js`);
  assert.equal(events(booted, "gtm.js").length, 0, `bounce at ${elapsed}ms has no page view yet`);
  const remain = cap(booted);
  assert.ok(remain.ms > 0, `bounce at ${elapsed}ms is still inside the 3.5s cap`);
}

for (const type of ["keydown", "scroll", "pointerdown", "touchstart"]) {
  const booted = boot("");
  fire(booted, type, "window");
  assert.equal(booted.scripts.length, 1, `${type} inserts gtm.js immediately`);
  assert.equal(events(booted, "gtm.js").length, 1, `${type} inserts once`);
}

const untrusted = boot("");
const key = untrusted.listeners.find((entry) => entry.type === "keydown");
key.fn({ isTrusted: false });
assert.equal(untrusted.scripts.length, 0, "a synthetic key does not insert gtm.js");

const clickId = boot("?gclid=FastClick_1");
assert.equal(clickId.scripts.length, 1, "click-id landing inserts gtm.js in the head script");
assert.equal(clickId.timers.some((timer) => timer.ms != null && timer.ms <= 300 && !timer.idle), false, "click-id insert does not wait 300ms");
fire(clickId, "load", "window");
assert.equal(clickId.timers.some((timer) => timer.idle), false, "load does not schedule idle after gtm.js is already in");
cap(clickId).fn();
fire(clickId, "pointerdown", "window");
assert.equal(clickId.scripts.length, 1, "click-id landing does not insert a second gtm.js");
assert.equal(events(clickId, "gtm.js").length, 1, "one gtm.js event, so one page view");

const plain = boot("");
assert.equal(plain.scripts.length, 0);
assert.equal(plain.timers.some((timer) => timer.idle), false, "idle is not armed before load");
fire(plain, "load", "window");
const plainIdle = plain.timers.find((timer) => timer.idle);
assert.ok(plainIdle && plainIdle.ms == null, "post-load idle has no timeout of its own");
plainIdle.fn();
assert.equal(plain.scripts.length, 1);
cap(plain).fn();
fire(plain, "scroll", "window");
assert.equal(plain.scripts.length, 1, "load, idle, cap and scroll share one insert");
assert.equal(events(plain, "gtm.js").length, 1, "no double page view");

const already = boot("", { existingSrc: "https://www.googletagmanager.com/gtm.js?id=GTM-KRDX4BQ5" });
fire(already, "load", "window");
already.timers.find((timer) => timer.idle).fn();
assert.equal(already.scripts.length, 0, "an existing gtm.js tag is not inserted again");

const chat = boot("");
assert.equal(chat.context.window.__smChatHook, true);
assert.equal(typeof chat.context.window.clarity, "function");
chat.context.window.clarity("event", "queued");
assert.equal(chat.context.window.clarity.q.length, 1, "Clarity calls before the tag are queued");
assert.equal(chat.scripts.length, 0, "the Clarity stub does not insert gtm.js");
chat.context.window.__smQueueChatOpen();
assert.equal(chat.scripts.length, 1, "chat open inserts gtm.js immediately");
assert.equal(events(chat, "sm_chat_open").length, 0, "chat open stays queued until GTM is ready");
chat.context.window.__smQueueChatOpen();
chat.scripts[0].onload();
assert.equal(events(chat, "sm_chat_open").length, 1, "one queued chat open");
chat.context.window.dataLayer.push({ event: "gtm.load" });
chat.context.window.__smQueueChatOpen();
assert.equal(events(chat, "sm_chat_open").length, 1, "a later open is not pushed again");

for (const name of ["sm_lead_submit", "sm_quote_submit"]) {
  const booted = boot("");
  booted.context.window.dataLayer.push({ event: name, form_id: name === "sm_lead_submit" ? "contactForm" : "quoteForm" });
  const form = { tagName: "FORM", id: name === "sm_lead_submit" ? "contactForm" : "quoteForm", submitted: false, submit() { form.submitted = true; } };
  const submit = booted.listeners.find((entry) => entry.type === "submit");
  let prevented = false;
  submit.fn({ target: form, defaultPrevented: false, preventDefault() { prevented = true; } });
  assert.equal(prevented, true, `${name}: native submit is still held`);
  assert.equal(events(booted, "gtm.formSubmit").length, 1);
  assert.equal(events(booted, name).length, 1, `${name} is not re-pushed by the loader`);
  const hold = booted.timers.find((timer) => timer.ms === 300);
  hold.fn();
  assert.equal(form.submitted, true);
  booted.scripts[0].onload();
  assert.equal(events(booted, name).length, 1, `${name} stays a single push after GTM is ready`);
}

const loaded = boot("", { readyState: "complete" });
assert.equal(loaded.timers.some((timer) => timer.idle), true, "a finished document arms idle immediately");

console.log("gtm-after-load: ok");
