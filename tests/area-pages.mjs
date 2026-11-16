import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import areaData from "../data/boroughs.json" with { type: "json" };
import { onRequest } from "../functions/areas/[[path]].js";
import {
  areaPaths,
  formatMiles,
  milesBetween,
  resolveAreaPath,
  visibleField,
} from "../functions/_area-pages.js";

const shell = readFileSync(new URL("../about.html", import.meta.url), "utf8");
const env = { ASSETS: { fetch: async () => new Response(shell, { status: 200 }) } };
const image = "https://bfwohzcugtwbhhxdqgme.supabase.co/storage/v1/object/public/product-images/the-hartwell.jpg";

function mainOf(html) {
  const match = html.match(/<main class="area-page">([\s\S]*?)<\/main>/);
  assert.ok(match);
  return match[1];
}

function jsonLd(html) {
  return [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((match) => JSON.parse(match[1]));
}

assert.equal(visibleField("Not checked"), "");
assert.equal(visibleField("Not stated"), "");
assert.equal(areaData.showroom.postcode, "NW11 6LB");
assert.equal(areaData.showroom.latitude, 51.58619);
assert.equal(areaData.showroom.longitude, -0.18362);
assert.equal(areaData.showroom.hours, "Monday to Friday, 10am to 3pm");
assert.equal(areaData.showroom.address, "1 The Market Place, Falloden Way, NW11 6LB");

const slugs = [];
for (const borough of areaData.boroughs) {
  for (const cemetery of borough.cemeteries) {
    slugs.push(cemetery.slug);
    if (cemetery.postcode === "HA2 0JM" || !cemetery.postcode) {
      assert.equal(cemetery.latitude, undefined, cemetery.name);
    }
  }
}
assert.equal(new Set(slugs).size, slugs.length);
assert.equal(slugs.length, 32);
const finchley = areaData.boroughs[0].cemeteries[0];
assert.equal(finchley.slug, "east-finchley-cemetery");
assert.equal(finchley.latitude, 51.59219);
const highgate = areaData.boroughs.find((item) => item.slug === "camden").cemeteries.find((item) => item.name.startsWith("Highgate"));
assert.equal(highgate.postcode, "N6");
assert.equal(typeof highgate.latitude, "number");
const hertford = areaData.boroughs.find((item) => item.slug === "enfield").cemeteries.find((item) => item.name.startsWith("Hertford"));
assert.equal(typeof hertford.latitude, "number");
const miles = milesBetween(areaData.showroom, finchley);
assert.match(formatMiles(miles), /^From showroom: \d+\.\d miles, straight line$/);

globalThis.fetch = async () => Response.json([
  { name: "The Hartwell", slug: "the-hartwell", image_url: image, product_categories: { name: "Lawn headstones", slug: "lawn-headstones" } },
  { name: "No image", slug: "no-image", image_url: "", product_categories: { name: "Kerb sets", slug: "kerb-sets" } },
]);

const pages = [];
for (const path of ["/areas", "/areas/barnet", "/areas/barnet/east-finchley-cemetery", "/areas/harrow", "/areas/enfield/enfield-cemetery", "/areas/enfield/tottenham-park-cemetery", "/areas/harrow/roxeth-hill-burial-ground", "/areas/camden/highgate-cemetery", "/areas/haringey/tottenham-cemetery"]) {
  const response = await onRequest({ request: new Request(`https://searsmelvin.co.uk${path}`), env });
  assert.equal(response.status, 200, path);
  pages.push([path, await response.text()]);
}

assert.ok(areaPaths().includes("/areas/barnet/east-finchley-cemetery"));
assert.equal(areaPaths().length, 1 + 6 + 32);

for (const [path, page] of pages) {
  const main = mainOf(page);
  assert.equal(page.includes("North London"), false, path);
  assert.equal(page.includes("NAMM"), false, path);
  assert.equal(page.includes("UK-wide"), false, path);
  assert.doesNotMatch(main, /£|fee|\/memorials\/type\//i, path);
  assert.match(page, new RegExp(`<link rel="canonical" href="https://searsmelvin\\.co\\.uk${path}">`));
  assert.match(page, /GTM-KRDX4BQ5/);
  assert.match(page, /ad_storage:\s+'denied'/);
  assert.match(page, /registerBeforeSubmit\(chatSubmitted\)/);
  assert.match(main, /<a href="tel:\+442038352548">020 3835 2548<\/a>/);
  assert.match(main, /Request a quote/);
  assert.match(main, /1 The Market Place, Falloden Way, NW11 6LB/);
  assert.match(main, /Monday to Friday, 10am to 3pm/);
  assert.match(main, /Illustrative positions, not a street map/);
  assert.match(main, /RQMF Registered No\. 2263/);
  const business = jsonLd(page).filter((block) => block["@type"] === "Stonemason" || block["@type"] === "LocalBusiness");
  assert.equal(business.length, 1, path);
  assert.equal(business[0].address.postalCode, "NW11 6LB");
  const crumbs = jsonLd(page).find((block) => block["@type"] === "BreadcrumbList");
  assert.equal(crumbs.itemListElement[0].name, "Home");
  assert.equal(crumbs.itemListElement[1].name, "Areas");
  assert.equal(crumbs.itemListElement[1].item, "https://searsmelvin.co.uk/areas");
}

const hub = pages.find(([path]) => path === "/areas")[1];
assert.match(hub, /<h1>Memorials for cemeteries in London<\/h1>/);
assert.match(mainOf(hub), /href="\/areas\/barnet"/);
assert.equal(jsonLd(hub).find((block) => block["@type"] === "BreadcrumbList").itemListElement.length, 2);

const barnet = pages.find(([path]) => path === "/areas/barnet")[1];
const barnetMain = mainOf(barnet);
assert.match(barnet, /<h1>Memorials for cemeteries in Barnet<\/h1>/);
assert.match(barnetMain, /Cemeteries in Barnet/);
assert.match(barnetMain, /href="\/areas\/barnet\/east-finchley-cemetery"/);
assert.match(barnetMain, /From showroom: \d+\.\d miles, straight line/);
assert.match(barnetMain, /How a memorial gets placed/);
assert.match(barnetMain, /Choose the design/);
assert.match(barnetMain, /We apply for the permit/);
assert.match(barnetMain, /Common questions/);
assert.match(barnetMain, /It depends on the cemetery\./);
assert.match(barnetMain, /Some of our memorials/);
assert.match(barnetMain, /href="\/memorials\/the-hartwell"/);
assert.match(barnetMain, /href="\/memorials">See all memorials/);
assert.doesNotMatch(barnetMain, /No image/);
assert.match(barnetMain, /Other areas/);
assert.doesNotMatch(barnetMain, /Hendon Cemetery &amp; Crematorium[\s\S]{0,400}accredit/i);
assert.equal(jsonLd(barnet).find((block) => block["@type"] === "BreadcrumbList").itemListElement.length, 3);

const east = pages.find(([path]) => path === "/areas/barnet/east-finchley-cemetery")[1];
const eastMain = mainOf(east);
assert.match(east, /<h1>Memorials for East Finchley Cemetery<\/h1>/);
assert.match(eastMain, /operated by City of Westminster/);
assert.match(eastMain, /straight-line distance from our Finchley showroom/);
assert.match(eastMain, /Open in Google Maps/);
assert.match(eastMain, /<th scope="row">Operator<\/th><td>City of Westminster<\/td>/);
assert.match(eastMain, /<th scope="row">Postcode<\/th><td>N2 0RZ<\/td>/);
assert.match(eastMain, /<th scope="row">New burials<\/th><td>Open, limited graves for sale<\/td>/);
assert.match(eastMain, /<th scope="row">Checked<\/th><td>16 November 2026<\/td>/);
assert.match(eastMain, /How a memorial gets placed here/);
assert.match(eastMain, /Other cemeteries nearby/);
const eastCrumbs = jsonLd(east).find((block) => block["@type"] === "BreadcrumbList");
assert.deepEqual(eastCrumbs.itemListElement.map((item) => item.name), ["Home", "Areas", "Barnet", "East Finchley Cemetery"]);
assert.equal(eastCrumbs.itemListElement[3].item, "https://searsmelvin.co.uk/areas/barnet/east-finchley-cemetery");

const harrow = mainOf(pages.find(([path]) => path === "/areas/harrow")[1]);
assert.match(harrow, /Harrow Council currently reports no new plots for full coffin burials in its cemeteries\./);
const roxeth = mainOf(pages.find(([path]) => path === "/areas/harrow/roxeth-hill-burial-ground")[1]);
assert.match(roxeth, /Postcode: HA2 0JM|HA2 0JM/);
assert.doesNotMatch(roxeth, /From showroom:/);
assert.doesNotMatch(roxeth, /straight-line distance/);

const cmg = mainOf(pages.find(([path]) => path === "/areas/enfield/enfield-cemetery")[1]);
assert.match(cmg, /operated by CMG/);
assert.doesNotMatch(cmg, /Commonwealth|Management Group/);

const park = mainOf(pages.find(([path]) => path === "/areas/enfield/tottenham-park-cemetery")[1]);
assert.doesNotMatch(park, /Operator:/);
assert.doesNotMatch(park, /Postcode:/);
assert.match(park, /href="https:\/\/www\.tottenhamparkcemetery\.co\.uk\/"/);

const tottenham = mainOf(pages.find(([path]) => path === "/areas/haringey/tottenham-cemetery")[1]);
assert.match(tottenham, /Burials provided by Dignity Funerals \(per Haringey Council\)/);
assert.doesNotMatch(tottenham, /Postcode:/);

assert.equal(resolveAreaPath("/areas/barnet/").redirect, "/areas/barnet");
assert.equal(resolveAreaPath("/areas/no-such").redirect, "/memorials");
assert.equal(resolveAreaPath("/areas/barnet/no-such").redirect, "/memorials");
assert.equal(resolveAreaPath("/areas/barnet/east-finchley-cemetery/extra").redirect, "/memorials");

let response = await onRequest({
  request: new Request("https://searsmelvin.co.uk/areas/islington?utm_source=old"),
  env,
});
assert.equal(response.status, 301);
assert.equal(response.headers.get("Location"), "/memorials?utm_source=old");

console.log("area-pages: ok");
