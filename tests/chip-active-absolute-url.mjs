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

function buildDom(chipHrefs, { footerHref, staleCurrentIndex } = {}) {
  const listLinks = chipHrefs.map((href, i) =>
    makeLink(href, { inList: true, current: i === staleCurrentIndex })
  );
  const footerLinks = footerHref ? [makeLink(footerHref, { inList: false })] : [];
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
      if (selector === 'a[href^="/memorials?type="]') {
        return allLinks.filter((l) => (l.getAttribute("href") || "").startsWith("/memorials?type="));
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

function run(typeFilter, chipHrefs, opts = {}) {
  const { listLinks, footerLinks, document, keepChipInViewCalls } = buildDom(chipHrefs, opts);
  const context = {
    URL,
    state: { filters: { type: typeFilter } },
    location: { origin: "https://searsmelvin.co.uk" },
    document,
    keepChipInView(l, chip) {
      keepChipInViewCalls.push({ list: l, chip });
    },
  };
  vm.createContext(context);
  vm.runInContext(`${source}\nthis.markTypeLinks = markTypeLinks;`, context);
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
    footerHref: "/memorials?type=childrens-memorials",
  });
  assert.equal(footerLinks[0].getAttribute("aria-current"), "page", "matching footer link must be current");
}
{
  const { footerLinks } = run(["lawn-headstones"], CHIPS, {
    footerHref: "/memorials?type=childrens-memorials",
  });
  assert.equal(footerLinks[0].getAttribute("aria-current"), null, "non-matching footer link must not be current");
}

// keepChipInView is still invoked with the list and the newly-current chip.
{
  const { keepChipInViewCalls, listLinks } = run(["childrens-memorials"], CHIPS);
  assert.equal(keepChipInViewCalls.length, 1);
  assert.equal(keepChipInViewCalls[0].chip, listLinks[2]);
}

console.log("chip-active-absolute-url: ok");
