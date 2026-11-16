import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import areaData from "../data/boroughs.json" with { type: "json" };
import { onRequest } from "../functions/areas/[[path]].js";
import { visibleField, renderAreaPage, resolveAreaPath, areaPaths } from "../functions/_area-pages.js";
import { businessJsonLd } from "../functions/_business-schema.js";

const EXPECTED = {
  barnet: [
    "East Finchley Cemetery",
    "Edgware Cemetery (Federation of Synagogues)",
    "Edgwarebury Cemetery",
    "Hendon Cemetery & Crematorium",
    "Hoop Lane Jewish Cemetery",
    "Islington & St Pancras Cemetery",
    "Mill Hill Cemetery",
    "New Southgate Cemetery",
  ],
  enfield: [
    "Edmonton Cemetery",
    "Edmonton Federation Cemetery",
    "Enfield Cemetery",
    "Hertford Road Cemetery",
    "Lavender Hill Cemetery",
    "Southgate Cemetery (Old Southgate Cemetery)",
    "Strayfield Road Cemetery",
    "Tottenham Park Cemetery",
    "Trent Park Cemetery",
  ],
  harrow: [
    "Eastcote Lane Cemetery",
    "Harrow Cemetery",
    "Harrow Weald Cemetery",
    "Paines Lane Cemetery",
    "Pinner New Cemetery",
    "Roxeth Hill Burial Ground",
    "Wealdstone Cemetery",
  ],
  brent: [
    "Alperton Cemetery",
    "Carpenders Park Lawn Cemetery",
    "Paddington Old Cemetery",
    "Willesden New Cemetery",
  ],
  camden: ["Hampstead Cemetery", "Highgate Cemetery"],
  haringey: ["Tottenham Cemetery", "Wood Green Cemetery"],
};

assert.deepEqual(areaData.boroughs.map((borough) => borough.slug), Object.keys(EXPECTED));
for (const borough of areaData.boroughs) {
  assert.deepEqual(borough.cemeteries.map((cemetery) => cemetery.name), EXPECTED[borough.slug], borough.slug);
  for (const cemetery of borough.cemeteries) {
    assert.match(cemetery.source, /^https:\/\//, cemetery.name);
    for (const field of ["operator", "postcode", "new_burials"]) {
      if (cemetery[field] != null) assert.notEqual(visibleField(cemetery[field]), "", cemetery.name);
    }
  }
}
assert.equal(visibleField(""), "");
assert.equal(visibleField("  Not checked "), "");
assert.equal(visibleField("Not stated"), "");
assert.equal(visibleField("CMG"), "CMG");

const shell = readFileSync(new URL("../about.html", import.meta.url), "utf8");
const env = { ASSETS: { fetch: async () => new Response(shell, { status: 200 }) } };

function article(html, name) {
  const heading = `<h2>${name.replace(/&/g, "&amp;")}</h2>`;
  const start = html.indexOf(heading);
  assert.ok(start > 0, name);
  const open = html.lastIndexOf("<article", start);
  const close = html.indexOf("</article>", start);
  assert.ok(open >= 0 && close > start, name);
  return html.slice(open, close + "</article>".length);
}

function mainOf(html) {
  const match = html.match(/<main class="content area-page">([\s\S]*?)<\/main>/);
  assert.ok(match);
  return match[1];
}

function jsonLd(html) {
  return [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((match) => JSON.parse(match[1]));
}

const titles = new Set();
const pages = [];

let response = await onRequest({
  request: new Request("https://searsmelvin.co.uk/areas"),
  env,
});
assert.equal(response.status, 200);
let html = await response.text();
pages.push(["/areas", html]);

for (const borough of areaData.boroughs) {
  response = await onRequest({
    request: new Request(`https://searsmelvin.co.uk/areas/${borough.slug}`),
    env,
  });
  assert.equal(response.status, 200, borough.slug);
  pages.push([`/areas/${borough.slug}`, await response.text()]);
}

assert.deepEqual(areaPaths(), pages.map(([path]) => path));

for (const [path, page] of pages) {
  const title = page.match(/<title>([^<]*)<\/title>/)[1];
  titles.add(title);
  assert.equal(title.includes("About"), false, path);
  assert.match(page, new RegExp(`<link rel="canonical" href="https://searsmelvin\\.co\\.uk${path}">`));
  assert.match(page, /GTM-KRDX4BQ5/);
  assert.match(page, /ad_storage:\s+'denied'/);
  assert.match(page, /registerBeforeSubmit\(chatSubmitted\)/);
  assert.match(page, /020 3835 2548/);
  assert.equal(page.includes("NAMM"), false, path);
  assert.equal(page.includes("North London"), false, path);
  assert.equal(page.includes("UK-wide"), false, path);
  assert.doesNotMatch(page, /How much does a headstone cost|cemetery permit fee/);
  assert.doesNotMatch(mainOf(page), /£|\\u00a3/);
  const blocks = jsonLd(page);
  const business = blocks.filter((block) => block["@type"] === "Stonemason" || block["@type"] === "LocalBusiness");
  assert.equal(business.length, 1, path);
  assert.equal(business[0]["@type"], "Stonemason");
  assert.equal(business[0].address.postalCode, "NW11 6LB");
  assert.equal(business[0].address.addressLocality, "London");
  assert.equal(business[0].geo.latitude, 51.58619);
  assert.equal(JSON.stringify(business[0]).includes("NAMM"), false);
  const crumbs = blocks.filter((block) => block["@type"] === "BreadcrumbList");
  assert.equal(crumbs.length, 1, path);
  assert.equal(crumbs[0].itemListElement[0].name, "Home");
  assert.equal(crumbs[0].itemListElement[1].item, "https://searsmelvin.co.uk/areas");
  const main = mainOf(page);
  assert.equal((main.match(/£/g) || []).length, 0, path);
  assert.doesNotMatch(main, /\bfee\b/i, path);
  assert.equal((main.match(/Most cemeteries need a permit before a memorial is placed\. We handle the application with the cemetery for you\./g) || []).length, 1);
  assert.match(main, /Our Finchley showroom \(NW11 6LB\) serves families across London\./);
  assert.match(main, /href="\/memorials\/type\/lawn-headstones"/);
  assert.match(main, /href="\/memorials\/type\/kerb-sets"/);
  assert.match(main, /href="\/memorials\/type\/heart-memorials"/);
  assert.match(main, /href="\/memorials\/type\/cremation-memorials"/);
  assert.equal((main.match(/href="\/memorials\/type\//g) || []).length, 4, path);
  assert.doesNotMatch(main, /href="\/memorials\/(?!type\/)/);
  assert.match(main, /class="sm-btn sm-btn-primary">Request a quote<\/a>/);
  assert.match(main, /<a href="tel:\+442038352548" class="sm-btn sm-btn-secondary">020 3835 2548<\/a>/);
  assert.match(main, /class="sm-btn sm-btn-secondary">Visit the showroom<\/a>/);
  assert.match(main, /Official sites checked 16 November 2026\./);
  const description = page.match(/<meta name="description" content="([^"]*)"/)[1];
  assert.equal(description.includes("£"), false, path);
  assert.doesNotMatch(page, /href="\/about" class="active"/);
}

assert.equal(titles.size, pages.length);

const hub = pages[0][1];
assert.match(hub, /<h1>Memorials for cemeteries in London<\/h1>/);
assert.match(hub, /<title>Cemeteries in London \| Sears Melvin<\/title>/);
for (const borough of areaData.boroughs) {
  assert.match(hub, new RegExp(`href="/areas/${borough.slug}"`));
}
const hubCrumbs = jsonLd(hub).find((block) => block["@type"] === "BreadcrumbList");
assert.equal(hubCrumbs.itemListElement.length, 2);
assert.equal(hubCrumbs.itemListElement[1].name, "Cemeteries");

const shared = businessJsonLd();
assert.equal(shared.address.postalCode, "NW11 6LB");

for (const [path, page] of pages.slice(1)) {
  const slug = path.split("/").pop();
  const borough = areaData.boroughs.find((item) => item.slug === slug);
  assert.match(page, new RegExp(`<h1>Memorials for cemeteries in ${borough.name}</h1>`));
  assert.match(page, new RegExp(`<title>Memorials for cemeteries in ${borough.name} \\| Sears Melvin</title>`));
  const crumbs = jsonLd(page).find((block) => block["@type"] === "BreadcrumbList");
  assert.equal(crumbs.itemListElement.length, 3);
  assert.equal(crumbs.itemListElement[2].name, borough.name);
  assert.equal(crumbs.itemListElement[2].item, `https://searsmelvin.co.uk/areas/${slug}`);
  assert.equal((page.match(/<article class="area-cemetery">/g) || []).length, borough.cemeteries.length);
  const main = mainOf(page);
  assert.match(main, new RegExp(`The cemeteries listed here are in ${borough.name}\\.`));
  if (slug === "harrow") {
    assert.match(main, /Harrow Council currently reports no new plots for full coffin burials in its cemeteries\./);
  } else {
    assert.doesNotMatch(main, /no new plots/);
  }
}

const barnet = pages.find(([path]) => path === "/areas/barnet")[1];
const finchley = article(barnet, "East Finchley Cemetery");
assert.match(finchley, /Postcode: N2 0RZ/);
assert.match(finchley, /Operator: City of Westminster/);
assert.match(finchley, /New burials: Open, limited graves for sale/);
assert.match(finchley, /href="https:\/\/www\.westminster\.gov\.uk\/leisure-libraries-and-community\/cemeteries-and-bereavement\/east-finchley-cemetery"/);
assert.match(finchley, /google\.com\/maps\/search\/\?api=1&amp;query=East%20Finchley%20Cemetery%2C%20N2%200RZ/);
assert.doesNotMatch(article(barnet, "Hendon Cemetery & Crematorium"), /accredit|NAMM|BRAMM|RQMF|new burials/i);
assert.doesNotMatch(article(barnet, "Edgwarebury Cemetery"), /New burials/);

const enfield = pages.find(([path]) => path === "/areas/enfield")[1];
const enfieldCemetery = article(enfield, "Enfield Cemetery");
assert.match(enfieldCemetery, /Operator: CMG</);
assert.doesNotMatch(enfieldCemetery, /Commonwealth|Management Group|The CMG/);
assert.match(enfieldCemetery, /New burials: Open, lawn and traditional graves/);
const tottenhamPark = article(enfield, "Tottenham Park Cemetery");
assert.doesNotMatch(tottenhamPark, /Postcode:|Operator:/);
assert.match(tottenhamPark, /href="https:\/\/www\.tottenhamparkcemetery\.co\.uk\/"/);
assert.match(tottenhamPark, /Tottenham%20Park%20Cemetery%2C%20Enfield%2C%20London/);
assert.doesNotMatch(article(enfield, "Lavender Hill Cemetery"), /New burials/);
assert.match(article(enfield, "Trent Park Cemetery"), /New burials: Lawn-style cemetery with flat plaques/);

const haringey = pages.find(([path]) => path === "/areas/haringey")[1];
for (const name of ["Tottenham Cemetery", "Wood Green Cemetery"]) {
  const block = article(haringey, name);
  assert.doesNotMatch(block, /Postcode:/);
  assert.match(block, /Operator: Burials provided by Dignity Funerals \(per Haringey Council\)/);
  assert.match(block, new RegExp(`${encodeURIComponent(name + ", Haringey, London").replace(/%20/g, "%20")}`));
}

const camden = pages.find(([path]) => path === "/areas/camden")[1];
assert.match(article(camden, "Highgate Cemetery"), /Postcode: N6/);
assert.doesNotMatch(article(camden, "Highgate Cemetery"), /New burials/);
assert.match(article(camden, "Hampstead Cemetery"), /New burials: Closed to new graves except pre-purchased/);

const brent = pages.find(([path]) => path === "/areas/brent")[1];
assert.match(article(brent, "Carpenders Park Lawn Cemetery"), /Operator: Brent Council \(jointly owned with Harrow\)/);

assert.deepEqual(resolveAreaPath("/areas/"), { redirect: "/areas" });
assert.deepEqual(resolveAreaPath("/areas/Barnet"), { redirect: "/areas/barnet" });
assert.deepEqual(resolveAreaPath("/areas/barnet/"), { redirect: "/areas/barnet" });
assert.deepEqual(resolveAreaPath("/areas/barnet.html"), { redirect: "/areas/barnet" });
assert.equal(resolveAreaPath("/areas/barnet/extra").redirect, "/memorials");
assert.equal(resolveAreaPath("/areas/islington").redirect, "/memorials");

response = await onRequest({
  request: new Request("https://searsmelvin.co.uk/areas/islington?utm_source=old"),
  env,
});
assert.equal(response.status, 301);
assert.equal(response.headers.get("Location"), "/memorials?utm_source=old");

response = await onRequest({
  request: new Request("https://searsmelvin.co.uk/areas/barnet/"),
  env,
});
assert.equal(response.status, 301);
assert.equal(response.headers.get("Location"), "/areas/barnet");

response = await onRequest({
  request: new Request("https://searsmelvin.co.uk/areas/barnet", { method: "POST" }),
  env,
});
assert.equal(response.status, 405);

response = await onRequest({
  request: new Request("https://searsmelvin.co.uk/areas/barnet", { method: "HEAD" }),
  env,
});
assert.equal(response.status, 200);
assert.equal(await response.text(), "");

response = await onRequest({
  request: new Request("https://searsmelvin.co.uk/areas"),
  env: { ASSETS: { fetch: async () => new Response("no", { status: 500 }) } },
});
assert.equal(response.status, 503);

response = await onRequest({
  request: new Request("https://searsmelvin.co.uk/areas/barnet"),
  env: { ASSETS: { fetch: async () => new Response("<html><head></head><body></body></html>", { status: 200 }) } },
});
assert.equal(response.status, 503);

assert.throws(() => renderAreaPage("<html></html>", { kind: "hub" }));

const routes = JSON.parse(readFileSync(new URL("../_routes.json", import.meta.url), "utf8"));
assert.ok(routes.include.includes("/areas"));
assert.ok(routes.include.includes("/areas/*"));
const redirects = readFileSync(new URL("../_redirects", import.meta.url), "utf8");
assert.match(redirects, /^\/areas\.html\s+\/areas\s+301/m);
assert.doesNotMatch(redirects, /^\/areas\/\*/m);

console.log("area-pages: ok");
