// GTM's linker/url_passthrough can rewrite a tapped type chip's href to an
// absolute URL (optionally with &_gl=... tracking params) before
// markTypeLinks runs. It must still recognise the tapped chip and highlight
// it, and must clear a stale aria-current from a previously-current chip.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const html = readFileSync("memorials.html", "utf8");
const start = html.indexOf("function chipTypeFromHref");
const end = html.indexOf("function keepChipInView");
assert.ok(start > 0 && end > start, "markTypeLinks/chipTypeFromHref block not found");
const source = html.slice(start, end);

// Static checks on onTypeChipClick: it must reuse chipTypeFromHref instead of
// hand-rolling a [?&]type= regex.
{
  const clickStart = html.indexOf("function onTypeChipClick");
  const clickEnd = html.indexOf("function removeFilter");
  assert.ok(clickStart > 0 && clickEnd > clickStart, "onTypeChipClick not found");
  const clickSource = html.slice(clickStart, clickEnd);
  assert.ok(clickSource.includes("chipTypeFromHref("), "onTypeChipClick must call chipTypeFromHref");
  assert.ok(!/\[\?&\]type=/.test(clickSource), "onTypeChipClick must not hand-roll a type= regex");
}

function makeLink(href, { inList = false, current = false } = {}) {
  const attrs = { href };
  if (current) attrs["aria-current"] = "page";
  const link = {
    inList,
    getAttribute(name) {
      return Object.prototype.hasOwnProperty.call(attrs, name) ? attrs[name] : null;
    },
    setAttribute(name, value) {
      attrs[name] = value;
    },
    removeAttribute(name) {
      delete attrs[name];
    },
    closest(selector) {
      return selector === ".type-browse-list" && inList ? list : null;
    },
    attrs,
  };
  return link;
}

let list;

function buildDom(chipHrefs, { footerHrefs = [], staleCurrentIndex } = {}) {
  const listLinks = chipHrefs.map((href, i) =>
    makeLink(href, { inList: true, current: i === staleCurrentIndex })
  );
  const footerLinks = footerHrefs.map((href) => makeLink(href, { inList: false }));
  const allLinks = [...listLinks, ...footerLinks];
  const keepChipInViewCalls = [];
  list = {
    scrollWidth: 100,
    clientWidth: 100,
    querySelector(selector) {
      if (selector === 'a[aria-current="page"]') {
        return listLinks.find((l) => l.getAttribute("aria-current") === "page") || null;
      }
      return null;
    },
  };
  const document = {
    querySelectorAll(selector) {
      if (selector === ".type-browse-list a") return listLinks;
      if (selector === 'a[href*="type="]') {
        return allLinks.filter((l) => (l.getAttribute("href") || "").includes("type="));
      }
      return [];
    },
    querySelector(selector) {
      if (selector === ".type-browse-list") return list;
      return null;
    },
  };
  return { listLinks, footerLinks, document, keepChipInViewCalls };
}

function makeContext(document, keepChipInViewCalls, typeFilter) {
  const context = {
    URL,
    state: { filters: { type: typeFilter } },
    location: { origin: "https://searsmelvin.co.uk", hostname: "searsmelvin.co.uk" },
    document,
    keepChipInView(l, chip) {
      keepChipInViewCalls.push({ list: l, chip });
    },
  };
  vm.createContext(context);
  vm.runInContext(`${source}\nthis.markTypeLinks = markTypeLinks;`, context);
  return context;
}

function run(typeFilter, chipHrefs, opts = {}) {
  const { listLinks, footerLinks, document, keepChipInViewCalls } = buildDom(chipHrefs, opts);
  const context = makeContext(document, keepChipInViewCalls, typeFilter);
  context.markTypeLinks();
  return { listLinks, footerLinks, keepChipInViewCalls };
}

const CHIPS = [
  "https://searsmelvin.co.uk/memorials", // All
  "https://searsmelvin.co.uk/memorials?type=lawn-headstones&_gl=abc",
  "https://searsmelvin.co.uk/memorials?type=childrens-memorials&_gl=abc",
];

// A real tap: GTM rewrote every chip href to an absolute URL with a tracking
// param. The tapped (Children's) chip must still get aria-current.
{
  const { listLinks } = run(["childrens-memorials"], CHIPS);
  assert.equal(listLinks[0].getAttribute("aria-current"), null, "All must not be current");
  assert.equal(listLinks[1].getAttribute("aria-current"), null, "Lawn must not be current");
  assert.equal(listLinks[2].getAttribute("aria-current"), "page", "Children's must be current");
}

// A stale aria-current on a rewritten chip that is no longer selected must be
// cleared.
{
  const { listLinks } = run(["childrens-memorials"], CHIPS, { staleCurrentIndex: 1 });
  assert.equal(listLinks[1].getAttribute("aria-current"), null, "stale current on Lawn must be cleared");
  assert.equal(listLinks[2].getAttribute("aria-current"), "page", "Children's must be current");
}

// No type selected: the All chip (absolute, no ?type=) is current, even
// though its href was rewritten too.
{
  const { listLinks } = run([], CHIPS);
  assert.equal(listLinks[0].getAttribute("aria-current"), "page", "All must be current with no filter");
  assert.equal(listLinks[1].getAttribute("aria-current"), null);
  assert.equal(listLinks[2].getAttribute("aria-current"), null);
}

// A relative footer link outside .type-browse-list uses the same parsed
// comparison and is unaffected by chips being rewritten absolute.
{
  const { footerLinks } = run(["childrens-memorials"], CHIPS, {
    footerHrefs: ["/memorials?type=childrens-memorials"],
  });
  assert.equal(footerLinks[0].getAttribute("aria-current"), "page", "matching footer link must be current");
}
{
  const { footerLinks } = run(["lawn-headstones"], CHIPS, {
    footerHrefs: ["/memorials?type=childrens-memorials"],
  });
  assert.equal(footerLinks[0].getAttribute("aria-current"), null, "non-matching footer link must not be current");
}

// keepChipInView is still invoked with the list and the newly-current chip.
{
  const { keepChipInViewCalls, listLinks } = run(["childrens-memorials"], CHIPS);
  assert.equal(keepChipInViewCalls.length, 1);
  assert.equal(keepChipInViewCalls[0].chip, listLinks[2]);
}

// FIX 1: a footer link whose href GTM rewrote to absolute (with &_gl=...)
// after the fact must still be found by the broader a[href*="type="]
// selector, and must have its stale aria-current cleared when the filter
// moves on — not just the links the selector happened to catch at page load.
{
  const footerHrefs = [
    "/memorials?type=lawn-headstones", // lawn1
    "/memorials?type=lawn-headstones", // lawn2
    "/memorials?type=childrens-memorials", // children
  ];
  const { listLinks, footerLinks, document, keepChipInViewCalls } = buildDom(CHIPS, { footerHrefs });
  const context = makeContext(document, keepChipInViewCalls, ["lawn-headstones"]);

  context.markTypeLinks();
  assert.equal(footerLinks[0].getAttribute("aria-current"), "page", "footer lawn1 must be current");
  assert.equal(footerLinks[1].getAttribute("aria-current"), "page", "footer lawn2 must be current");
  assert.equal(footerLinks[2].getAttribute("aria-current"), null, "footer children must not be current yet");

  // GTM decorates lawn1's href on touchstart, turning it absolute with _gl.
  footerLinks[0].setAttribute("href", "https://searsmelvin.co.uk/memorials?type=lawn-headstones&_gl=1*abc");

  // Selecting Children's must still find and clear the now-absolute lawn1
  // link, and mark the children footer link current.
  context.state.filters.type = ["childrens-memorials"];
  context.markTypeLinks();
  assert.equal(footerLinks[0].getAttribute("aria-current"), null, "rewritten footer lawn1 must be cleared");
  assert.equal(footerLinks[1].getAttribute("aria-current"), null, "footer lawn2 must be cleared");
  assert.equal(footerLinks[2].getAttribute("aria-current"), "page", "footer children must now be current");
}

// Nit: a cross-host link outside the chip row (same path/query shape) must
// never be marked, even when its type matches the selected filter.
{
  const { footerLinks } = run(["childrens-memorials"], CHIPS, {
    footerHrefs: ["https://other.example/memorials?type=childrens-memorials"],
  });
  assert.equal(footerLinks[0].getAttribute("aria-current"), null, "cross-host link must never be marked");
}

// Nit: www redirects to the apex today, so a www chip href must still match.
{
  const { listLinks } = run(
    ["lawn-headstones"],
    ["https://www.searsmelvin.co.uk/memorials?type=lawn-headstones&_gl=abc"]
  );
  assert.equal(listLinks[0].getAttribute("aria-current"), "page", "www chip href must still match the apex host");
}

console.log("chip-active-absolute-url: ok");
