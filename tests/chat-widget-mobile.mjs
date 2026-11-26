// The chat host is visible on phones and on desktop. The one-second
// fade does not turn pointer events off. The loader script is not skipped.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const css = readFileSync("chat-widget.css", "utf8");
assert.doesNotMatch(css, /@media \(max-width: 768px\) \{[^}]*display:\s*none/, "phones must not hide the chat host");

const desktop = css.slice(0, css.indexOf("@media (max-width: 768px)"));
assert.doesNotMatch(desktop, /chat-widget[^{]*\{[^}]*display:\s*none/, "desktop rules must not hide the chat host");

const anchor = css.match(/html body chat-widget \{([\s\S]*?)\n\}/);
assert.ok(anchor, "chat host needs a corner anchor");
assert.match(anchor[1], /opacity:\s*0/);
assert.match(anchor[1], /pointer-events:\s*auto !important/);
assert.match(anchor[1], /animation:\s*sm-chat-arrive 1s ease forwards/);
assert.match(anchor[1], /--sm-chat-bottom/);
assert.doesNotMatch(anchor[1], /pointer-events:\s*none/);
assert.doesNotMatch(css, /pointer-events:\s*none/, "the launcher must not disable pointer events");
assert.doesNotMatch(css, /sm-chat-arrive[^;}]*6s/, "the 6 second delay must stay gone");
assert.doesNotMatch(css, /PR #[0-9a-fA-F]{3,8}\b/, "a PR number must not look like a hex colour");
assert.match(css, /@keyframes sm-chat-arrive \{[\s\S]*to \{ opacity: 1; \}/);
assert.match(css, /html body::after \{[^}]*height:\s*16px/, "the spacer under the footer stays short");
const globals = readFileSync("site-globals.js", "utf8");
assert.match(globals, /bottom-right/);
assert.match(globals, /--sm-chat-bottom/);
assert.match(globals, /showPrompt/);

const openRule = css.match(/html body chat-widget\.sm-chat-open \{([\s\S]*?)\n\}/);
assert.ok(openRule, "open host needs a real in-viewport box");
assert.match(openRule[1], /transform:\s*none !important/);
assert.match(openRule[1], /z-index:\s*2000 !important/);
assert.match(openRule[1], /height:\s*calc\(100dvh - var\(--sm-chat-open-bottom, 0px\)\)/);
assert.match(openRule[1], /--sm-chat-open-bottom/);
assert.doesNotMatch(openRule[1], /translateZ\(0\)/);
assert.doesNotMatch(openRule[1], /width:\s*0/);

assert.match(globals, /sm-chat-open/);
assert.match(globals, /--sm-chat-open-bottom/);
assert.match(globals, /function pinChatHostOpen/);
assert.match(globals, /CHAT_OPEN_Z = 2000/);
assert.match(globals, /setImportant\(el, 'transform', 'none'\)/);
assert.match(globals, /setImportant\(el, 'width', '0px'\)/);
assert.match(globals, /setImportant\(el, 'transform', 'translateZ\(0\)'\)/);

const pages = readdirSync(".").filter((name) => name.endsWith(".html"));
let navPages = 0;
for (const name of pages) {
  const html = readFileSync(name, "utf8");
  if (!html.includes("widgets.leadconnectorhq.com/loader.js")) continue;
  if (!html.includes('class="mobile-bottom-nav"')) continue;
  navPages += 1;
  assert.match(html, /<a href="\/contact#enquiry-form" class="mobile-nav-item primary(?: active)?">[\s\S]*?<span>Enquire<\/span>/, `${name}: Enquire link changed`);
  assert.match(html, /mobile-nav-item primary(?: active)?">[\s\S]*?M4 6h16v12H4z/, `${name}: Enquire icon should be an envelope`);
  assert.doesNotMatch(html, /mobile-nav-item primary(?: active)?">[\s\S]{0,500}M21 15a2 2 0 01-2 2H7l-4 4/, `${name}: Enquire still uses the chat bubble`);
  const loaderAt = html.indexOf("widgets.leadconnectorhq.com/loader.js");
  assert.ok(loaderAt > -1, `${name}: chat loader missing`);
  const block = html.slice(html.lastIndexOf("<script>", loaderAt), html.indexOf("</script>", loaderAt));
  assert.match(block, /setTimeout\(load, 1000\)/, `${name}: chat must start loading at 1 second`);
  assert.doesNotMatch(block, /setTimeout\(load, 10000\)|pointerdown|touchstart/, `${name}: chat must not wait for interaction or 10 seconds`);
  assert.doesNotMatch(block, /matchMedia|innerWidth|max-width:\s*768/, `${name}: chat loader must not be skipped by viewport`);
}
// memorial.html (product pages) has a bottom nav but no chat (docs/TRACKING.md rule 6).
assert.ok(!readFileSync("memorial.html", "utf8").includes("widgets.leadconnectorhq.com/loader.js"), "memorial.html must not load the chat");
assert.ok(navPages >= 11, "expected the public pages with a bottom nav");
console.log(`chat-widget-mobile: ok (${navPages} bottom-nav pages)`);
