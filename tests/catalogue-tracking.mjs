// Catalogue list tracking. Pins the dataLayer payloads and the one-push quote rule.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const up = require("../site-upgrades.js");
const memorials = readFileSync("memorials.html", "utf8");
const memorial = readFileSync("memorial.html", "utf8");
const contact = readFileSync("contact.html", "utf8");

const meta = { item_list_name: "Memorials", active_filter: "type:lawn-headstones" };
const cards = [
  { item_id: "prod_castell", item_name: "The Castell", item_category: "Lawn Headstones", slug: "the-castell", index: 1 },
  { item_id: "prod_knaresborough", item_name: "The Knaresborough", item_category: "Lawn Headstones", slug: "the-knaresborough", index: 2 },
];

const list = up.viewItemListEvent(cards, meta);
assert.equal(list.event, "view_item_list");
assert.equal(list.item_list_id, "memorials");
assert.equal(list.item_list_name, "Memorials");
assert.equal(list.active_filter, "type:lawn-headstones");
assert.equal(list.result_count, 2);
assert.deepEqual(list.ecommerce.items.map((item) => item.index), [1, 2]);
assert.equal(list.ecommerce.items[0].item_id, "prod_castell");
assert.equal(list.ecommerce.item_list_id, "memorials");
assert.equal(list.ecommerce.items[0].slug, undefined, "slug stays out of the GA4 item");

const dropped = up.viewItemListEvent([
  { item_id: "ok-id", item_name: "family@example.com", item_category: "Lawn", slug: "ok", index: 1 },
  { item_id: "bad id", item_name: "Nope", item_category: "Lawn", slug: "nope", index: 2 },
  { item_id: "ok-2", item_name: "The Dartmoor", item_category: "Kerb Sets", slug: "the-dartmoor", index: 3 },
], { active_filter: "all" });
assert.equal(dropped.result_count, 1);
assert.equal(dropped.ecommerce.items[0].item_id, "ok-2");
assert.equal(dropped.ecommerce.items[0].index, 3);

const selected = up.selectItemEvent(cards[1], meta);
assert.equal(selected.event, "select_item");
assert.equal(selected.item_id, "prod_knaresborough");
assert.equal(selected.item_name, "The Knaresborough");
assert.equal(selected.item_category, "Lawn Headstones");
assert.equal(selected.index, 2);
assert.equal(selected.item_list_id, "memorials");
assert.equal(selected.active_filter, "type:lawn-headstones");
assert.equal(selected.ecommerce.items.length, 1);
assert.equal(up.selectItemEvent({ item_id: "x", item_name: "a@b.c", item_category: "Lawn", index: 1 }, meta), null);

const filter = up.filterSelectEvent(
  { filter_name: "type", filter_value: "lawn-headstones", selected: true },
  63,
  meta,
);
assert.deepEqual(filter, {
  event: "filter_select",
  filter_name: "type",
  filter_value: "lawn-headstones",
  selected: true,
  result_count: 63,
  item_list_id: "memorials",
  active_filter: "type:lawn-headstones",
});
assert.equal(up.filterSelectEvent({ filter_name: "sort", filter_value: "price-low", selected: true }, 10, meta), null);
assert.equal(up.filterSelectEvent({ filter_name: "type", filter_value: "Lawn Headstones", selected: true }, 10, meta), null);

const collapsed = up.collapseFilterChanges([
  { filter_name: "type", filter_value: "lawn-headstones", selected: true },
  { filter_name: "type", filter_value: "lawn-headstones", selected: false },
  { filter_name: "colour", filter_value: "black", selected: true },
]);
assert.equal(collapsed.length, 2);
assert.equal(collapsed[0].selected, false);
assert.equal(collapsed[1].filter_name, "colour");

const now = 1_700_000_000_000;
const record = up.listContextRecord(cards[0], meta, now);
assert.deepEqual(record, {
  product_id: "prod_castell",
  slug: "the-castell",
  category: "Lawn Headstones",
  list_position: 1,
  item_list_id: "memorials",
  active_filter: "type:lawn-headstones",
  ts: now,
});
assert.equal(up.LIST_CONTEXT_KEY, "sm_list_context");

const quote = { event: "sm_quote_submit", form_id: "quoteForm" };
const matched = up.applyListContext(quote, JSON.stringify(record), { id: "prod_castell", slug: "the-castell" }, now + 1000);
assert.equal(matched, quote, "list context is added to the existing event object");
assert.deepEqual(matched, {
  event: "sm_quote_submit",
  form_id: "quoteForm",
  product_id: "prod_castell",
  category: "Lawn Headstones",
  list_position: 1,
  item_list_id: "memorials",
  active_filter: "type:lawn-headstones",
});
assert.equal(JSON.stringify(matched).includes("@"), false);

const other = { event: "sm_quote_submit", form_id: "quoteForm" };
up.applyListContext(other, JSON.stringify(record), { id: "prod_other", slug: "the-other" }, now + 1000);
assert.deepEqual(other, { event: "sm_quote_submit", form_id: "quoteForm" });

const direct = { event: "sm_quote_submit", form_id: "quoteForm" };
up.applyListContext(direct, null, { id: "prod_castell", slug: "the-castell" }, now);
assert.deepEqual(direct, { event: "sm_quote_submit", form_id: "quoteForm" });

const stale = { event: "sm_quote_submit", form_id: "quoteForm" };
up.applyListContext(stale, JSON.stringify(record), { id: "prod_castell", slug: "the-castell" }, now + up.LIST_CONTEXT_TTL_MS + 1);
assert.deepEqual(stale, { event: "sm_quote_submit", form_id: "quoteForm" });

const poisoned = { event: "sm_quote_submit", form_id: "quoteForm" };
up.applyListContext(poisoned, JSON.stringify({ ...record, category: "ada@example.com", active_filter: "email:ada@example.com" }), { id: "prod_castell" }, now + 5);
assert.equal(poisoned.category, undefined);
assert.equal(poisoned.active_filter, "all");
assert.equal(poisoned.product_id, "prod_castell");

function fnBody(source, name) {
  const start = source.indexOf("function " + name);
  assert.ok(start > -1, name + " missing");
  let depth = 0, seen = false, end = start;
  for (; end < source.length; end++) {
    if (source[end] === "{") { depth++; seen = true; }
    else if (source[end] === "}" && seen && --depth === 0) { end++; break; }
  }
  return source.slice(start, end);
}
for (const name of ["rememberCatalogueCard", "catalogueSelectFromEvent", "flushCatalogueTrack"]) {
  assert.doesNotMatch(fnBody(memorials, name), /preventDefault/, name + " must not block navigation");
}
assert.match(memorials, /catalogueGrid\.addEventListener\('click', catalogueSelectFromEvent, true\)/);
assert.match(memorials, /catalogueGrid\.addEventListener\('auxclick', catalogueSelectFromEvent, true\)/);
assert.match(memorials, /catalogueGrid\.addEventListener\('pointerdown', rememberCatalogueCard, true\)/);
assert.match(memorials, /onchange="applyFilters\(this\)"/);
assert.match(memorials, /scheduleCatalogueTrack\(\)/);
assert.equal((memorials.match(/event: 'sm_lead_submit'/g) || []).length, 0);

const quotePushes = memorial.match(/event: 'sm_quote_submit'/g) || [];
assert.equal(quotePushes.length, 1, "memorial.html pushes sm_quote_submit from one literal");
const qOk = memorial.slice(memorial.indexOf("if (result.ok) {", memorial.indexOf("channel:  'quote'")));
const qPush = qOk.slice(0, qOk.indexOf("quoteForm').style.display = 'none'"));
assert.equal((qPush.match(/dataLayer\.push\(/g) || []).length, 1, "confirmed quote pushes once");
assert.ok(qPush.includes("event: 'sm_quote_submit'"));
assert.equal((qPush.match(/sm_lead_submit/g) || []).length, 0, "a quote must not also push the lead event");

const leadPushes = contact.match(/event: 'sm_lead_submit'/g) || [];
assert.equal(leadPushes.length, 1);
const cOk = contact.slice(contact.indexOf("if (result.ok) {"));
const cPush = cOk.slice(0, cOk.indexOf("contactForm').style.display = 'none'"));
assert.equal((cPush.match(/dataLayer\.push\(/g) || []).length, 1, "confirmed contact lead pushes once");
assert.doesNotMatch(cPush, /product_id|list_position|sm_list_context/);

assert.match(readFileSync("docs/TRACKING.md", "utf8"), /view_item_list/);
assert.match(readFileSync("docs/TRACKING.md", "utf8"), /sm_quote_submit/);
console.log("catalogue-tracking: ok");
