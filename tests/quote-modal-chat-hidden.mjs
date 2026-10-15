// Chat widget must be hidden while the memorial quote pop-up is open (PR #189).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const html = readFileSync("memorial.html", "utf8");
const css = readFileSync("chat-widget.css", "utf8");
const open = html.slice(html.indexOf("function openQuoteModal"), html.indexOf("function closeQuoteModal"));
const close = html.slice(html.indexOf("function closeQuoteModal"), html.indexOf("function closeQuoteModal") + 600);
assert.match(open, /body\.classList\.add\('sm-quote-open'\)/, "openQuoteModal adds sm-quote-open");
assert.match(close, /body\.classList\.remove\('sm-quote-open'\)/, "closeQuoteModal removes sm-quote-open");
assert.match(css, /body\.sm-quote-open chat-widget[^{]*\{\s*display:\s*none !important/, "chat-widget.css hides chat while quote open");
assert.match(html, /chat-widget\.css/, "memorial.html loads chat-widget.css");
console.log("quote-modal-chat-hidden: ok");
