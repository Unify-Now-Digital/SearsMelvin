import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { onRequest as internal } from "../functions/_internal-paths.js";
import { onRequest as memorial } from "../functions/memorial.js";
import { PAGE_LASTMOD } from "../functions/_page-lastmod.js";

const redirects = readFileSync(new URL("../_redirects", import.meta.url), "utf8");
assert.match(redirects, /^\/index\.html\s+\/\s+301/m);
assert.match(redirects, /^\/areas\.html\s+\/areas\s+301/m);
assert.doesNotMatch(redirects, /^\/areas\s+\/memorials\s+301/m);
assert.doesNotMatch(redirects, /^\/areas\/\s+\/memorials\s+301/m);
assert.doesNotMatch(redirects, /^\/areas\/\*\s+\/memorials\s+301/m);

// Typed quote URLs go straight to /contact. /contact/ is a separate 308,
// so the target must be the slash-free path or the browser takes two hops.
for (const source of ["/request-a-quote", "/request-a-quote/", "/request-quote", "/request-quote/"]) {
  const escaped = source.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  assert.match(redirects, new RegExp(`^${escaped}\\s+/contact\\s+301\\s*$`, "m"), source);
}

const robots = readFileSync(new URL("../robots.txt", import.meta.url), "utf8");
assert.match(robots, /^Disallow: \/rest\/$/m);
assert.match(robots, /^Disallow: \/storage\/$/m);

let response = await internal({
  request: new Request("https://www.searsmelvin.co.uk/memorials/the-hartwell?gclid=abc"),
  async next() { throw new Error("www should redirect before next"); },
});
assert.equal(response.status, 301);
assert.equal(response.headers.get("Location"), "https://searsmelvin.co.uk/memorials/the-hartwell?gclid=abc");

response = await memorial({
  request: new Request("https://searsmelvin.co.uk/memorial.html?slug=the-hartwell&gclid=abc&utm_source=brochure"),
  async next() { throw new Error("legacy slug should redirect"); },
});
assert.equal(response.status, 301);
assert.equal(response.headers.get("Location"), "/memorials/the-hartwell?gclid=abc&utm_source=brochure");

response = await memorial({
  request: new Request("https://searsmelvin.co.uk/memorial?slug=../admin"),
  async next() { throw new Error("unsafe slug should redirect"); },
});
assert.equal(response.status, 301);
assert.equal(response.headers.get("Location"), "/memorials");

let nextCalled = false;
response = await memorial({
  request: new Request("https://searsmelvin.co.uk/memorial"),
  async next() { nextCalled = true; return new Response("shell", { status: 200 }); },
});
assert.equal(nextCalled, true);
assert.equal(response.status, 200);

const sitemap = readFileSync(new URL("../functions/sitemap.xml.js", import.meta.url), "utf8");
assert.equal(sitemap.includes("todayIso"), false);
assert.equal(sitemap.includes("new Date("), false);
for (const [path, date] of Object.entries(PAGE_LASTMOD)) {
  assert.match(date, /^\d{4}-\d{2}-\d{2}$/, path);
}

const pages = ["index.html", "about.html", "brochure.html", "contact.html", "faq.html", "memorials.html", "memorial.html"];
for (const file of pages) {
  const html = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
  for (const href of ["/about", "/brochure", "/contact", "/faq"]) {
    assert.ok(html.includes(`href="${href}"`), `${file} missing ${href}`);
  }
  const footer = html.slice(html.indexOf('class="footer-links"'));
  for (const href of ["/about", "/brochure", "/contact", "/faq"]) {
    assert.ok(footer.includes(`href="${href}"`), `${file} footer missing ${href}`);
  }
  assert.equal(html.includes("North London"), false, `${file} still says North London`);
  assert.equal(html.includes("UK-wide"), false, `${file} still says UK-wide`);
  assert.ok(html.includes("Greater London and surrounds"), `${file} missing Greater London and surrounds`);
  assert.doesNotMatch(html, /<title>[^<]*North London/);
  assert.doesNotMatch(html, /<meta name="description" content="[^"]*North London/);
  assert.doesNotMatch(html, /<meta property="og:description" content="[^"]*North London/);
  assert.doesNotMatch(html, /<meta name="twitter:description" content="[^"]*North London/);
  for (const area of ["Greater London", "Hertfordshire", "Essex", "Kent", "Surrey", "Buckinghamshire", "Berkshire"]) {
    assert.ok(html.includes(`"name": "${area}"`), `${file} areaServed missing ${area}`);
  }
  for (const borough of ["Barnet", "Camden", "Brent", "Haringey", "Enfield"]) {
    assert.equal(html.includes(`"name": "${borough}"`), false, `${file} still serves ${borough}`);
  }
  assert.match(html, /"opens": "10:00"/, `${file} opening hours`);
  assert.match(html, /"closes": "15:00"/, `${file} opening hours`);
  assert.doesNotMatch(html, /"opens": "09:00"/);
  assert.doesNotMatch(html, /"closes": "17:00"/);
}

const home = readFileSync(new URL("../index.html", import.meta.url), "utf8");
assert.match(home, /<span>£3,250<\/span>/);
assert.match(home, /Fully Installed/);
assert.match(home, /rel="preload" as="image"/);
assert.match(home, /gioiosa-family-kerb-set-600w\.webp/);
assert.match(home, /<link rel="preload" as="image"[\s\S]*?gioiosa-family-kerb-set-600w\.webp/);
assert.doesNotMatch(home, /rel="preload"[^>]*smith-family-memorial/);
assert.match(home, /src="\/home\.js\?v=20261127f" defer/);
assert.match(readFileSync(new URL("../home.js", import.meta.url), "utf8"), /loading="lazy" fetchpriority="low"/);
assert.match(home, /share-card\.jpg/);
assert.match(home, /href="\/favicon\.ico" sizes="48x48"/);
assert.match(home, /href="\/favicon-48\.png"/);
assert.match(home, /href="\/favicon\.svg"/);
assert.match(home, /"logo": "https:\/\/searsmelvin\.co\.uk\/images\/brand\/logo\/favicon\/icon-512\.png"/);

const slots = [...home.matchAll(/<option value="(\d{2}:\d{2})"/g)].map((match) => match[1]);
assert.deepEqual(slots, ["10:00", "10:30", "11:00", "11:30", "12:00", "13:00", "13:30", "14:00", "14:30"]);
assert.doesNotMatch(home, /value="09:00"|value="09:30"|value="15:00"|value="15:30"|value="16:00"|value="16:30"/);
assert.match(readFileSync(new URL("../home.js", import.meta.url), "utf8"), /apptDateIsWeekday/);

const aboutMeta = readFileSync(new URL("../about.html", import.meta.url), "utf8");
assert.match(aboutMeta, /memorial masons in London/);
assert.doesNotMatch(aboutMeta, /North London/);
const contactPage = readFileSync(new URL("../contact.html", import.meta.url), "utf8");
assert.match(contactPage, /Monday to Friday, 10am to 3pm/);
assert.doesNotMatch(contactPage, /9am–5pm|Sat by appointment|9:00 AM/);
const about = readFileSync(new URL("../about.html", import.meta.url), "utf8");
assert.match(about, /London memorial masons/);
assert.match(about, /is a London memorial mason/);
assert.doesNotMatch(about, /North London/);
assert.doesNotMatch(about, /by appointment/);

console.log("public-redirects: ok");
