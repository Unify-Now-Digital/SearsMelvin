// Home phone startup. The behaviour script is deferred and yields before the
// marquee and the photo grid. Consent, the tel queue, and site-upgrades.js
// stay where they were.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readFileSync("index.html", "utf8");
const home = readFileSync("home.js", "utf8");
assert.match(html, /<script src="\/home\.js\?v=20261127f" defer><\/script>/);
assert.doesNotMatch(html, /function initInstallations/);
assert.match(html, /<script src="\/cookie-consent\.js\?v=20261123a"><\/script>/);
assert.doesNotMatch(html, /cookie-consent\.js[^"]*" defer/);
assert.match(html, /<script src="\/site-upgrades\.js\?v=20261127c" defer><\/script>/);
assert.match(html, /googletagmanager\.com\/gtm\.js\?id=GTM-KRDX4BQ5/);
assert.match(home, /\{ passive: true \}/);
assert.match(home, /function yieldToMain\(\)/);
assert.match(home, /yieldToMain\(\)\.then\(initInstallations\)/);
assert.match(home, /await yieldToMain\(\);\s*grid\.innerHTML = html/);
assert.match(home, /await yieldToMain\(\);\s*track\.innerHTML = html \+ html/);
assert.match(home, /event: 'sm_lead_submit'/);
assert.doesNotMatch(home, /gtm\.js\?id=/);
assert.doesNotMatch(home, /gtag\('consent', 'default'/);

console.log("home-tbt: ok");
