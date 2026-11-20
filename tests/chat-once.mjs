// One chat per tab visit. A Turnstile retry can be many seconds after the first
// beforeSubmit, so the hook must not rely on a short timer.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import vm from "node:vm";

function hookSource(file) {
  const html = readFileSync(file, "utf8");
  const start = html.indexOf("var chatCounted = false;");
  const end = html.indexOf("function hookChat");
  assert.ok(start > 0 && end > start, `${file}: chat once-per-visit hook missing`);
  return html.slice(start, end);
}

const files = execSync("git grep -l 'function chatSubmitted' -- '*.html'").toString().trim().split("\n").filter(Boolean);
assert.ok(files.length > 0);
const canonical = hookSource(files[0]);
for (const file of files) assert.equal(hookSource(file), canonical, `${file}: chat hook drifted`);

function storage(seed = {}, broken = false) {
  const data = { ...seed };
  return {
    getItem(key) {
      if (broken) throw new Error("blocked");
      return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null;
    },
    setItem(key, value) {
      if (broken) throw new Error("blocked");
      data[key] = String(value);
    },
    dump: data,
  };
}

function load(store) {
  const pushes = [];
  const intents = [];
  const window = {
    dataLayer: { push(event) { pushes.push(event); } },
    SMUpgrades: { clickIntent(kind, contact) { intents.push({ kind, contact }); } },
  };
  const context = { window, sessionStorage: store };
  vm.runInNewContext(`${canonical}\nthis.submit = chatSubmitted;`, context);
  return { submit: context.submit, window, pushes, intents, store };
}

{
  const store = storage();
  const page = load(store);
  assert.equal(page.submit({ email: "  PERSON@Example.COM  ", phone: "+44 (0)20 1234-5678" }), true);
  assert.equal(page.window.__smChatEmail, "person@example.com");
  assert.equal(page.window.__smChatPhone, "+4402012345678");
  // The live failure was a second beforeSubmit 8 seconds later, after Turnstile.
  assert.equal(page.submit({ contact: { email: "retry@example.com", phone: "07900 111222" } }), true);
  assert.deepEqual(page.pushes.map((event) => ({ event: event.event })), [
    { event: "sm_chat_submit" },
    { event: "ghl_chat_submission" },
  ]);
  assert.equal(page.intents.length, 1);
  assert.equal(page.intents[0].kind, "chat");
  assert.equal(page.intents[0].contact.email, "  PERSON@Example.COM  ");
  assert.equal(page.window.__smChatEmail, "retry@example.com");
  assert.equal(page.window.__smChatPhone, "07900111222");
  assert.equal(store.dump.sm_chat_counted, "1");
  for (const event of page.pushes) assert.deepEqual(Object.keys(event), ["event"]);
}

{
  // A new page in the same tab still sees the flag.
  const page = load(storage({ sm_chat_counted: "1" }));
  assert.equal(page.submit({ email: "again@example.com", phone: "02070000000" }), true);
  assert.deepEqual(page.pushes, []);
  assert.deepEqual(page.intents, []);
  assert.equal(page.window.__smChatEmail, "again@example.com");
  assert.equal(page.window.__smChatPhone, "02070000000");
}

{
  // Storage blocked: the in-memory flag still stops a second attempt on this page.
  const page = load(storage({}, true));
  assert.equal(page.submit({ email: "a@b.co", phone: "" }), true);
  assert.equal(page.submit({ email: "c@d.co" }), true);
  assert.equal(page.pushes.length, 2);
  assert.equal(page.intents.length, 1);
  assert.equal(page.window.__smChatEmail, "c@d.co");
  assert.equal(page.window.__smChatPhone, undefined);
}

{
  const page = load(storage());
  page.window.__smChatEmail = "stale@example.com";
  page.window.__smChatPhone = "123";
  page.submit({});
  assert.equal(page.window.__smChatEmail, undefined);
  assert.equal(page.window.__smChatPhone, undefined);
  assert.equal(page.pushes.length, 2);
  page.submit({ email: "late@example.com" });
  assert.equal(page.pushes.length, 2);
  assert.equal(page.intents.length, 1);
  assert.equal(page.window.__smChatEmail, "late@example.com");
}

console.log("chat-once: ok");
