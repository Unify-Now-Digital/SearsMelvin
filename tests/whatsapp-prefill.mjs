// WhatsApp prefilled message on product pages: same number, encoded text, clean URL.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const js = readFileSync("memorial-option-b.js", "utf8");
const html = readFileSync("memorial.html", "utf8");

assert.match(js, /442038352548/, "the WhatsApp number is unchanged");
assert.match(js, /encodeURIComponent\(whatsappMessage\(\)\)/);
assert.match(js, /Hi, I'm interested in /);
assert.match(js, /\^\(the\|a\|an\)\\s\+/i);
assert.match(js, /Hi, I'd like some help choosing a memorial: /);
assert.match(js, /parsed\.origin \+ parsed\.pathname/, "the page URL drops the query string");
assert.equal((js.match(/'whatsapp_click'/g) || []).length, 1, "a single push site for whatsapp_click");
assert.match(js, /link_location:\s*link\.dataset\.smWhatsapp/);
const waHandler = js.slice(js.indexOf("closest('a[data-sm-whatsapp]')"), js.indexOf("closest('a[data-sm-whatsapp]')") + 400);
assert.doesNotMatch(waHandler.split("});")[0], /preventDefault/, "the WhatsApp click is never blocked");
assert.doesNotMatch(js, /geo|blockedCountries|country.?block|cf-ipcountry/i, "no geo-blocking");
assert.match(html, /<script src="\/memorial-option-b\.js\?v=[^"]+" defer><\/script>/);

function run(opts) {
  const links = (opts.links || [
    { loc: "pdp_sticky" },
    { loc: "pdp_choices" },
    { loc: "pdp_desktop_bar" },
    { loc: "pdp_not_ready" },
  ]).map((l) => {
    const link = {
      href: "https://wa.me/442038352548",
      dataset: { smWhatsapp: l.loc },
      setAttribute(name, value) {
        if (name === "href") this.href = value;
      },
    };
    return link;
  });

  const product = { textContent: opts.productName ?? "Memorial" };
  const ids = {
    productName: product,
    selectedColourName: { textContent: "" },
    priceTotal: { textContent: "" },
    pdpBChosenColour: { textContent: "" },
    mobileBarColour: { textContent: "" },
    pdpBChoicesLine: { textContent: "" },
    pdpBTotal: { textContent: "" },
    addonsGrid: { querySelector: () => null },
    inscriptionInput: { value: "" },
    mobileBarStone: null,
  };

  const canon = {
    href: opts.canonical,
    getAttribute(name) {
      return name === "href" ? this.href : null;
    },
    setAttribute(name, value) {
      if (name === "href") this.href = value;
    },
  };

  const observers = [];
  const listeners = {};

  const document = {
    readyState: "loading",
    addEventListener(name, fn) {
      (listeners[name] ||= []).push(fn);
    },
    getElementById(id) {
      return Object.prototype.hasOwnProperty.call(ids, id) ? ids[id] : null;
    },
    querySelector(sel) {
      if (sel === 'link[rel="canonical"]') return opts.canonical != null ? canon : null;
      if (sel === "#stoneColourOptions input[name=\"colour\"]:checked") return null;
      return null;
    },
    querySelectorAll(sel) {
      if (sel === "a[data-sm-whatsapp]") return links;
      if (sel === 'input[name="addon"]:checked') return [];
      if (sel === '.pdp-b-tabs [role="tab"]') return [];
      return [];
    },
  };

  const ctx = {
    window: {
      matchMedia: () => ({ matches: false }),
      location: { pathname: opts.pathname || "/memorials/the-castell", search: opts.search || "?gclid=TEST" },
      dataLayer: [],
    },
    document,
    MutationObserver: function (cb) {
      this.cb = cb;
      this.observe = (el, init) => observers.push({ cb, el, init });
    },
    URL,
    encodeURIComponent,
  };
  ctx.window.window = ctx.window;
  ctx.global = ctx;
  vm.createContext(ctx);
  vm.runInContext(js, ctx);

  (listeners.DOMContentLoaded || []).forEach((fn) => fn());

  return { links, product, canon, observers, listeners, ctx };
}

function textOf(href) {
  const u = new URL(href);
  assert.equal(u.origin + u.pathname, "https://wa.me/442038352548");
  assert.equal([...u.searchParams.keys()].join(","), "text");
  return u.searchParams.get("text");
}

// Before the product name loads, use the default message and the clean canonical URL.
{
  const { links } = run({
    productName: "Memorial",
    canonical: "https://searsmelvin.co.uk/memorials/the-castell",
    pathname: "/memorials/the-castell",
    search: "?gclid=Cj0TEST&utm_source=google",
  });
  const expected = "Hi, I'd like some help choosing a memorial: https://searsmelvin.co.uk/memorials/the-castell";
  for (const link of links) {
    assert.equal(textOf(link.href), expected);
    assert.ok(!link.href.includes("gclid"), "gclid must not appear in the WhatsApp URL");
  }
}

// After the product name and canonical settle, the message names the memorial.
{
  const { links, product, observers } = run({
    productName: "Memorial",
    canonical: "https://searsmelvin.co.uk/memorials",
    pathname: "/memorials/the-castell",
  });
  product.textContent = "The Castell";
  const canonObs = observers.find((o) => o.init && o.init.attributeFilter && o.init.attributeFilter.includes("href"));
  const nameObs = observers.find((o) => o.el === product);
  assert.ok(nameObs, "productName is observed so the href updates after load");
  // The page updates canonical, then the product name.
  observers.filter((o) => o.el !== product).forEach((o) => { /* canonical set below */ });
  if (canonObs) {
    canonObs.el.href = "https://searsmelvin.co.uk/memorials/the-castell?ignored=1";
    canonObs.cb();
  }
  nameObs.cb();
  const expected = "Hi, I'm interested in The Castell memorial: https://searsmelvin.co.uk/memorials/the-castell";
  for (const link of links) assert.equal(textOf(link.href), expected);
}

// Canonical URLs drop query strings (gclid, utm) and hashes.
{
  const { links } = run({
    productName: "The York",
    canonical: "https://searsmelvin.co.uk/memorials/the-york?gclid=ABC#top",
    pathname: "/memorials/the-york",
  });
  assert.equal(
    textOf(links[0].href),
    "Hi, I'm interested in The York memorial: https://searsmelvin.co.uk/memorials/the-york"
  );
}

// Missing canonical falls back to the origin + pathname, never location.search.
{
  const { links } = run({
    productName: "The York",
    canonical: null,
    pathname: "/memorials/the-york",
    search: "?gclid=ABC",
  });
  assert.equal(
    textOf(links[0].href),
    "Hi, I'm interested in The York memorial: https://searsmelvin.co.uk/memorials/the-york"
  );
}

// Placeholder error names keep the default message.
for (const name of ["Product not found", "This memorial is not listed", "Error loading product", ""]) {
  const { links } = run({
    productName: name,
    canonical: "https://searsmelvin.co.uk/memorials/missing",
    pathname: "/memorials/missing",
  });
  assert.equal(
    textOf(links[0].href),
    "Hi, I'd like some help choosing a memorial: https://searsmelvin.co.uk/memorials/missing",
    name
  );
}

// Special characters in the name are URL-encoded, number stays the same.
{
  const { links } = run({
    productName: "O'Connor & Son",
    canonical: "https://searsmelvin.co.uk/memorials/oconnor-son",
    pathname: "/memorials/oconnor-son",
  });
  const href = links[0].href;
  assert.ok(href.startsWith("https://wa.me/442038352548?text="));
  assert.equal(
    decodeURIComponent(href.slice("https://wa.me/442038352548?text=".length)),
    "Hi, I'm interested in the O'Connor & Son memorial: https://searsmelvin.co.uk/memorials/oconnor-son"
  );
}


// Name patterns: don't double a leading The/A/An; keep "the" for other names.
const patterns = [
  ["The Castell", "Hi, I'm interested in The Castell memorial: https://searsmelvin.co.uk/memorials/the-castell", "/memorials/the-castell"],
  ["The Onyx Twin", "Hi, I'm interested in The Onyx Twin memorial: https://searsmelvin.co.uk/memorials/the-onyx-twin", "/memorials/the-onyx-twin"],
  ["The Sacred Heart", "Hi, I'm interested in The Sacred Heart memorial: https://searsmelvin.co.uk/memorials/the-sacred-heart", "/memorials/the-sacred-heart"],
  ["The Theydon", "Hi, I'm interested in The Theydon memorial: https://searsmelvin.co.uk/memorials/the-theydon", "/memorials/the-theydon"],
  ["The Yellow Rose", "Hi, I'm interested in The Yellow Rose memorial: https://searsmelvin.co.uk/memorials/the-yellow-rose", "/memorials/the-yellow-rose"],
  ["A Garden Seat", "Hi, I'm interested in A Garden Seat memorial: https://searsmelvin.co.uk/memorials/a-garden-seat", "/memorials/a-garden-seat"],
  ["An English Lawn", "Hi, I'm interested in An English Lawn memorial: https://searsmelvin.co.uk/memorials/an-english-lawn", "/memorials/an-english-lawn"],
  ["O'Connor & Son", "Hi, I'm interested in the O'Connor & Son memorial: https://searsmelvin.co.uk/memorials/oconnor-son", "/memorials/oconnor-son"],
];
for (const [name, expected, path] of patterns) {
  const { links } = run({
    productName: name,
    canonical: "https://searsmelvin.co.uk" + path,
    pathname: path,
  });
  assert.equal(textOf(links[0].href), expected, name);
  assert.doesNotMatch(textOf(links[0].href), /\bthe The\b|\bthe A\b|\bthe An\b/);
}

console.log("whatsapp-prefill: ok");
