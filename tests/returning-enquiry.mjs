import assert from "node:assert/strict";
import { createGHLContact, returningContactUpdate, returningNameDiffers, returningEnquiryNote } from "../functions/api/submit.js";

assert.deepEqual(returningContactUpdate({ phone: "", firstName: "", lastName: null }, { firstName: "Lowri", lastName: "Perez", phone: "07767618004" }), { phone: "07767618004", firstName: "Lowri", lastName: "Perez" });
assert.deepEqual(returningContactUpdate({ phone: "+44 1", firstName: "ann", lastName: "kelle" }, { firstName: "Lowri", lastName: "Perez", phone: "07767618004" }), {}, "never overwrite non-blank");
assert.equal(returningNameDiffers({ firstName: "ann", lastName: "kelle" }, "Lowri P."), true);
assert.equal(returningNameDiffers({ firstName: "Lowri", lastName: "perez" }, " lowri  Perez "), false);
assert.equal(returningNameDiffers({ firstName: "", lastName: "" }, "Lowri"), false);
assert.equal(returningEnquiryNote({ name: "Lowri P.", phone: "07767618004", message: "WA", product: null, cemetery: "Newhaven Cemetery" }, new Date("2026-10-24T17:27:42Z")),
  "Returning enquiry 24 Oct 2026, 18:27 as 'Lowri P.', phone 07767618004, message: WA, product/cemetery: - / Newhaven Cemetery");

async function run(existing, args) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const u = String(url); const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ url: u, method: init.method || "GET", body });
    if (u.includes("/customFields")) return Response.json({ customFields: [] });
    if (u.endsWith("/contacts/")) { assert.equal(body.allowDuplicateContact, undefined); return new Response(JSON.stringify({ message: "This location does not allow duplicated contacts.", meta: { contactId: "c9" } }), { status: 400 }); }
    if (u.endsWith("/contacts/c9") && !init.method) return Response.json({ contact: existing });
    return Response.json({ ok: true });
  };
  const id = await createGHLContact({ GHL_API_KEY: "t", GHL_LOCATION_ID: "ret-test" }, { type: "enquiry", email: "x@example.com", fetchImpl, ...args });
  assert.equal(id, "c9");
  return calls;
}

let calls = await run({ firstName: "ann", lastName: "kelle", phone: "", customFields: [] }, { name: "Lowri P.", phone: "07767618004", message: "WA", cemetery: "Newhaven Cemetery" });
let put = calls.find((c) => c.method === "PUT");
assert.deepEqual(put.body, { phone: "07767618004" }, "only blank phone filled, name kept");
let note = calls.find((c) => c.url.endsWith("/contacts/c9/notes"));
assert.match(note.body.body, /^Returning enquiry .* as 'Lowri P\.', phone 07767618004, message: WA, product\/cemetery: - \/ Newhaven Cemetery$/);
let tags = calls.find((c) => c.url.endsWith("/contacts/c9/tags"));
assert.ok(tags.body.tags.includes("returning-enquiry"));

calls = await run({ firstName: "Lowri", lastName: "Perez", phone: "+447767618004", customFields: [] }, { name: "Lowri Perez", phone: "07767618004", message: "hi" });
assert.equal(calls.find((c) => c.method === "PUT"), undefined, "nothing to fill");
assert.equal(calls.find((c) => c.url.endsWith("/notes")), undefined, "same name: no note");
assert.ok(calls.find((c) => c.url.endsWith("/tags")).body.tags.includes("returning-enquiry"));

calls = await run({ firstName: "", lastName: "", phone: "", customFields: [] }, { name: "Lowri Perez", phone: "07767618004" });
assert.deepEqual(calls.find((c) => c.method === "PUT").body, { phone: "07767618004", firstName: "Lowri", lastName: "Perez" });
console.log("returning-enquiry OK");
