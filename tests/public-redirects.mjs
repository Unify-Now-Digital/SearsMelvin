import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { onRequest as internal } from "../functions/_internal-paths.js";
import { onRequest as memorial } from "../functions/memorial.js";
import { PAGE_LASTMOD } from "../functions/_page-lastmod.js";

const redirects = readFileSync(new URL("../_redirects", import.meta.url), "utf8");
assert.match(redirects, /^\/index\.html\s+\/\s+301/m);
assert.match(redirects, /^\/areas\/\*\s+\/memorials\s+301/m);
assert.doesNotMatch(redirects, /^\/areas\/\*\s+\/\s+301/m);

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
  if (file === "index.html") {
    assert.equal(html.includes("North London"), false, `${file} keeps North London off the home page`);
    assert.doesNotMatch(html, /<title>[^<]*North London/);
    assert.doesNotMatch(html, /<meta name="description" content="[^"]*North London/);
    assert.doesNotMatch(html, /<meta property="og:description" content="[^"]*North London/);
    assert.doesNotMatch(html, /<meta name="twitter:description" content="[^"]*North London/);
  } else {
    assert.equal(html.includes("North London"), true, `${file} should restore North London`);
  }
  for (const borough of ["Barnet", "Camden", "Brent", "Haringey", "Enfield"]) {
    assert.ok(html.includes(`"name": "${borough}"`), `${file} areaServed missing ${borough}`);
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
assert.match(home, /share-card\.jpg/);
assert.match(home, /href="\/favicon\.ico" sizes="48x48"/);
assert.match(home, /href="\/favicon-48\.png"/);
assert.match(home, /href="\/favicon\.svg"/);
assert.match(home, /"logo": "https:\/\/searsmelvin\.co\.uk\/images\/brand\/logo\/favicon\/icon-512\.png"/);

const slots = [...home.matchAll(/<option value="(\d{2}:\d{2})"/g)].map((match) => match[1]);
assert.deepEqual(slots, ["10:00", "10:30", "11:00", "11:30", "12:00", "13:00", "13:30", "14:00", "14:30"]);
assert.doesNotMatch(home, /value="09:00"|value="09:30"|value="15:00"|value="15:30"|value="16:00"|value="16:30"/);
assert.match(home, /apptDateIsWeekday/);

const aboutMeta = readFileSync(new URL("../about.html", import.meta.url), "utf8");
assert.match(aboutMeta, /memorial masons in North London/);
const contactPage = readFileSync(new URL("../contact.html", import.meta.url), "utf8");
assert.match(contactPage, /Monday to Friday, 10am to 3pm/);
assert.doesNotMatch(contactPage, /9am–5pm|Sat by appointment|9:00 AM/);
const about = readFileSync(new URL("../about.html", import.meta.url), "utf8");
assert.match(about, /North London memorial masons/);
assert.match(about, /is a North London memorial mason/);
assert.doesNotMatch(about, /by appointment/);

console.log("public-redirects: ok");
