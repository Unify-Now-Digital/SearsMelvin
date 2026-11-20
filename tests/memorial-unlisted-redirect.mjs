import assert from "node:assert/strict";
import { onRequestGet } from "../functions/memorials/[slug].js";

const SHELL = '<html><head><title>Memorial</title><script>GTM-KRDX4BQ5</script></head><body></body></html>';
const env = { ASSETS: { fetch: async () => new Response(SHELL, { headers: { "Content-Type": "text/html" } }) } };
const req = (s, q = "") => ({ request: new Request(`https://searsmelvin.co.uk/memorials/${s}${q}`), env, params: { slug: s } });

// Unlisted / unknown slug (Supabase OK, no rows) -> 302 to /memorials.
globalThis.fetch = async () => Response.json([]);
let r = await onRequestGet(req("test-product"));
assert.equal(r.status, 302);
assert.equal(r.headers.get("Location"), "/memorials");
assert.equal(r.headers.get("X-Robots-Tag"), "noindex");

// Tracking params must survive the redirect verbatim.
const q = "?gclid=abc&utm_source=x&utm_medium=cpc&gbraid=g1&wbraid=w1";
r = await onRequestGet(req("zzz-nope", q));
assert.equal(r.status, 302);
assert.equal(r.headers.get("Location"), "/memorials" + q);

// Supabase outage -> keep serving the shell with 200 (never redirect real products away).
globalThis.fetch = async () => new Response("err", { status: 503 });
r = await onRequestGet(req("lawn-memorial", "?gclid=abc"));
assert.equal(r.status, 200);
assert.ok((await r.text()).includes("GTM-KRDX4BQ5"));
globalThis.fetch = async () => { throw new Error("unreachable"); };
r = await onRequestGet(req("lawn-memorial"));
assert.equal(r.status, 200);
console.log("memorial-unlisted-redirect: ok");
