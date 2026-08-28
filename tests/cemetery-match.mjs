// SMCemetery.match — maps a Google Places pick back onto our priced cemetery
// rows. Both the product page and the contact form depend on it: it is the only
// path by which an enquiry gets a cemetery_id and a quote gets a permit fee,
// because Google's gmp-placeselect hands us a display name and nothing else.
//
// A wrong match attaches a wrong permit fee to a real quote, so the matcher is
// deliberately conservative and these tests pin that: anything ambiguous must
// return null and leave the submission as free text.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// site-globals.js is a browser IIFE. Give it just enough DOM to run, then read
// the helper it publishes.
globalThis.window = {};
globalThis.document = {
  readyState: "complete",
  addEventListener() {},
  querySelector: () => null,
  querySelectorAll: () => [],
  getElementById: () => null,
  body: { classList: { contains: () => false } },
  createElement: () => ({ style: {}, classList: { add() {}, remove() {} } }),
};
globalThis.getComputedStyle = () => ({ display: "none" });

const source = readFileSync(new URL("../site-globals.js", import.meta.url), "utf8");
try { new Function(source)(); } catch { /* DOM-dependent init is not under test */ }

const SMCemetery = globalThis.window.SMCemetery;
assert.ok(SMCemetery && typeof SMCemetery.match === "function", "site-globals must publish SMCemetery.match");

// The six real Sears Melvin rows as of 2026-08-26.
const rows = [
  { id: "edmonton", name: "Edmonton Cemetery", fee: 135 },
  { id: "great-northern", name: "Great Northern London Cemetery", fee: 195 },
  { id: "mill-hill", name: "Mill Hill Cemetery", fee: null },
  { id: "new-southgate", name: "New Southgate Cemetery", fee: 180 },
  { id: "southgate", name: "Southgate Cemetery", fee: 135 },
  { id: "tottenham", name: "Tottenham Cemetery", fee: 120 },
];

const id = value => {
  const row = SMCemetery.match(value, rows);
  return row ? row.id : null;
};

// Names we price, in the shapes Google actually returns them.
assert.equal(id("Edmonton Cemetery"), "edmonton");
assert.equal(id("Edmonton Cemetery, Church Street, London"), "edmonton");
assert.equal(id("Great Northern London Cemetery & Crematorium"), "great-northern");
assert.equal(id("Mill Hill Cemetery"), "mill-hill");
assert.equal(id("Tottenham Cemetery"), "tottenham");

// Exact match must win over a merely-containing one: "Southgate Cemetery" is a
// substring of "New Southgate Cemetery", and picking the wrong one is a £45 error.
assert.equal(id("Southgate Cemetery"), "southgate");
assert.equal(id("New Southgate Cemetery"), "new-southgate");

// Ambiguous or unknown input stays free text rather than guessing.
assert.equal(id("Southgate"), null, "ambiguous prefix must not resolve");
assert.equal(id("Hendon Cemetery & Crematorium"), null, "a cemetery we do not price");
assert.equal(id("Hendon Police College"), null);
assert.equal(id(""), null);
assert.equal(id(null), null);
assert.equal(SMCemetery.match("Edmonton Cemetery", []), null, "empty catalogue must not throw");
assert.equal(SMCemetery.match("Edmonton Cemetery", null), null);

// Rows without a usable name must be skipped, not crash the picker.
assert.equal(SMCemetery.match("Edmonton Cemetery", [{ id: "x" }, ...rows]).id, "edmonton");

console.log("cemetery match tests passed");
