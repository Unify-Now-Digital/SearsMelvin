// WhatsApp entry points: deep links, opt-in line, and the dataLayer click event.
// Tracking contract (docs/TRACKING.md) still owns GTM, consent, gclid and tel:.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const up = require("../site-upgrades.js");
const read = (f) => readFileSync(f, "utf8");

const LINKS = {
  brochure: "https://wa.me/message/SDK7YQSPTKCYP1",
  general: "https://wa.me/message/U6K6IFOOIBTBI1",
  order: "https://wa.me/message/Z5IMTOPYY43SP1",
  permit: "https://wa.me/message/LI6YUEJF3PN4G1",
};
const OPT_IN = "If you give a phone number, you agree we may send updates about your enquiry or order by WhatsApp, SMS or email. Reply STOP at any time.";
const LABEL = "Message us on WhatsApp";

function anchors(html) {
  return [...html.matchAll(/<a\b[^>]*class="[^"]*\bsm-whatsapp\b[^"]*"[^>]*>[\s\S]*?<\/a>/g)].map((m) => m[0]);
}
function attr(tag, name) {
  const m = tag.match(new RegExp(name + '="([^"]*)"'));
  return m ? m[1] : "";
}

assert.deepEqual(up.whatsappClickEvent("footer"), { event: "whatsapp_click", location: "footer" });
assert.deepEqual(up.whatsappClickEvent(" Contact "), { event: "whatsapp_click", location: "contact" });
assert.deepEqual(up.whatsappClickEvent("phone"), { event: "whatsapp_click", location: "unknown" });
assert.deepEqual(up.whatsappClickEvent(""), { event: "whatsapp_click", location: "unknown" });
for (const loc of ["contact", "footer", "brochure", "home", "listing", "order", "permit"]) {
  const ev = up.whatsappClickEvent(loc);
  assert.equal(ev.event, "whatsapp_click");
  assert.equal(ev.location, loc);
  assert.equal(JSON.stringify(ev).includes("email"), false);
}

const upgrades = read("site-upgrades.js");
assert.match(upgrades, /a\[data-wa-location\]/);
assert.match(upgrades, /dataLayer\.push\(whatsappClickEvent\(/);
assert.match(upgrades, /CLICK_KEYS = \['gclid', 'gbraid', 'wbraid'\]/);
assert.match(upgrades, /event: 'brochure_download'/);
assert.doesNotMatch(upgrades, /whatsappClickEvent[\s\S]{0,400}clickIntent\('call'\)/);

const expect = [
  ["contact.html", "contact", LINKS.general],
  ["brochure.html", "brochure", LINKS.brochure],
  ["index.html", "home", LINKS.brochure],
  ["memorials.html", "listing", LINKS.brochure],
  ["faq.html", "permit", LINKS.permit],
  ["track.html", "order", LINKS.order],
];
for (const [file, location, href] of expect) {
  const html = read(file);
  const found = anchors(html).filter((a) => attr(a, "data-wa-location") === location);
  assert.ok(found.length >= 1, `${file}: missing WhatsApp link for ${location}`);
  for (const a of found) {
    assert.equal(attr(a, "href"), href, `${file} ${location} href`);
    assert.equal(attr(a, "target"), "_blank", `${file} ${location} target`);
    assert.match(attr(a, "rel"), /\bnoopener\b/, `${file} ${location} rel`);
    assert.match(a, new RegExp(LABEL.replace(/ /g, "\\s+")));
    assert.doesNotMatch(a, /href="tel:/);
    assert.doesNotMatch(a, /utm_/);
  }
}

const footerPages = execSync("git ls-files '*.html'").toString().split("\n").filter((f) => f && read(f).includes('class="footer-contact"'));
assert.ok(footerPages.length >= 12, "expected the public footers");
for (const file of footerPages) {
  const html = read(file);
  const footer = html.slice(html.indexOf('class="footer-contact"'), html.indexOf('class="footer-links"'));
  const found = anchors(footer).filter((a) => attr(a, "data-wa-location") === "footer");
  assert.equal(found.length, 1, `${file}: footer WhatsApp link`);
  assert.equal(attr(found[0], "href"), LINKS.general, `${file} footer href`);
  assert.equal(attr(found[0], "target"), "_blank");
  assert.match(attr(found[0], "rel"), /\bnoopener\b/);
  assert.match(footer, /href="tel:\+442038352548"/);
}

for (const file of ["contact.html", "memorial.html", "memorials.html", "index.html"]) {
  assert.ok(read(file).includes(OPT_IN), `${file}: phone-number update line missing`);
}

const privacy = read("privacy.html");
const policy = privacy.slice(privacy.indexOf("<main"), privacy.indexOf("</main>"));
assert.doesNotMatch(policy, /WhatsApp/, "privacy policy body must not be rewritten in this change");
assert.match(policy, /optional marketing communications/);
assert.match(policy, /Follow up on your order or project/);

const contact = read("contact.html");
assert.match(contact, /event: 'sm_lead_submit'/);
assert.match(contact, /GTM-KRDX4BQ5/);
assert.match(contact, /ad_storage:\s*'denied'/);
assert.match(contact, /No payment required/);

console.log("whatsapp: ok");
