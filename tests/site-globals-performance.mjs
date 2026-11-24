import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const globals = readFileSync("site-globals.js", "utf8");
const watch = globals.slice(
  globals.indexOf("function watchChatWidget()"),
  globals.indexOf("function readShortlist()")
);

assert.ok(watch.includes("function schedulePosition()"), "chat placement has one scheduler");
assert.match(watch, /if \(!hostReady \|\| framePending\) return;/, "placement waits for a chat host and runs at most once per frame");
assert.doesNotMatch(watch, /observe\(document\.body, \{[^}]*attributes:\s*true/, "page-wide style/class churn is not observed");
assert.match(watch, /observe\(document\.body, \{ childList: true, subtree: true \}\)/, "host insertion is still discovered");
assert.match(watch, /hostObserver\.observe\(hosts\[i\], \{ attributes: true, attributeFilter: \['style', 'class'\] \}\)/, "late inline styles on the chat host still re-pin it");
assert.doesNotMatch(watch, /setInterval\(function \(\) \{\s*applyWidgetPosition/, "polls go through the frame scheduler");
assert.match(watch, /function startHostPolls\(\)/, "polls start only once the host exists");
assert.match(watch, /if \(\+\+ticks >= 20\) clearInterval\(poll\);/, "the 10 second re-pin window is kept");
const init = globals.slice(globals.indexOf("function init()"));
assert.match(init, /requestIdleCallback\(decorate, \{ timeout: 1200 \}\)/, "footer and skip-link work waits for idle with a timeout");

const contact = readFileSync("contact.html", "utf8");
assert.match(contact, /class="contact-form-wrapper" id="enquiry-form"/, "contact form paints without a delayed opacity animation");
assert.doesNotMatch(contact, /contact-form-wrapper animate-in/, "contact form is not initially transparent");

for (const page of readdirSync(".").filter((name) => name.endsWith(".html"))) {
  const html = readFileSync(page, "utf8");
  if (!html.includes("/site-globals.js")) continue;
  assert.match(html, /\/site-globals\.js\?v=20261124a/, `${page}: shared script cache buster`);
}

console.log("site-globals-performance: ok");
