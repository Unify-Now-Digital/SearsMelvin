import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const html = readFileSync(new URL("../memorials.html", import.meta.url), "utf8");

assert.ok(html.includes('class="shortlist-btn-copy"'), "copy button keeps shortlist-btn-copy");
assert.ok(html.includes('class="shortlist-btn-email"'), "email button keeps shortlist-btn-email");
assert.ok(html.includes('class="shortlist-btn-copy" onclick="copyShareLink(event)"'), "copy handler receives the click");
assert.ok(html.includes('id="shortlistCopyLive"'), "copy status has a live region");
assert.ok(/id="shortlistCopyLive"[^>]*aria-live="polite"/.test(html), "live region is polite");
assert.ok(
  html.includes("document.getElementById('shareLink').value = window.location.origin + '/memorials?shortlist=' + slugs;"),
  "shared shortlist URL format stays the same",
);
assert.ok(/<script src="\/site-upgrades\.js[^"]*" defer><\/script>/.test(html), "click-id capture script stays on /memorials");
assert.equal(/<form[\s>]/i.test(html), false, "/memorials must not contain a form");
assert.equal(html.includes("nextElementSibling"), false, "the copy button is not the share input's next sibling");

const sourceMatch = html.match(/function copyShareLink\(event\) \{[\s\S]*?\n        \}\n\n        function emailShortlist/);
assert.ok(sourceMatch, "copyShareLink(event) must stay in memorials.html");
const source = sourceMatch[0].replace(/\n        function emailShortlist$/, "");
assert.match(source, /closest\('\.shortlist-btn-copy'\)/);
assert.match(source, /Link copied/);
assert.match(source, /2000/);
assert.doesNotMatch(source, /Copied!/);

function element(tag) {
  return {
    nodeType: 1,
    tagName: String(tag).toUpperCase(),
    className: "",
    id: "",
    value: "",
    childNodes: [],
    parentElement: null,
    _copyLabelHtml: null,
    closest(selector) {
      let node = this;
      while (node) {
        if (node.nodeType === 1 && selector === ".shortlist-btn-copy" && String(node.className).split(/\s+/).includes("shortlist-btn-copy")) return node;
        node = node.parentElement;
      }
      return null;
    },
    set textContent(value) {
      const text = { nodeType: 3, nodeValue: String(value), parentElement: this };
      this.childNodes = [text];
    },
    get textContent() {
      return this.childNodes.map((node) => (node.nodeType === 3 ? node.nodeValue : node.textContent || "")).join("");
    },
    get innerHTML() {
      return this.childNodes.map((node) => (node.nodeType === 3 ? node.nodeValue : `<${node.tagName.toLowerCase()}>`)).join("");
    },
    set innerHTML(value) {
      const text = { nodeType: 3, nodeValue: String(value).replace(/<[^>]+>/g, ""), parentElement: this };
      this.childNodes = [text];
    },
  };
}

function textNode(value, parent) {
  return { nodeType: 3, nodeValue: value, parentElement: parent };
}

function labelOf(button) {
  return button.childNodes.filter((node) => node.nodeType === 3).map((node) => node.nodeValue).join("").trim();
}

function mount() {
  const input = element("input");
  input.id = "shareLink";
  input.value = "https://searsmelvin.co.uk/memorials?shortlist=the-castell";
  input.select = () => {};
  const share = element("div");
  const shareLabel = element("label");
  share.childNodes = [shareLabel, input];
  shareLabel.parentElement = share;
  input.parentElement = share;
  Object.defineProperty(input, "nextElementSibling", { get: () => null });

  const svg = element("svg");
  const path = element("path");
  const button = element("button");
  button.className = "shortlist-btn-copy";
  const copyText = textNode("Copy Link", button);
  button.childNodes = [svg, copyText];
  svg.parentElement = button;
  svg.childNodes = [path];
  path.parentElement = svg;
  const email = element("button");
  email.className = "shortlist-btn-email";
  email.childNodes = [textNode("Email", email)];
  const live = element("span");
  live.id = "shortlistCopyLive";
  live.textContent = "";

  const byId = { shareLink: input, shortlistCopyLive: live };
  const document = {
    getElementById: (id) => byId[id] || null,
    querySelector: (selector) => (selector === ".shortlist-btn-copy" ? button : null),
    execCommand: () => false,
  };
  return { input, button, svg, path, email, live, document };
}

function run(document, extras = {}) {
  const timers = [];
  const context = {
    document,
    navigator: extras.navigator || { clipboard: { writeText: extras.writeText } },
    setTimeout(fn, ms) {
      const id = timers.push({ fn, ms, cleared: false }) - 1;
      return id;
    },
    clearTimeout(id) {
      if (timers[id]) timers[id].cleared = true;
    },
  };
  vm.runInNewContext(source, context);
  return {
    timers,
    copyShareLink: context.copyShareLink,
    flush() {
      for (const timer of timers) {
        if (!timer.cleared && !timer.ran) {
          timer.ran = true;
          timer.fn();
        }
      }
    },
  };
}

const copiedUrl = "https://searsmelvin.co.uk/memorials?shortlist=the-castell";

{
  const page = mount();
  let written = null;
  let resolveWrite;
  const pending = new Promise((resolve) => { resolveWrite = resolve; });
  const harness = run(page.document, { writeText: (value) => { written = value; return pending; } });
  harness.copyShareLink({ target: page.path });
  assert.equal(labelOf(page.button), "Copy Link");
  assert.equal(page.live.textContent, "");
  resolveWrite();
  await pending;
  await Promise.resolve();
  assert.equal(written, copiedUrl);
  assert.equal(page.input.value, copiedUrl);
  assert.equal(labelOf(page.button), "Link copied");
  assert.equal(page.live.textContent, "Link copied");
  assert.equal(labelOf(page.email), "Email");
  assert.equal(page.button.childNodes.some((node) => node.tagName === "SVG"), true, "the icon stays while the label changes");
  assert.equal(harness.timers.filter((timer) => !timer.cleared).length, 1);
  assert.equal(harness.timers.find((timer) => !timer.cleared).ms, 2000);
  harness.flush();
  assert.equal(labelOf(page.button), "Copy Link");
  assert.equal(page.live.textContent, "");
  assert.equal(page.button.childNodes.some((node) => node.tagName === "SVG"), true);
}

{
  const page = mount();
  let resolveWrite;
  const pending = new Promise((resolve, reject) => { resolveWrite = reject; });
  const harness = run(page.document, { writeText: () => pending });
  harness.copyShareLink({ target: page.button });
  resolveWrite(new Error("denied"));
  await pending.catch(() => {});
  await Promise.resolve();
  assert.equal(labelOf(page.button), "Copy Link");
  assert.equal(page.live.textContent, "");
  assert.equal(harness.timers.length, 0);
}

{
  const page = mount();
  const harness = run(page.document, { writeText: () => { throw new Error("unavailable"); } });
  harness.copyShareLink({ target: page.svg });
  await Promise.resolve();
  assert.equal(labelOf(page.button), "Copy Link");
  assert.equal(page.live.textContent, "");
}

{
  const page = mount();
  page.document.execCommand = () => true;
  const harness = run(page.document, { navigator: {} });
  harness.copyShareLink({ target: page.button });
  assert.equal(labelOf(page.button), "Link copied");
  assert.equal(page.live.textContent, "Link copied");
  harness.flush();
  assert.equal(labelOf(page.button), "Copy Link");
}

{
  const page = mount();
  page.document.execCommand = () => false;
  const harness = run(page.document, { navigator: {} });
  harness.copyShareLink();
  assert.equal(labelOf(page.button), "Copy Link");
  assert.equal(page.live.textContent, "");
}

{
  const page = mount();
  const harness = run(page.document, { writeText: () => Promise.resolve() });
  harness.copyShareLink({ target: page.path });
  await Promise.resolve();
  harness.copyShareLink({ target: page.button });
  await Promise.resolve();
  assert.equal(labelOf(page.button), "Link copied");
  assert.equal(harness.timers.filter((timer) => !timer.cleared).length, 1);
  harness.flush();
  assert.equal(labelOf(page.button), "Copy Link");
  assert.equal(page.button.childNodes.some((node) => node.tagName === "SVG"), true);
}

console.log("shortlist-copy: ok");
