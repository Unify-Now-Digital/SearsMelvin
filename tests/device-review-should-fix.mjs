// 20 Nov device review, should-fix. Source checks for the layout and
// performance rules that are easy to undo.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const read = (name) => readFileSync(new URL(`../${name}`, import.meta.url), "utf8");
const index = read("index.html");
const upgrades = read("site-upgrades.css");
const memorial = read("memorial.css") + "\n" + read("memorial.html");
const track = read("track.html");
const contact = read("contact.html");
const memorials = read("memorials.html");

assert.match(index, /\.hero-visual\s*\{[^}]*animation:\s*none/);
assert.match(index, /gioiosa-family-kerb-set-480w\.webp 480w/);
assert.match(index, /sizes="\(max-width: 768px\) 260px, \(max-width: 1024px\) 400px, 640px"/);
assert.ok(existsSync(new URL("../images/installed/gioiosa-family-kerb-set-480w.webp", import.meta.url)));

assert.match(memorial, /matchMedia\('\(max-width: 599px\)'\)/);
assert.match(memorial, /@media \(max-width: 768px\) \{[\s\S]*?\.product-info \{ display: contents; \}/);
assert.match(upgrades, /@media \(max-width: 900px\) and \(min-width: 769px\)/);
assert.doesNotMatch(upgrades, /@media \(max-width: 900px\) and \(min-width: 600px\)/);
assert.match(upgrades, /html body \.sm-brochure-link \{[^}]*text-transform:\s*none/);
assert.match(upgrades, /white-space:\s*nowrap/);
assert.match(upgrades, /grid-template-columns:\s*1fr 1fr 1\.1fr 1fr auto/);

assert.match(track, /sears-melvin-stacked-ink\.svg/);
assert.match(track, /sears-melvin-stacked-ink-no-rules\.svg/);
assert.match(track, /\.track-header \{[^}]*background:\s*var\(--sm-color-bg\)/);
assert.match(track, /Send my portal link/);
assert.doesNotMatch(track, /Sears Melvin <span>Memorials<\/span>/);

assert.match(contact, /id="contactName"/);
assert.match(contact, /name="name"/);
assert.match(contact, /autocomplete="name"/);
assert.match(contact, /maxlength="120"/);
assert.match(contact, /placeholder="Your name"/);
assert.match(contact, />Name </);
assert.doesNotMatch(contact, />First name </);
assert.doesNotMatch(contact, />Last name </);
assert.match(contact, />Enquiry type </);
assert.doesNotMatch(contact, />First Name </);
assert.match(upgrades, /html body \.contact-form-wrapper \.form-row\.full \{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/);
assert.match(contact, /\.form-group label \{[^}]*text-transform:\s*none/);

assert.match(memorials, /<h1>Headstones, gravestones and memorials<\/h1>/);
assert.match(memorials, /<p>Browse our memorials\. Each piece is made to your specification\.<\/p>/);
assert.doesNotMatch(memorials, /<h1[^>]*class="[^"]*reveal/);
assert.match(read("chat-widget.css"), /html body::after \{[^}]*height:\s*16px/);
assert.match(upgrades, /html body \.mobile-nav-item\.primary span \{[^}]*text-transform:\s*none/);
assert.match(upgrades, /html body \.mobile-nav-item\.primary \.nav-icon-bg \{[^}]*border-radius:\s*var\(--sm-radius-sm\)/);

console.log("device-review-should-fix: ok");
