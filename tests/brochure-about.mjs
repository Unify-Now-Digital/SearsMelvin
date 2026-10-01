// Brochure soft-gate and About page shell.
// The PDF is brochure v4. The page must not link it until /api/submit
// accepts an email. Meet the team stays an empty hidden grid.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { formatNameForSubject, onRequestPost } from "../functions/api/submit.js";

const PDF_PATH = "/assets/sears-melvin-brochure-v4.pdf";

assert.equal(formatNameForSubject("jane@example.com"), "jane@example.com");
assert.equal(formatNameForSubject("evans"), "Evans");

const pdfFile = new URL("../assets/sears-melvin-brochure-v4.pdf", import.meta.url);
assert.equal(existsSync(pdfFile), true);
assert.equal(readFileSync(pdfFile).subarray(0, 5).toString(), "%PDF-");

const brochureHtml = readFileSync(new URL("../brochure.html", import.meta.url), "utf8");
const aboutHtml = readFileSync(new URL("../about.html", import.meta.url), "utf8");

assert.equal(/<a\b[^>]*href\s*=\s*["'][^"']*\.pdf/i.test(brochureHtml), false);
assert.match(brochureHtml, /id="brochureForm"/);
assert.match(brochureHtml, /id="brochureReady" hidden/);
assert.match(brochureHtml, /id="brochureEmail"[^>]*required/);
assert.match(brochureHtml, /enquiry_type:\s*'brochure'/);
assert.match(brochureHtml, /\/api\/submit/);
assert.match(brochureHtml, /href="\/contact"/);
assert.equal(/churchill/i.test(brochureHtml), false);
assert.match(brochureHtml, new RegExp(PDF_PATH.replace(/\//g, "\\/")));

assert.match(aboutHtml, /id="meet-the-team" hidden/);
assert.match(aboutHtml, /id="teamGrid"><\/div>/);
assert.match(aboutHtml, /var TEAM = \[\];/);
assert.match(aboutHtml, /id="how-we-help"/);
assert.match(aboutHtml, /Book a consultation/);
assert.match(aboutHtml, /href="\/contact"/);
const aboutMarkup = aboutHtml.replace(/<script[\s\S]*?<\/script>/gi, "");
assert.equal(/<article class="team-card">/.test(aboutMarkup), false);
assert.equal(/<(img|h3)\b/i.test(aboutMarkup.split('id="meet-the-team"')[1] || ""), false);
assert.equal(/unsplash|pexels|placeholder\.com/i.test(aboutHtml), false);
assert.equal(/churchill/i.test(aboutHtml), false);

for (const file of ["index.html", "memorials.html", "contact.html", "faq.html", "memorial.html"]) {
  const html = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
  assert.equal(html.includes('href="/#about"'), false, file);
  assert.equal(html.includes('href="#about">About'), false, file);
  assert.match(html, /href="\/about"/, file);
  assert.match(html, /class="nav-links"[\s\S]*href="\/brochure"/, file);
}
assert.match(readFileSync(new URL("../index.html", import.meta.url), "utf8"), /class="hero-brochure"/);
assert.match(readFileSync(new URL("../memorials.html", import.meta.url), "utf8"), /class="brochure-end"/);
assert.match(readFileSync(new URL("../functions/sitemap.xml.js", import.meta.url), "utf8"), /\/brochure/);
assert.match(readFileSync(new URL("../functions/sitemap.xml.js", import.meta.url), "utf8"), /\/about/);

const env = {
  RESEND_API_KEY: "test-resend-key",
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SERVICE_KEY: "test-service-role-key",
  SM_ORG_ID: "00000000-0000-4000-8000-000000000001",
};

const originalFetch = globalThis.fetch;
let sentEmails = [];

globalThis.fetch = async (input, init = {}) => {
  const url = String(input);
  if (url.includes("/rpc/check_portal_rate_limit")) return Response.json([{ allowed: true, retry_after_seconds: 0 }]);
  if (url.includes("/rest/v1/people?email=eq.")) return Response.json([{ id: 7, is_customer: false }]);
  if (url.includes("/rest/v1/people?id=eq.")) return new Response(null, { status: 204 });
  if (url.includes("/rest/v1/cemeteries")) return Response.json([]);
  if (url.includes("/rest/v1/enquiries")) return new Response(null, { status: 201 });
  if (url === "https://api.resend.com/emails") {
    sentEmails.push(JSON.parse(init.body));
    return Response.json({ id: "email_test" });
  }
  throw new Error(`Unexpected fetch in test: ${url}`);
};

async function submit(body) {
  sentEmails = [];
  const pending = [];
  const response = await onRequestPost({
    env,
    waitUntil: (promise) => pending.push(promise),
    request: new Request("https://searsmelvin.co.uk/api/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json", "CF-Connecting-IP": "203.0.113.10" },
      body: JSON.stringify(body),
    }),
  });
  await Promise.allSettled(pending);
  return { status: response.status, body: await response.json(), emails: sentEmails.slice() };
}

{
  const result = await submit({
    channel: "contact",
    enquiry_type: "brochure",
    email: "jane@example.com",
    source_page: "/brochure",
  });
  assert.equal(result.status, 200);
  assert.equal(result.body.ok, true);
  assert.equal(result.body.download, PDF_PATH);
  const business = result.emails.find((email) => email.to === "info@searsmelvin.co.uk");
  assert.equal(business.subject, "New Enquiry — jane@example.com — Brochure");
  const customer = result.emails.find((email) => email.to === "jane@example.com");
  assert.match(customer.subject, /Brochure enquiry — Sears Melvin Memorials$/);
  assert.match(customer.html, /Thank you\./);
  assert.equal(customer.html.includes("Thank you, jane@example.com"), false);
}

{
  const result = await submit({
    channel: "contact",
    enquiry_type: "brochure",
    name: "evans todd",
    email: "evans@example.com",
  });
  assert.equal(result.status, 200);
  assert.equal(result.body.download, PDF_PATH);
  const business = result.emails.find((email) => email.to === "info@searsmelvin.co.uk");
  assert.equal(business.subject, "New Enquiry — Evans Todd — Brochure");
}

{
  const result = await submit({ channel: "contact", enquiry_type: "brochure", name: "Jane" });
  assert.equal(result.status, 400);
  assert.equal(result.body.ok, false);
  assert.equal(result.body.download, undefined);
  assert.equal(sentEmails.length, 0);
}

{
  const result = await submit({ channel: "contact", message: "Hello" });
  assert.equal(result.status, 400);
  assert.equal(result.body.download, undefined);
}

globalThis.fetch = originalFetch;
console.log("brochure and about tests passed");
