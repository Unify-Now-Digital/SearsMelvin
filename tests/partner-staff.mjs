import assert from "node:assert/strict";

import {
  actorFromStaff,
  encodePartnerSessionToken,
  PARTNER_PORTAL_ORIGIN,
  staffFromEmail,
  staffFromGooglePayload,
  staffFromSessionToken,
} from "../functions/api/_partner-staff.js";

assert.equal(PARTNER_PORTAL_ORIGIN, "https://partner.searsmelvin.co.uk");

assert.deepEqual(staffFromEmail("arin@searsmelvin.co.uk"), {
  email: "arin@searsmelvin.co.uk",
  name: "Arin",
  role: "admin",
});
assert.deepEqual(staffFromEmail("matthew@searsmelvin.co.uk"), {
  email: "matthew@searsmelvin.co.uk",
  name: "Matthew",
  role: "admin",
});
assert.deepEqual(staffFromEmail("aylin@searsmelvin.co.uk", { name: "Arin", role: "admin" }), {
  email: "aylin@searsmelvin.co.uk",
  name: "Aylin",
  role: "operations",
});
assert.deepEqual(staffFromGooglePayload({
  email: "staff@searsmelvin.co.uk",
  given_name: "Pat",
}), {
  email: "staff@searsmelvin.co.uk",
  name: "Pat",
  role: "operations",
});
assert.equal(staffFromEmail("partner@example.com"), null);
assert.deepEqual(actorFromStaff(null), {});

const cookie = encodePartnerSessionToken("abc123", {
  email: "aylin@searsmelvin.co.uk",
  name: "Arin",
  role: "admin",
});
assert.equal(staffFromSessionToken(cookie).name, "Aylin");
assert.equal(staffFromSessionToken(cookie).role, "operations");
assert.equal(staffFromSessionToken("abc123"), null);
assert.deepEqual(actorFromStaff(staffFromEmail("arin@searsmelvin.co.uk")), {
  actor_type: "sears_melvin_staff",
  actor_email: "arin@searsmelvin.co.uk",
  actor_name: "Arin",
  actor_role: "admin",
});

console.log("partner staff identity tests passed");
