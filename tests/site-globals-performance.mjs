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
assert.doesNotMatch(init, /requestIdleCallback/, "skip link and footer are built synchronously (focus order, no CLS)");
assert.match(init, /ensureSkipLink\(\);\s*ensureFooterDisclosures\(\);\s*compactFooter\(\);/, "skip link and footer run in init");
assert.match(watch, /querySelectorAll\(HOST_SELECTOR\)/, "legacy chat iframes and widget-id hosts are watched too");
assert.match(watch, /legacyPinned/, "nodes pinned by the legacy/heuristic paths are watched for late rewrites");
assert.match(watch, /applyWidgetPosition\(\);\s*watchHosts\(\);/, "each pass picks up newly pinned nodes");
const legacy = globals.slice(globals.indexOf("function pinLegacy("), globals.indexOf("function pinChatHostOpen("));
assert.match(legacy, /setImportant\(el, 'bottom', bottom \+ 'px'\);\s*setImportant\(el, 'right', '24px'\);/, "legacy writes are guarded so observing them cannot loop");
assert.doesNotMatch(globals, /style\.setProperty\('bottom', bottomLegacy/, "no unguarded legacy writes remain");

const contact = readFileSync("contact.html", "utf8");
assert.match(contact, /class="contact-form-wrapper" id="enquiry-form"/, "contact form paints without a delayed opacity animation");
assert.doesNotMatch(contact, /contact-form-wrapper animate-in/, "contact form is not initially transparent");

for (const page of readdirSync(".").filter((name) => name.endsWith(".html"))) {
  const html = readFileSync(page, "utf8");
  if (!html.includes("/site-globals.js")) continue;
  assert.match(html, /\/site-globals\.js\?v=20261124b/, `${page}: shared script cache buster`);
}

console.log("site-globals-performance: ok");

// One placement pass collects the chat blockers once (liftClear used to
// rescan every link and catalogue price up to ~17 times per pass).
assert.match(globals, /function chatBlockers\(\) \{\s*if \(blockerCache\) return blockerCache;/, "blockers are cached within a pass");
assert.match(globals, /blockerCache = null;\s*try \{\s*placeChatWidget\(\);\s*\} finally \{\s*blockerCache = null;/, "the cache never outlives one placement pass");
const shown = globals.slice(globals.indexOf("function shownRect(el)"), globals.indexOf("function quoteLabel"));
assert.ok(shown.indexOf("getBoundingClientRect()") < shown.indexOf("getComputedStyle(el)"), "off-screen elements skip computed style");
console.log("site-globals-performance: cache ok");
