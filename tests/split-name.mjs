// Contact name is one field. Couple titles stay whole. A cached page may still
// send firstName/lastName with no combined name.
import assert from "node:assert/strict";
import { createGHLContact, ghlNameParts, splitName, validateSubmission } from "../functions/api/submit.js";
import { familyEnquiryEmail, greetingName, thanksName } from "../functions/api/_email-brand.js";

const nameOf = (full) => {
  const parsed = splitName(full);
  return { first_name: parsed.first_name, last_name: parsed.last_name };
};

assert.deepEqual(nameOf("John Smith"), { first_name: "John", last_name: "Smith" });
assert.deepEqual(nameOf("Madonna"), { first_name: "Madonna", last_name: "-" });
assert.deepEqual(nameOf("  Mary    Ann   O'Brien  "), { first_name: "Mary", last_name: "Ann O'Brien" });
assert.deepEqual(nameOf("Mary-Jane Watson-Parker"), { first_name: "Mary-Jane", last_name: "Watson-Parker" });
assert.deepEqual(nameOf("Ada van der Berg"), { first_name: "Ada", last_name: "van der Berg" });
assert.deepEqual(nameOf("José García"), { first_name: "José", last_name: "García" });
assert.deepEqual(nameOf("李"), { first_name: "李", last_name: "-" });

assert.deepEqual(nameOf("Mr and Mrs Smith"), { first_name: "Mr and Mrs", last_name: "Smith" });
assert.deepEqual(nameOf("Mr & Mrs Smith"), { first_name: "Mr & Mrs", last_name: "Smith" });
assert.deepEqual(nameOf("Mr. and Mrs. Smith"), { first_name: "Mr. and Mrs.", last_name: "Smith" });
assert.deepEqual(nameOf("mr and mrs smith"), { first_name: "mr and mrs", last_name: "smith" });
assert.deepEqual(nameOf("Dr and Mrs Smith"), { first_name: "Dr and Mrs", last_name: "Smith" });
assert.deepEqual(nameOf("Dr & Mrs Patel"), { first_name: "Dr & Mrs", last_name: "Patel" });
assert.deepEqual(nameOf("Lord and Lady Grey"), { first_name: "Lord and Lady", last_name: "Grey" });
assert.deepEqual(nameOf("Sir & Dame Jones"), { first_name: "Sir & Dame", last_name: "Jones" });
assert.deepEqual(nameOf("Rev and Mrs Smith"), { first_name: "Rev and Mrs", last_name: "Smith" });
assert.deepEqual(nameOf("Ms. & Mr. Brown"), { first_name: "Ms. & Mr.", last_name: "Brown" });
assert.deepEqual(nameOf("Mr and Mrs John Smith"), { first_name: "John", last_name: "Smith" });
assert.equal(splitName("Mr and Mrs John Smith").title, "Mr and Mrs");

for (const title of ["Mr", "Mrs", "Ms", "Miss", "Mx", "Dr", "Prof", "Rev", "Sir", "Dame", "Lady", "Lord"]) {
  assert.deepEqual(nameOf(`${title} Jane Smith`), { first_name: "Jane", last_name: "Smith" }, title);
  assert.deepEqual(nameOf(`${title}. Jane Smith`), { first_name: "Jane", last_name: "Smith" }, `${title}.`);
  assert.deepEqual(nameOf(`${title.toLowerCase()} Jane Smith`), { first_name: "Jane", last_name: "Smith" }, title.toLowerCase());
  assert.deepEqual(nameOf(title), { first_name: null, last_name: "-" }, `${title} only`);
  assert.deepEqual(nameOf(`${title}.`), { first_name: null, last_name: "-" }, `${title}. only`);
}

assert.deepEqual(nameOf("Dr.Jane McDonald"), { first_name: "Jane", last_name: "McDonald" });
assert.deepEqual(nameOf("Prof. Sir David Attenborough"), { first_name: "David", last_name: "Attenborough" });
assert.deepEqual(nameOf("Miss Anne"), { first_name: "Anne", last_name: "-" });
assert.deepEqual(nameOf("Anna Ms Smith"), { first_name: "Anna", last_name: "Ms Smith" });
assert.deepEqual(nameOf("Mr and Mrs"), { first_name: null, last_name: "-" });

assert.deepEqual(ghlNameParts("Mr and Mrs Smith"), { firstName: "Mr and Mrs", lastName: "Smith" });
assert.deepEqual(ghlNameParts("Mr & Mrs Smith"), { firstName: "Mr & Mrs", lastName: "Smith" });
assert.deepEqual(ghlNameParts("John Smith"), { firstName: "John", lastName: "Smith" });
assert.deepEqual(ghlNameParts("Madonna"), { firstName: "Madonna", lastName: "" });
assert.deepEqual(ghlNameParts("李"), { firstName: "李", lastName: "" });

assert.equal(greetingName("José"), "José");
assert.equal(greetingName("josé"), "José");
assert.equal(greetingName("李"), "李");
assert.equal(greetingName("Jo\u0000sé"), "José");
assert.equal(greetingName("<b>José</b>"), "José");
assert.equal(greetingName("<script>alert(1)</script>"), "");
assert.equal(greetingName("mary"), "Mary");
assert.equal(thanksName("Mr and Mrs Smith"), "Mr and Mrs Smith");
assert.equal(thanksName("Mr & Mrs Smith"), "Mr & Mrs Smith");
assert.equal(thanksName("Dr and Mrs Smith"), "Dr and Mrs Smith");
assert.equal(thanksName("John Smith"), "John");
assert.equal(thanksName("José"), "José");
assert.equal(thanksName("李"), "李");

function thanks(full) {
  const html = familyEnquiryEmail({ name: full, email: "a@example.com", enquiryTypeLabel: "Question" }).html;
  const heading = html.match(/<h1[^>]*>([^<]+)<\/h1>/);
  return heading ? heading[1] : "";
}

assert.equal(thanks("Mr and Mrs Smith"), "Thank you, Mr and Mrs Smith.");
assert.equal(thanks("Mr & Mrs Smith"), "Thank you, Mr &amp; Mrs Smith.");
assert.equal(thanks("Dr and Mrs Smith"), "Thank you, Dr and Mrs Smith.");
assert.equal(thanks("John Smith"), "Thank you, John.");
assert.equal(thanks("Madonna"), "Thank you, Madonna.");
assert.equal(thanks("José"), "Thank you, José.");
assert.equal(thanks("李"), "Thank you, 李.");
assert.equal(thanks("Mr."), "Thank you.");
assert.equal(thanks("Jo\u0000sé"), "Thank you, José.");
assert.doesNotMatch(thanks("José <script>alert(1)</script>"), /<script>/);

const org = "org";
const email = "ada@example.com";
assert.equal(validateSubmission({ channel: "contact", firstName: "Ada", lastName: "Lovelace", email }, org).data.name, "Ada Lovelace");
assert.equal(validateSubmission({ channel: "contact", first_name: "John", last_name: "Smith", email }, org).data.name, "John Smith");
assert.equal(validateSubmission({ channel: "contact", name: "   ", firstName: "Ada", lastName: "Lovelace", email }, org).data.name, "Ada Lovelace");
assert.equal(validateSubmission({ channel: "contact", name: "Kept Name", firstName: "Other", lastName: "Person", email }, org).data.name, "Kept Name");
assert.equal(validateSubmission({ channel: "contact", email }, org).ok, false);
assert.equal(validateSubmission({ channel: "contact", firstName: "A".repeat(121), email }, org).ok, false);
assert.deepEqual(nameOf(validateSubmission({ channel: "contact", firstName: "John", lastName: "Smith", email }, org).data.name), { first_name: "John", last_name: "Smith" });

async function postedName(person) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method || "GET", body: init.body ? JSON.parse(init.body) : null });
    if (String(url).endsWith("/contacts/")) return Response.json({ contact: { id: "new-1" } });
    return Response.json({ customFields: [] });
  };
  const id = await createGHLContact(
    { GHL_API_KEY: "t", GHL_LOCATION_ID: "split-test" },
    { name: person, email: "m@example.com", type: "enquiry", fetchImpl },
  );
  assert.equal(id, "new-1");
  return calls.find((call) => call.method === "POST" && call.url.endsWith("/contacts/")).body;
}

let body = await postedName("Mr and Mrs Smith");
assert.equal(body.firstName, "Mr and Mrs");
assert.equal(body.lastName, "Smith");
assert.equal(body.title, undefined);
assert.equal(body.salutation, undefined);

body = await postedName("Madonna");
assert.equal(body.firstName, "Madonna");
assert.equal(body.lastName, "");

body = await postedName("John Smith");
assert.equal(body.firstName, "John");
assert.equal(body.lastName, "Smith");

console.log("split-name: ok");
