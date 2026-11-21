// Contact name is one field. The server splits it for people.last_name,
// HighLevel, and the customer greeting. A cached page may still send
// firstName/lastName with no combined name.
import assert from "node:assert/strict";
import { createGHLContact, ghlNameParts, splitName, validateSubmission } from "../functions/api/submit.js";
import { familyEnquiryEmail } from "../functions/api/_email-brand.js";

const split = (full) => splitName(full);

assert.deepEqual(split("  Mary    Ann   O'Brien  "), { first_name: "Mary", last_name: "Ann O'Brien" });
assert.deepEqual(split("Madonna"), { first_name: "Madonna", last_name: "-" });
assert.deepEqual(split("Mary-Jane Watson-Parker"), { first_name: "Mary-Jane", last_name: "Watson-Parker" });
assert.deepEqual(split("Ada van der Berg"), { first_name: "Ada", last_name: "van der Berg" });
assert.deepEqual(split("McDonald O'Brien"), { first_name: "McDonald", last_name: "O'Brien" });
assert.deepEqual(split("Jean-Luc de la Croix"), { first_name: "Jean-Luc", last_name: "de la Croix" });

for (const title of ["Mr", "Mr.", "MRS", "Miss", "Ms.", "mx", "Dr.", "Prof", "Sir", "Mr and Mrs", "Mr. and Mrs.", "MR. AND MRS"]) {
  assert.deepEqual(split(title), { first_name: null, last_name: "-" }, title);
}

assert.deepEqual(split("Mr and Mrs Smith"), { first_name: "Smith", last_name: "-" });
assert.deepEqual(split("Mr. and Mrs. Smith"), { first_name: "Smith", last_name: "-" });
assert.deepEqual(split("mr and mrs smith"), { first_name: "smith", last_name: "-" });
assert.deepEqual(split("Mr and Mrs John Smith"), { first_name: "John", last_name: "Smith" });
assert.deepEqual(split("Dr. Jane McDonald"), { first_name: "Jane", last_name: "McDonald" });
assert.deepEqual(split("Dr.Jane McDonald"), { first_name: "Jane", last_name: "McDonald" });
assert.deepEqual(split("Prof. Sir David Attenborough"), { first_name: "David", last_name: "Attenborough" });
assert.deepEqual(split("Miss Anne"), { first_name: "Anne", last_name: "-" });
assert.deepEqual(split("Anna Ms Smith"), { first_name: "Anna", last_name: "Ms Smith" });

assert.deepEqual(ghlNameParts("Madonna"), { firstName: "Madonna", lastName: "" });
assert.deepEqual(ghlNameParts("Mr and Mrs Smith"), { firstName: "Smith", lastName: "" });
assert.deepEqual(ghlNameParts("Mr"), { firstName: "", lastName: "" });
assert.deepEqual(ghlNameParts("Ada van der Berg"), { firstName: "Ada", lastName: "van der Berg" });

function thanks(name) {
  const html = familyEnquiryEmail({ name, email: "a@example.com", enquiryTypeLabel: "Question" }).html;
  const heading = html.match(/<h1[^>]*>([^<]+)<\/h1>/);
  return heading ? heading[1] : "";
}

assert.equal(thanks("Mr Smith"), "Thank you, Smith.");
assert.equal(thanks("Mr."), "Thank you.");
assert.equal(thanks("Mr and Mrs Smith"), "Thank you, Smith.");
assert.equal(thanks("mary ann"), "Thank you, Mary.");
assert.doesNotMatch(thanks("Mr Smith"), /Thank you, Mr/);

const org = "org";
const email = "ada@example.com";
assert.equal(validateSubmission({ channel: "contact", firstName: "Ada", lastName: "Lovelace", email }, org).data.name, "Ada Lovelace");
assert.equal(validateSubmission({ channel: "contact", first_name: "Ada", last_name: "van der Berg", email }, org).data.name, "Ada van der Berg");
assert.equal(validateSubmission({ channel: "contact", name: "   ", firstName: "Ada", lastName: "Lovelace", email }, org).data.name, "Ada Lovelace");
assert.equal(validateSubmission({ channel: "contact", name: "Kept Name", firstName: "Other", lastName: "Person", email }, org).data.name, "Kept Name");
assert.equal(validateSubmission({ channel: "contact", email }, org).ok, false);
assert.equal(validateSubmission({ channel: "contact", firstName: "A".repeat(121), email }, org).ok, false);

async function postedName(name) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method || "GET", body: init.body ? JSON.parse(init.body) : null });
    if (String(url).endsWith("/contacts/")) return Response.json({ contact: { id: "new-1" } });
    return Response.json({ customFields: [] });
  };
  const id = await createGHLContact(
    { GHL_API_KEY: "t", GHL_LOCATION_ID: "split-test" },
    { name, email: "m@example.com", type: "enquiry", fetchImpl },
  );
  assert.equal(id, "new-1");
  return calls.find((call) => call.method === "POST" && call.url.endsWith("/contacts/")).body;
}

let body = await postedName("Madonna");
assert.equal(body.firstName, "Madonna");
assert.equal(body.lastName, "");

body = await postedName("Mr and Mrs Smith");
assert.equal(body.firstName, "Smith");
assert.equal(body.lastName, "");

body = await postedName("  Mary    Ann   O'Brien  ");
assert.equal(body.firstName, "Mary");
assert.equal(body.lastName, "Ann O'Brien");

body = await postedName("Dr. Jane McDonald");
assert.equal(body.firstName, "Jane");
assert.equal(body.lastName, "McDonald");

console.log("split-name: ok");
