// Brochure field errors: separate messages, aria link, focus, and clearance above the phone cookie strip.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const up = createRequire(import.meta.url)("../site-upgrades.js");
const html = readFileSync("brochure.html", "utf8");
const css = readFileSync("site-upgrades.css", "utf8");
const js = readFileSync("site-upgrades.js", "utf8");

const formStart = html.indexOf('id="brochureRequest"');
const formEnd = html.indexOf("</form>", formStart);
const form = html.slice(formStart, formEnd);
assert.ok(formStart > -1 && formEnd > formStart);

assert.ok(form.indexOf('id="brochureNameError"') > form.indexOf('id="brochureName"'));
assert.ok(form.indexOf('id="brochureEmail"') > form.indexOf('id="brochureNameError"'));
assert.ok(form.indexOf('id="brochureEmailError"') > form.indexOf('id="brochureEmail"'));
assert.ok(form.indexOf('id="brochureRequestStatus"') < form.indexOf('type="submit"'), "server message sits above the button, not under the cookie strip");
assert.equal(form.includes("Please add your name and email."), false);
assert.match(form, /<label for="brochurePhone">Phone<\/label>/);
assert.equal(form.includes("(optional)"), false);
assert.doesNotMatch(form, /id="brochurePhone"[^>]*\brequired\b/);
assert.equal(up.brochureFieldErrors({ name: "Ada", email: "ada@example.co.uk", phone: "" }).phone, undefined);

assert.deepEqual(up.brochureFieldErrors({ name: "", email: "" }), {
  name: "Please add your name.",
  email: "Please add your email.",
});
assert.deepEqual(up.brochureFieldErrors({ name: "Ada", email: "" }), {
  email: "Please add your email.",
});
assert.deepEqual(up.brochureFieldErrors({ name: "Ada", email: "not-an-email" }), {
  email: "Please enter a valid email address.",
});
assert.equal(up.brochureFieldErrors({ name: "Ada", email: "not-an-email" }).name, undefined);
assert.deepEqual(up.brochureFieldErrors({ name: "Ada", email: "ada@example.co.uk" }), {});

function fakeInput(id) {
  const attrs = {};
  return {
    id,
    attrs,
    focused: false,
    scrolled: false,
    setAttribute(name, value) { attrs[name] = String(value); },
    removeAttribute(name) { delete attrs[name]; },
    focus() { this.focused = true; },
    scrollIntoView() { this.scrolled = true; },
  };
}
function fakeMessage(id) {
  return { id, hidden: true, textContent: "", scrolled: false, scrollIntoView() { this.scrolled = true; }, classList: { toggle() {} } };
}
function fakeForm() {
  const name = fakeInput("brochureName");
  const email = fakeInput("brochureEmail");
  const nameError = fakeMessage("brochureNameError");
  const emailError = fakeMessage("brochureEmailError");
  const nodes = { name, email, brochureNameError: nameError, brochureEmailError: emailError };
  return {
    nodes,
    querySelector(sel) {
      if (sel === '[name="name"]') return name;
      if (sel === '[name="email"]') return email;
      if (sel === "#brochureNameError") return nameError;
      if (sel === "#brochureEmailError") return emailError;
      return null;
    },
  };
}

{
  const form = fakeForm();
  const first = up.paintBrochureErrors(form, up.brochureFieldErrors({ name: "", email: "bad" }));
  assert.equal(first, form.nodes.name);
  assert.equal(form.nodes.name.focused, true);
  assert.equal(form.nodes.name.attrs["aria-invalid"], "true");
  assert.equal(form.nodes.name.attrs["aria-describedby"], "brochureNameError");
  assert.equal(form.nodes.brochureNameError.hidden, false);
  assert.equal(form.nodes.brochureNameError.textContent, "Please add your name.");
  assert.equal(form.nodes.email.attrs["aria-invalid"], "true");
  assert.equal(form.nodes.email.attrs["aria-describedby"], "brochureEmailError");
  assert.equal(form.nodes.brochureEmailError.textContent, "Please enter a valid email address.");
  assert.equal(form.nodes.email.focused, false);
}

{
  const form = fakeForm();
  const first = up.paintBrochureErrors(form, up.brochureFieldErrors({ name: "Ada", email: "not-an-email" }));
  assert.equal(first, form.nodes.email);
  assert.equal(form.nodes.email.focused, true);
  assert.equal(form.nodes.name.attrs["aria-invalid"], undefined);
  assert.equal(form.nodes.brochureNameError.hidden, true);
  assert.equal(form.nodes.brochureEmailError.textContent, "Please enter a valid email address.");
}

{
  let scrolled = 0;
  const card = { getBoundingClientRect() { return { top: 644, bottom: 747, height: 103, left: 0, right: 390 }; } };
  const message = {
    getBoundingClientRect() { return { top: 630, bottom: 660, left: 16, right: 360, height: 30, width: 344 }; },
  };
  const doc = {
    getElementById(id) { return id === "cookieConsent" ? card : null; },
    defaultView: {
      getComputedStyle() { return { display: "block" }; },
      scrollBy(_x, y) { scrolled += y; },
    },
  };
  message.ownerDocument = doc;
  up.liftBrochureMessage(message);
  assert.ok(scrolled >= 28, "a message under the phone strip is scrolled clear");
}

const status = fakeMessage("brochureRequestStatus");
up.showBrochureStatus(status, "Sorry, we could not send that just now. Please try again.", true);
assert.equal(status.hidden, false);
assert.match(status.textContent, /could not send/);
assert.equal(status.scrolled, true);

assert.match(css, /input\[aria-invalid="true"\][\s\S]*border-width:\s*2px/);
assert.match(css, /border-color:\s*var\(--sm-color-error\)/);
assert.match(css, /scroll-margin-top:\s*calc\(var\(--header-height, 80px\) \+ var\(--sm-cookie-stack, 0px\) \+ 12px\)/);
assert.doesNotMatch(css, /--ck-nav/, "the brochure form does not lift for a bottom cookie strip");
assert.match(js, /paintBrochureErrors\(form, fieldErrors\)/);
assert.match(js, /first\.focus\(\)/);
assert.doesNotMatch(js, /Please add your name and email/);

console.log("brochure-field-errors: ok");
