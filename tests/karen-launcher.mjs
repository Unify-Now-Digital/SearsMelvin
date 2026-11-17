// Desktop-only restyle of the LeadConnector launcher.
// Below 1024px, and when the widget is absent, the script must not touch the page.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync("assets/karen-launcher.js", "utf8");
assert.ok(source.length < 2800, `karen-launcher.js is ${source.length} bytes; keep it about 2 KB`);
assert.doesNotMatch(source, /leadconnector|dataLayer|document\.cookie|gtag\(|GTM-/i);
assert.match(source, /matchMedia\("\(min-width: 1024px\)"\)/);
assert.match(source, /setTimeout\(/);
assert.doesNotMatch(source, /setInterval/);

function element(tag) {
  const node = {
    nodeType: 1,
    tagName: tag.toUpperCase(),
    id: "",
    className: "",
    textContent: "",
    shadowRoot: null,
    children: [],
    appendChild(child) {
      this.children.push(child);
      return child;
    },
    getElementById(id) {
      return walk(this).find((el) => el.id === id) || null;
    },
    querySelector(sel) {
      return this.querySelectorAll(sel)[0] || null;
    },
    querySelectorAll(sel) {
      return walk(this).filter((el) => matches(el, sel));
    },
  };
  return node;
}

function walk(node, out = []) {
  for (const child of node.children || []) {
    out.push(child);
    if (child.shadowRoot) out.push(...walk(child.shadowRoot));
    walk(child, out);
  }
  return out;
}

function matches(el, sel) {
  if (sel === "chat-widget, lc-chat-widget") return el.tagName === "CHAT-WIDGET" || el.tagName === "LC-CHAT-WIDGET";
  if (sel === "#lc_text-widget") return el.id === "lc_text-widget";
  if (sel === "#lc_text-widget--btn") return el.id === "lc_text-widget--btn";
  return false;
}

function run({ matchesMedia, host, closedShadow }) {
  const doc = element("html");
  const warns = [];
  const timers = [];
  const state = { intervals: 0, observed: 0, disconnected: 0, listeners: 0 };
  const created = [];
  if (host) {
    const widget = element("chat-widget");
    if (!closedShadow) {
      const root = element("shadow");
      root.children = [];
      const box = element("div");
      box.id = "lc_text-widget";
      const prompt = element("div");
      prompt.className = "lc_text-widget--prompt";
      const btn = element("button");
      btn.id = "lc_text-widget--btn";
      box.appendChild(prompt);
      box.appendChild(btn);
      root.appendChild(box);
      widget.shadowRoot = root;
    }
    doc.appendChild(widget);
  }
  const before = JSON.stringify(doc.children.map((el) => el.tagName));
  class MutationObserver {
    constructor(cb) { this.cb = cb; }
    observe() { state.observed += 1; }
    disconnect() { state.disconnected += 1; }
  }
  const context = {
    window: {},
    document: {
      documentElement: doc,
      querySelectorAll: (sel) => doc.querySelectorAll(sel),
      createElement: (tag) => {
        const el = element(tag);
        created.push(el);
        return el;
      },
    },
    MutationObserver,
    console: { warn: (msg) => warns.push(String(msg)) },
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    setInterval: () => { state.intervals += 1; return 0; },
  };
  context.window.matchMedia = () => ({ matches: matchesMedia });
  context.window.addEventListener = () => { state.listeners += 1; };
  context.window.removeEventListener = () => { state.listeners -= 1; };
  vm.runInNewContext(source, context, { filename: "karen-launcher.js" });
  return { doc, warns, timers, created, before, ...state, state };
}

const narrow = run({ matchesMedia: false, host: true });
assert.equal(narrow.observed, 0, "below 1024px must not observe the page");
assert.equal(narrow.timers.length, 0, "below 1024px must not schedule work");
assert.equal(narrow.listeners, 0, "below 1024px must not listen for the widget");
assert.equal(narrow.warns.length, 0, "below 1024px must not warn");
assert.equal(narrow.created.length, 0, "below 1024px must not create elements");
assert.equal(JSON.stringify(narrow.doc.children.map((el) => el.tagName)), narrow.before);
assert.equal(narrow.doc.children[0].shadowRoot.children.length, 1, "below 1024px must leave the shadow tree alone");

const absent = run({ matchesMedia: true, host: false });
assert.equal(absent.observed, 1);
assert.equal(absent.created.length, 0, "without the widget the script must not create a style");
assert.equal(absent.doc.children.length, 0);
assert.equal(absent.intervals, 0, "no polling loop");
assert.equal(absent.timers.length, 1);
assert.ok(absent.timers[0].ms <= 15000 && absent.timers[0].ms >= 1000, "give-up must be bounded");
absent.timers[0].fn();
assert.equal(absent.state.disconnected, 1, "observer must stop");
assert.equal(absent.state.listeners, 0, "widget listener must stop");
assert.equal(absent.warns.length, 0, "a missing widget is left as it is, with no warning");

const closed = run({ matchesMedia: true, host: true, closedShadow: true });
closed.timers[0].fn();
assert.equal(closed.created.length, 0, "a closed shadow root must not be restyled");
assert.equal(closed.doc.children[0].shadowRoot, null);
assert.equal(closed.warns.length, 1, "one warning when the shadow root cannot be styled");
closed.timers[0].fn();
assert.equal(closed.warns.length, 1, "the warning must not repeat");

const desktop = run({ matchesMedia: true, host: true });
const root = desktop.doc.children[0].shadowRoot;
const style = root.getElementById("sm-karen-launcher");
assert.ok(style, "desktop with an open shadow root adds one style");
assert.equal(style.tagName, "STYLE");
assert.match(style.textContent, /#lc_text-widget--btn\{[^}]*width:56px/);
assert.match(style.textContent, /border-radius:50%/);
assert.match(style.textContent, /--sm-color-action-primary-bg/);
assert.match(style.textContent, /--sm-color-action-primary-text/);
assert.match(style.textContent, /--sm-font-body/);
assert.match(style.textContent, /\.lc_text-widget--prompt\{display:none !important\}|\.lc_text-widget--prompt\{display:none!important\}/);
assert.doesNotMatch(style.textContent, /#lc_text-widget\{[^}]*display:\s*none/, "must not hide the chat");
assert.equal(root.children.filter((el) => el.tagName === "STYLE").length, 1);
desktop.timers[0].fn();
assert.equal(desktop.warns.length, 0, "a styled widget does not warn");

const pages = readdirSync(".").filter((name) => name.endsWith(".html"));
let widgetPages = 0;
for (const name of pages) {
  const html = readFileSync(name, "utf8");
  if (!html.includes("widgets.leadconnectorhq.com/loader.js")) {
    assert.doesNotMatch(html, /karen-launcher\.js/, `${name} must not load the launcher without the widget`);
    continue;
  }
  widgetPages += 1;
  assert.match(html, /<script src="\/assets\/karen-launcher\.js" defer><\/script>/, `${name}: defer script missing`);
  const loaderAt = html.indexOf("widgets.leadconnectorhq.com/loader.js");
  const block = html.slice(html.lastIndexOf("<script>", loaderAt), html.indexOf("</script>", loaderAt));
  assert.doesNotMatch(block, /karen-launcher/, `${name}: widget loader must stay untouched`);
  assert.match(block, /data-widget-id', '69ff236b0d119858db377c07'/);
}
assert.equal(widgetPages, 13);

console.log(`karen-launcher: ok (${source.length} bytes, ${widgetPages} pages)`);
