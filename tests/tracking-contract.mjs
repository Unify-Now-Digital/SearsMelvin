// Tracking contract (docs/TRACKING.md). Fails CI if a tracking hook breaks.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { pageProblems, parseGtm, requiredTagProblems, driftProblems, GTM_ID } from "../scripts/tracking-check.mjs";

const html = (f) => readFileSync(f, "utf8");
const publicPages = execSync("git ls-files '*.html'").toString().split("\n").filter(Boolean)
  .filter((f) => !["404.html", "admin.html", "admin-products.html", "styleguide.html"].includes(f));

// 1. Every public page: GTM, chat hook, phone format, tel links show the number, no internal UTMs.
for (const f of publicPages) {
  const problems = pageProblems(f, html(f)).filter((p) => !p.endsWith(`phone "020 3835 2548" not found`) || f !== "quote.html");
  assert.deepEqual(problems, [], problems.join("\n"));
  assert.ok(/window\.__smChatHook = true;/.test(html(f)), `${f}: legacy GTM chat listener must stay disabled`);
}
// (Server-side emails in functions/ are not swappable, so only site files are checked.)
for (const f of execSync("git ls-files '*.html' '*.js'").toString().split("\n").filter(Boolean)) {
  if (f.startsWith("functions/") || f.startsWith("tests/") || f.startsWith("scripts/")) continue;
  assert.ok(!html(f).includes("+44 20 3835 2548"), `${f}: use "020 3835 2548"`);
}

// 2. Required pushes exist, are on the confirmed-success path, and come before hiding the form.
const contact = html("contact.html");
const cOk = contact.slice(contact.indexOf("if (result.ok) {"));
assert.ok(cOk.includes("event: 'sm_lead_submit'"), "contact: sm_lead_submit push missing");
assert.ok(cOk.indexOf("event: 'sm_lead_submit'") < cOk.indexOf("contactForm').style.display = 'none'"), "contact: push before hiding the form");
const memorial = html("memorial.html");
const qOk = memorial.slice(memorial.indexOf("if (result.ok) {", memorial.indexOf("channel:  'quote'")));
assert.ok(qOk.includes("event: 'sm_quote_submit'"), "quote: sm_quote_submit push missing");
assert.ok(qOk.indexOf("event: 'sm_quote_submit'") < qOk.indexOf("quoteForm').style.display = 'none'"), "quote: push before hiding the form");
const clickIntentSrc = html("site-upgrades.js");
assert.match(clickIntentSrc, /email\.trim\(\)\.toLowerCase\(\)\.slice\(0, 200\)/, "clickIntentBody email sanitising changed");
assert.match(clickIntentSrc, /phone\.trim\(\)\.replace\(\/\[\^\\d\+\]\/g, ''\)\.slice\(0, 20\)/, "clickIntentBody phone sanitising changed");
for (const f of publicPages) {
  const s = html(f);
  if (!s.includes("LeadConnector chat")) continue;
  assert.match(s, /event: 'sm_chat_submit'/, `${f}: sm_chat_submit push missing`);
  assert.match(s, /event: 'ghl_chat_submission'/, `${f}: ghl_chat_submission push missing`);
  const hook = s.slice(s.indexOf("function chatSubmitted"), s.indexOf("function hookChat"));
  const emailAt = hook.indexOf("window.__smChatEmail");
  const phoneAt = hook.indexOf("window.__smChatPhone");
  const pushAt = hook.indexOf("dataLayer.push");
  assert.ok(emailAt >= 0 && phoneAt > emailAt && pushAt > phoneAt, `${f}: stash __smChatEmail/__smChatPhone before the dataLayer push`);
  assert.match(hook, /email\.trim\(\)\.toLowerCase\(\)\.slice\(0, 200\)/, `${f}: chat email sanitising must match clickIntentBody`);
  assert.match(hook, /phone\.trim\(\)\.replace\(\/\[\^\\d\+\]\/g, ''\)\.slice\(0, 20\)/, `${f}: chat phone sanitising must match clickIntentBody`);
  assert.match(hook, /delete window\.__smChatEmail/, `${f}: clear a stale chat email`);
  assert.match(hook, /delete window\.__smChatPhone/, `${f}: clear a stale chat phone`);
  assert.match(s, /var CHAT_VISIT_KEY = 'sm_chat_counted';/, `${f}: tab-visit chat flag missing`);
  assert.match(hook, /sessionStorage\.getItem\(CHAT_VISIT_KEY\) === '1'/, `${f}: must read the tab-visit flag`);
  assert.ok(hook.indexOf("if (counted) return true") < hook.indexOf("dataLayer.push"), `${f}: a counted visit must not push`);
  assert.ok(hook.indexOf("sessionStorage.setItem") < hook.indexOf("dataLayer.push"), `${f}: mark the visit before the push`);
  assert.ok(hook.indexOf("SMUpgrades.clickIntent") > hook.indexOf("dataLayer.push"), `${f}: clickIntent only follows the counted push`);
  assert.doesNotMatch(s, /lastChatPush/, `${f}: 3s debounce is not the visit guard`);
  const events = [...hook.matchAll(/dataLayer\.push\(\s*\{[^}]*\}\s*\)/g)].map((m) => m[0]);
  assert.deepEqual(events, [
    "dataLayer.push({ event: 'sm_chat_submit' })",
    "dataLayer.push({ event: 'ghl_chat_submission' })",
  ], `${f}: chat dataLayer events must stay free of personal details`);
}
assert.match(html("site-upgrades.js"), /event: 'brochure_download'/, "brochure_download push missing");

// 3. No personal details in any dataLayer push object literal.
const PII = /\b(email|e_mail|phone|phone_number|tel|first_?name|last_?name|full_?name|name|message|address|postcode|user_data)\s*:/i;
for (const f of execSync("git ls-files '*.html' '*.js'").toString().split("\n").filter(Boolean)) {
  if (f.startsWith("functions/") || f.startsWith("tests/") || f.startsWith("scripts/")) continue;
  const s = html(f);
  for (const m of s.matchAll(/dataLayer\.push\(\s*\{/g)) {
    let depth = 0, i = m.index + m[0].length - 1, end = i;
    for (; end < s.length; end++) { if (s[end] === "{") depth++; else if (s[end] === "}" && --depth === 0) break; }
    const obj = s.slice(i, end + 1).replace(/\/\/[^\n]*/g, "");
    assert.ok(!PII.test(obj), `${f}: personal data in dataLayer push: ${obj.slice(0, 120)}`);
  }
}

// 4. Committed GTM snapshot still satisfies the contract (live drift is checked by scripts/tracking-check.mjs).
const snap = JSON.parse(html("docs/gtm-snapshot.json"));
assert.equal(snap.container, GTM_ID);
assert.equal(snap.version, "28", "snapshot must match live GTM v28");
assert.deepEqual(requiredTagProblems(snap), []);
assert.deepEqual(driftProblems(snap, snap), []);
const chatStart = snap.tags.find((tag) => tag.function === "__awct" && tag.id === "MipOCNXwuLscEK-15Oo-");
assert.equal(chatStart && chatStart.value, "150", "Ads Chat start value is 150 GBP");
assert.ok(chatStart.triggers.some((rule) => rule.includes("sm_chat_submit")), "Chat start still fires on sm_chat_submit");
const brochureTag = snap.tags.find((tag) => tag.function === "__gaawe" && tag.id === "brochure_download");
assert.deepEqual(brochureTag && brochureTag.params, { brochure_source: "{{variable}}" }, "GA4 brochure param is brochure_source");
const clickToCall = snap.tags.find((tag) => tag.function === "__awct" && tag.id === "okRkCPGTqJsdEK-15Oo-");
assert.equal(clickToCall && clickToCall.value, "150", "click-to-call stays 150");
const staffCookie = snap.tags.filter((tag) => tag.function === "__html" && tag.triggers.some((rule) => rule.includes("sm_internal=")));
assert.equal(staffCookie.length, 1, "staff internal-cookie tag");
const trackingDoc = html("docs/TRACKING.md");
assert.ok(trackingDoc.includes("sm_quote_submit"));
assert.match(trackingDoc, /live version 28/);
assert.match(trackingDoc, /brochure_source/);
assert.match(trackingDoc, /tag value 150/);
assert.doesNotMatch(trackingDoc, /tag value 200/);
assert.doesNotMatch(trackingDoc, /sends £200/);
console.log("tracking-contract: ok");
