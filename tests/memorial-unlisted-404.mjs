import assert from "node:assert/strict";
import { onRequestGet } from "../functions/memorials/[slug].js";

const SHELL = "<html><head><title>Memorial</title><script>GTM-KRDX4BQ5</script></head><body></body></html>";
const env = { ASSETS: { fetch: async () => new Response(SHELL, { headers: { "Content-Type": "text/html" } }) } };
const req = (slug, query = "") => ({
  request: new Request(`https://searsmelvin.co.uk/memorials/${slug}${query}`),
  env,
  params: { slug },
});

globalThis.fetch = async () => Response.json([]);
let response = await onRequestGet(req("test-product"));
assert.equal(response.status, 404);
assert.equal(response.headers.get("X-Robots-Tag"), "noindex");
assert.match(await response.text(), /GTM-KRDX4BQ5/);

response = await onRequestGet(req("tapered-churchyard-memorial", "?gclid=abc"));
assert.equal(response.status, 301);
assert.equal(response.headers.get("Location"), "/memorials?type=churchyard-memorials&gclid=abc");

response = await onRequestGet(req("boulder-memorial"));
assert.equal(response.status, 410);

response = await onRequestGet(req("the-silverstone"));
assert.equal(response.status, 410);

globalThis.fetch = async () => new Response("err", { status: 503 });
response = await onRequestGet(req("the-hartwell", "?gclid=abc"));
assert.equal(response.status, 200);
assert.match(await response.text(), /GTM-KRDX4BQ5/);

globalThis.fetch = async () => { throw new Error("unreachable"); };
response = await onRequestGet(req("the-hartwell"));
assert.equal(response.status, 200);

console.log("memorial-unlisted-404: ok");
