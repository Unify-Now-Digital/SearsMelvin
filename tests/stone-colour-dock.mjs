// The product page keeps the in-page stone picker and adds a fixed dock.
// The dock selects through the same updateColour path.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../memorial.html", import.meta.url), "utf8");
const globals = readFileSync(new URL("../site-globals.js", import.meta.url), "utf8");

assert.match(html, /id="stoneColourDock"/);
assert.match(html, /id="stoneColourDockSwatch"/);
assert.match(html, /id="stoneColourDockName"/);
assert.match(html, /id="stoneColourDockScroll"/);
assert.match(html, /id="stoneColourOptions"/, "the in-page picker stays");
assert.match(html, /id="phoneColourSlot"/, "the phone colour slot stays");
assert.match(html, /id="cookieConsent"/, "the cookie choice stays");
assert.match(html, /event: 'sm_quote_submit'/);
assert.match(html, /GTM-KRDX4BQ5/);

const dockCss = html.slice(html.indexOf("Stone colour dock."), html.indexOf("Search Button in Nav"));
assert.match(dockCss, /position:\s*fixed/);
assert.match(dockCss, /bottom:\s*0/);
assert.match(dockCss, /--sm-colour-dock-height/);
assert.match(dockCss, /env\(safe-area-inset-bottom, 0px\)/);
assert.match(dockCss, /font-family:\s*var\(--sm-font-body\)/);
assert.match(dockCss, /--sm-target-min/);
assert.match(dockCss, /@media \(max-width: 1024px\), \(pointer: coarse\)/);
assert.match(dockCss, /max-width: 1024px/);
assert.match(dockCss, /--sm-phone-bar-offset/);
assert.doesNotMatch(dockCss, /#[0-9a-fA-F]{3,8}\b/, "the dock uses tokens, not a raw colour");
assert.doesNotMatch(dockCss, /monospace|ui-monospace|font-family:\s*["']?Courier/i);
assert.match(dockCss, /padding-bottom:\s*calc\(72px \+ var\(--sm-colour-dock-height\)/);

const render = html.slice(html.indexOf("function renderStoneColours"), html.indexOf("function colourInputBySlug"));
assert.match(render, /renderStoneColourDock\(\)/);
const update = html.slice(html.indexOf("function updateColour"), html.indexOf("function updateLetterColour"));
assert.match(update, /syncStoneColourDock\(input\)/);
assert.match(update, /state\.colour = input\.value/);
assert.match(update, /showStoneColourPreview\(input\)/);
assert.match(html, /function syncStoneColourDock/);
assert.match(html, /input\.checked = true;\s*updateColour\(input\)/);

assert.match(globals, /querySelector\('\.stone-colour-dock'\)/);
assert.match(globals, /stone-colour-dock/);

console.log("stone-colour-dock: ok");
