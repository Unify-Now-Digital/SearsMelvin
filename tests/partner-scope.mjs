import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const api = readFileSync(new URL("../functions/api/partner-orders.js", import.meta.url), "utf8");

assert.match(api, /organization_id=eq\.\$\{encodeURIComponent\(workspace\.organizationId\)\}/);
assert.match(api, /is_test=eq\.false&partner_id=eq/);
assert.match(api, /partner_id\.is\.null,partner_id\.eq/);
assert.match(api, /includesExternalPartnerOrders: false/);
assert.match(api, /orders\.is_test=eq\.false/);
assert.match(api, /invoices\?deleted_at=is\.null&is_test=eq\.false/);
assert.match(api, /cemeteries\?is_active=eq\.true&is_test=eq\.false/);

console.log("partner scope tests passed");
