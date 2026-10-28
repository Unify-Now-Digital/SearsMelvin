import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  appointmentNotes,
  createGHLContact,
  fillOnlyCustomFields,
} from "../functions/api/submit.js";

const index = await readFile(new URL("../index.html", import.meta.url), "utf8");
const appointment = index.slice(index.indexOf("async function submitAppointment()"), index.indexOf("// ==================== SUPABASE CONFIG"));
assert.match(appointment, /event:\s*'sm_lead_submit'/);
assert.ok(appointment.indexOf("event: 'sm_lead_submit'") < appointment.indexOf("apptFormFields').style.display = 'none'"));

assert.deepEqual(
  fillOnlyCustomFields(
    [{ id: "empty", field_value: "" }, { id: "kept", field_value: "original" }],
    [{ id: "empty", field_value: "new" }, { id: "kept", field_value: "replacement" }, { id: "missing", field_value: "added" }, { id: "blank", field_value: "   " }],
  ),
  [{ id: "empty", field_value: "new" }, { id: "missing", field_value: "added" }],
);

const env = { GHL_API_KEY: "test-key", GHL_LOCATION_ID: "test-location" };
const jsonResponse = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

{
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });
    if (calls.length === 1) return jsonResponse(409, { message: "Location does not allow duplicated contacts", meta: { contactId: "existing-1" } });
    if (calls.length === 2) return jsonResponse(200, { contact: { firstName: "Test", lastName: "Person", phone: "+440000", customFields: [{ id: "gclid-id", field_value: "" }, { id: "utm-id", field_value: "saved" }] } });
    return jsonResponse(200, {});
  };
  const id = await createGHLContact(env, {
    name: "Test Person", email: "test@example.com", type: "appointment", fetchImpl,
    attributionFields: [{ id: "gclid-id", field_value: "click" }, { id: "utm-id", field_value: "new" }],
  });
  assert.equal(id, "existing-1");
  assert.deepEqual(calls.map(call => call.options.method || "GET"), ["POST", "GET", "PUT", "POST"]);
  assert.deepEqual(JSON.parse(calls[2].options.body), { customFields: [{ id: "gclid-id", field_value: "click" }] });
  assert.match(calls[3].url, /\/contacts\/existing-1\/tags$/);
}

{
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });
    if (calls.length === 1) return jsonResponse(422, { message: "does not allow duplicated contacts", meta: { contact: { id: "existing-2" } } });
    if (calls.length === 2) return jsonResponse(200, { contact: { firstName: "Test", lastName: "Person", phone: "+440000", customFields: [{ id: "gclid-id", field_value: "saved" }] } });
    return jsonResponse(200, {});
  };
  assert.equal(await createGHLContact(env, {
    name: "Test Person", email: "test@example.com", type: "appointment", fetchImpl,
    attributionFields: [{ id: "gclid-id", field_value: "new" }],
  }), "existing-2");
  assert.equal(calls.some(call => call.options.method === "PUT"), false);
}

assert.equal(appointmentNotes({ notes: "  note  ", message: "message" }), "note");
assert.equal(appointmentNotes({ message: "  fallback  " }), "fallback");
assert.equal(appointmentNotes({ notes: "   ", message: "ignored" }), null);

console.log("form gap tests passed");
