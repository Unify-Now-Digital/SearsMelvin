// Tracking contract (docs/TRACKING.md). Fails CI if a tracking hook breaks.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { pageProblems, parseGtm, requiredTagProblems, driftProblems, GTM_ID } from "../scripts/tracking-check.mjs";

const html = (f) => readFileSync(f, "utf8");
const publicPages = execSync("git ls-files '*.html'").toString().split("\n").filter(Boolean)
  .filter((f) => !["404.html", "admin.html", "admin-products.html"].includes(f));

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
for (const f of publicPages) {
  const s = html(f);
  if (!s.includes("LeadConnector chat")) continue;
  assert.match(s, /event: 'sm_chat_submit'/, `${f}: sm_chat_submit push missing`);
  assert.match(s, /event: 'ghl_chat_submission'/, `${f}: ghl_chat_submission push missing`);
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
assert.deepEqual(requiredTagProblems(snap), []);
assert.deepEqual(driftProblems(snap, snap), []);
assert.ok(html("docs/TRACKING.md").includes("sm_quote_submit"));
console.log("tracking-contract: ok");
