// Karen stays on desktop. Phones and small screens hide the chat host.
// The loader script is not skipped: click-intent still has its hook.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const css = readFileSync("chat-widget.css", "utf8");
const hide = css.match(/@media \(max-width: 768px\) \{[\s\S]*?chat-widget,[\s\S]*?display:\s*none !important;\s*\}/);
assert.ok(hide, "chat-widget.css must hide chat-widget at max-width 768px");
assert.match(hide[0], /lc-chat-widget,/);
assert.match(hide[0], /#chat-widget-button,/);

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
const globals = readFileSync("site-globals.js", "utf8");
assert.match(globals, /bottom-right/);
assert.match(globals, /--sm-chat-bottom/);
assert.match(globals, /showPrompt/);

const pages = readdirSync(".").filter((name) => name.endsWith(".html"));
let navPages = 0;
for (const name of pages) {
  const html = readFileSync(name, "utf8");
  if (!html.includes("widgets.leadconnectorhq.com/loader.js")) continue;
  if (!html.includes('class="mobile-bottom-nav"')) continue;
  navPages += 1;
  assert.match(html, /<a href="\/contact#enquiry-form" class="mobile-nav-item primary(?: active)?">[\s\S]*?<span>Enquire<\/span>/, `${name}: Enquire link changed`);
  const loaderAt = html.indexOf("widgets.leadconnectorhq.com/loader.js");
  assert.ok(loaderAt > -1, `${name}: chat loader missing`);
  const block = html.slice(html.lastIndexOf("<script>", loaderAt), html.indexOf("</script>", loaderAt));
  assert.match(block, /setTimeout\(load, 10000\)/, `${name}: chat loader fallback changed`);
  assert.doesNotMatch(block, /matchMedia|innerWidth|max-width:\s*768/, `${name}: chat loader must not be skipped by viewport`);
}
assert.ok(navPages >= 12, "expected the public pages with a bottom nav");
console.log(`chat-widget-mobile: ok (${navPages} bottom-nav pages)`);
