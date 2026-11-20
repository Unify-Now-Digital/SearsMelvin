import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import vm from "node:vm";

import { supabaseHeaders } from "../functions/api/_security.js";
import {
  LEGACY_PUBLIC_ANON_KEY,
  isLegacyJwtKey,
  publishableKey,
  publicSupabaseUrl,
  supabaseAuthHeaders,
  supabaseBrowserConfigScript,
  supabaseKeyHeaders,
} from "../functions/api/_supabase-keys.js";
import { onRequestGet as supabaseConfig } from "../functions/supabase-config.js";
import { onRequestDelete as deletePhoto, onRequestPost as uploadPhoto } from "../functions/api/upload-photo.js";

const PUBLISHABLE = "sb_publishable_examplekey123456";
const SECRET = "sb_secret_examplekey123456789";

function fakeJwt(role) {
  const body = Buffer.from(JSON.stringify({ role, ref: "bfwohzcugtwbhhxdqgme" })).toString("base64url");
  return `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.${body}.sig`;
}

assert.equal(isLegacyJwtKey(LEGACY_PUBLIC_ANON_KEY), true);
assert.equal(isLegacyJwtKey(PUBLISHABLE), false);
assert.equal(isLegacyJwtKey(SECRET), false);

{
  const headers = supabaseKeyHeaders(LEGACY_PUBLIC_ANON_KEY, { "Content-Type": "application/json" });
  assert.equal(headers.apikey, LEGACY_PUBLIC_ANON_KEY);
  assert.equal(headers.Authorization, `Bearer ${LEGACY_PUBLIC_ANON_KEY}`);
  assert.equal(headers["Content-Type"], "application/json");
}

{
  const headers = supabaseKeyHeaders(SECRET);
  assert.equal(headers.apikey, SECRET);
  assert.equal("Authorization" in headers, false);
  assert.deepEqual(supabaseAuthHeaders(headers), { apikey: SECRET });
}

{
  const headers = supabaseKeyHeaders(PUBLISHABLE, { Authorization: `Bearer ${PUBLISHABLE}` });
  assert.equal(headers.apikey, PUBLISHABLE);
  assert.equal("Authorization" in headers, false);
}

{
  const headers = supabaseHeaders({ SUPABASE_SERVICE_KEY: LEGACY_PUBLIC_ANON_KEY });
  assert.equal(headers.Authorization, `Bearer ${LEGACY_PUBLIC_ANON_KEY}`);
  assert.equal(headers["Content-Type"], "application/json");
  const secretHeaders = supabaseHeaders({ SUPABASE_SERVICE_KEY: SECRET });
  assert.equal(secretHeaders.apikey, SECRET);
  assert.equal("Authorization" in secretHeaders, false);
  assert.equal(secretHeaders["Content-Type"], "application/json");
}

{
  const errors = [];
  const original = console.error;
  console.error = (...args) => errors.push(args.map(String).join(" "));
  try {
    assert.equal(publishableKey({}), LEGACY_PUBLIC_ANON_KEY);
    assert.equal(publishableKey({ SUPABASE_PUBLISHABLE_KEY: `  ${PUBLISHABLE}  ` }), PUBLISHABLE);
    assert.equal(publishableKey({ SUPABASE_ANON_KEY: LEGACY_PUBLIC_ANON_KEY }), LEGACY_PUBLIC_ANON_KEY);
    assert.equal(
      publishableKey({ SUPABASE_PUBLISHABLE_KEY: PUBLISHABLE, SUPABASE_ANON_KEY: LEGACY_PUBLIC_ANON_KEY }),
      PUBLISHABLE,
    );
    assert.equal(publishableKey({ SUPABASE_PUBLISHABLE_KEY: SECRET }), LEGACY_PUBLIC_ANON_KEY);
    assert.equal(publishableKey({ SUPABASE_PUBLISHABLE_KEY: fakeJwt("service_role") }), LEGACY_PUBLIC_ANON_KEY);
    assert.equal(publishableKey({ SUPABASE_ANON_KEY: "not-a-key" }), LEGACY_PUBLIC_ANON_KEY);
  } finally {
    console.error = original;
  }
  const logged = errors.join("\n");
  assert.match(logged, /supabase_publishable_key_rejected/);
  assert.doesNotMatch(logged, /sb_secret_/);
  assert.doesNotMatch(logged, /service_role/);
}

assert.equal(publicSupabaseUrl({}), "https://bfwohzcugtwbhhxdqgme.supabase.co");
assert.equal(publicSupabaseUrl({ SUPABASE_URL: "https://example.supabase.co/" }), "https://example.supabase.co");
assert.equal(publicSupabaseUrl({ SUPABASE_URL: "http://example.supabase.co" }), "https://bfwohzcugtwbhhxdqgme.supabase.co");

function evalConfig(env) {
  const sandbox = { window: {} };
  vm.runInNewContext(supabaseBrowserConfigScript(env), sandbox);
  return sandbox.window.SM_SUPABASE;
}

{
  const config = evalConfig({});
  assert.equal(config.key, LEGACY_PUBLIC_ANON_KEY);
  assert.equal(config.headers().apikey, LEGACY_PUBLIC_ANON_KEY);
  assert.equal(config.headers().Authorization, `Bearer ${LEGACY_PUBLIC_ANON_KEY}`);
  const published = evalConfig({ SUPABASE_PUBLISHABLE_KEY: PUBLISHABLE, SUPABASE_URL: "https://bfwohzcugtwbhhxdqgme.supabase.co" });
  assert.equal(published.key, PUBLISHABLE);
  assert.equal(published.url, "https://bfwohzcugtwbhhxdqgme.supabase.co");
  const publishedHeaders = published.headers();
  assert.equal(publishedHeaders.apikey, PUBLISHABLE);
  assert.equal(publishedHeaders.Authorization, undefined);
  assert.deepEqual(Object.keys(publishedHeaders), ["apikey"]);
  const originalError = console.error;
  console.error = () => {};
  try {
    const refused = evalConfig({ SUPABASE_PUBLISHABLE_KEY: SECRET });
    assert.equal(refused.key, LEGACY_PUBLIC_ANON_KEY);
    assert.doesNotMatch(supabaseBrowserConfigScript({ SUPABASE_PUBLISHABLE_KEY: SECRET }), /sb_secret_/);
  } finally {
    console.error = originalError;
  }
}

{
  const errors = [];
  const original = console.error;
  console.error = (...args) => errors.push(args.map(String).join(" "));
  let response;
  try {
    response = await supabaseConfig({
      env: { SUPABASE_PUBLISHABLE_KEY: PUBLISHABLE, SUPABASE_URL: "https://bfwohzcugtwbhhxdqgme.supabase.co" },
    });
  } finally {
    console.error = original;
  }
  assert.equal(response.status, 200);
  assert.match(response.headers.get("Content-Type"), /^application\/javascript/);
  assert.equal(response.headers.get("Cache-Control"), "public, max-age=60");
  const body = await response.text();
  assert.match(body, /sb_publishable_examplekey123456/);
  assert.doesNotMatch(body, /sb_secret_/);
  assert.equal(errors.length, 0);
}

const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const ORG = "3770972d-1bbd-417b-b413-297e844db285";

async function exercisePhoto(serviceKey) {
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method || "GET", headers: init.headers });
    const target = String(url);
    if (target.includes("/rest/v1/rpc/check_portal_rate_limit")) {
      return Response.json([{ allowed: true, retry_after_seconds: 0 }]);
    }
    if (target.includes("/rest/v1/portal_security_events")) return new Response(null, { status: 201 });
    if (target.includes("/storage/v1/object/")) return Response.json({ Key: "ok" });
    throw new Error(`Unexpected fetch ${target}`);
  };
  try {
    const env = {
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_SERVICE_KEY: serviceKey,
      SM_ORG_ID: ORG,
    };
    const pending = [];
    const form = new FormData();
    form.append("file", new Blob([png], { type: "image/png" }), "a.png");
    const uploaded = await uploadPhoto({
      env,
      waitUntil(task) { pending.push(task); },
      request: new Request("https://searsmelvin.co.uk/api/upload-photo", {
        method: "POST",
        headers: { Origin: "https://searsmelvin.co.uk" },
        body: form,
      }),
    });
    assert.equal(uploaded.status, 200, `upload failed for ${serviceKey.slice(0, 12)}`);
    const body = await uploaded.json();
    const removed = await deletePhoto({
      env,
      waitUntil(task) { pending.push(task); },
      request: new Request("https://searsmelvin.co.uk/api/upload-photo", {
        method: "DELETE",
        headers: { "Content-Type": "application/json", Origin: "https://searsmelvin.co.uk" },
        body: JSON.stringify({ path: body.path, deleteToken: body.deleteToken }),
      }),
    });
    assert.equal(removed.status, 200);
    await Promise.all(pending);
    return calls;
  } finally {
    globalThis.fetch = originalFetch;
  }
}

function assertSupabaseCalls(calls, serviceKey) {
  const supabaseCalls = calls.filter((call) => call.url.includes("example.supabase.co"));
  assert.ok(supabaseCalls.length >= 3, "expected rate-limit, storage, and security-event calls");
  for (const call of supabaseCalls) {
    assert.equal(call.headers.apikey, serviceKey, call.url);
    if (isLegacyJwtKey(serviceKey)) {
      assert.equal(call.headers.Authorization, `Bearer ${serviceKey}`, call.url);
    } else {
      assert.equal(call.headers.Authorization, undefined, call.url);
    }
  }
  const storage = supabaseCalls.filter((call) => call.url.includes("/storage/v1/object/"));
  assert.deepEqual(storage.map((call) => call.method).sort(), ["DELETE", "POST"]);
}

assertSupabaseCalls(await exercisePhoto(SECRET), SECRET);
assertSupabaseCalls(await exercisePhoto(LEGACY_PUBLIC_ANON_KEY), LEGACY_PUBLIC_ANON_KEY);

const htmlPages = [
  "index.html", "memorials.html", "memorial.html", "contact.html", "quote.html",
  "about.html", "faq.html", "brochure.html", "care-guide.html", "resources.html",
  "privacy.html", "terms.html", "admin-products.html",
];
for (const page of htmlPages) {
  const html = readFileSync(page, "utf8");
  assert.equal(html.includes("eyJhbGci"), false, `${page} still has the anon JWT`);
  assert.match(html, /<script src="\/supabase-config"><\/script>/, page);
  assert.match(html, /window\.SM_SUPABASE\.url/, page);
  assert.doesNotMatch(html, /Authorization': 'Bearer ' \+ SUPABASE/);
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".git") continue;
    const path = `${dir}/${name}`;
    const stat = statSync(path);
    if (stat.isDirectory()) walk(path, out);
    else if (/\.(html|js|mjs|md)$/.test(name)) out.push(path);
  }
  return out;
}

const jwtHits = walk(".").filter((path) => readFileSync(path, "utf8").includes(LEGACY_PUBLIC_ANON_KEY));
assert.deepEqual(jwtHits, ["./functions/api/_supabase-keys.js"]);

const source = walk(".").filter((path) => (
  !path.startsWith("./docs/")
  && !path.startsWith("./.codex-out/")
  && path !== "./tests/supabase-keys.mjs"
));
for (const path of source) {
  const text = readFileSync(path, "utf8");
  assert.equal(text.includes("supabase.co/functions/v1/"), false, `${path} calls a Supabase Edge Function`);
}
for (const path of walk("./functions")) {
  const text = readFileSync(path, "utf8");
  assert.doesNotMatch(text, /Authorization:\s*`Bearer \$\{env\.SUPABASE_SERVICE_KEY\}`/, path);
}

const adminSign = readFileSync("functions/api/admin.js", "utf8");
const signBlock = adminSign.slice(adminSign.indexOf("async function signPhotoPaths"), adminSign.indexOf("async function listProducts"));
assert.match(signBlock, /supabaseKeyHeaders\(env\.SUPABASE_SERVICE_KEY\)/);
assert.match(signBlock, /\/storage\/v1\/object\/sign\/enquiry-photos/);

console.log("supabase-keys: ok");
