import assert from "node:assert/strict";
import { onRequestGet } from "../functions/memorials/[slug].js";

const SHELL = '<html><head><title>Memorial</title><script>GTM-KRDX4BQ5</script></head><body></body></html>';
const env = { ASSETS: { fetch: async () => new Response(SHELL, { headers: { "Content-Type": "text/html" } }) } };
const req = (s) => ({ request: new Request(`https://searsmelvin.co.uk/memorials/${s}`), env, params: { slug: s } });

// Unlisted / unknown slug (Supabase OK, no rows) -> 404, tracking shell intact.
globalThis.fetch = async () => Response.json([]);
let r = await onRequestGet(req("test-product"));
assert.equal(r.status, 404);
assert.equal(r.headers.get("X-Robots-Tag"), "noindex");
assert.ok((await r.text()).includes("GTM-KRDX4BQ5"));

// Supabase outage -> keep serving the shell with 200 (don't 404 real products).
globalThis.fetch = async () => new Response("err", { status: 503 });
r = await onRequestGet(req("lawn-memorial"));
assert.equal(r.status, 200);
console.log("memorial-unlisted-404: ok");
