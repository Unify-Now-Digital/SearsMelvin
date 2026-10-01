import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolveOrderTypeAfterDeposit } from "../functions/api/order-type-after-deposit.js";

assert.equal(resolveOrderTypeAfterDeposit("quote"), "New Memorial");
assert.equal(resolveOrderTypeAfterDeposit("Quote"), "New Memorial");
assert.equal(resolveOrderTypeAfterDeposit("QUOTE"), "New Memorial");
assert.equal(resolveOrderTypeAfterDeposit(""), "New Memorial");
assert.equal(resolveOrderTypeAfterDeposit(null), "New Memorial");
assert.equal(resolveOrderTypeAfterDeposit(undefined), "New Memorial");
assert.equal(resolveOrderTypeAfterDeposit("New Memorial"), "New Memorial");
assert.equal(resolveOrderTypeAfterDeposit("Renovation"), "Renovation");
assert.equal(resolveOrderTypeAfterDeposit("Kerb Set"), "Kerb Set");

const webhook = readFileSync(new URL("../functions/api/stripe-webhook.js", import.meta.url), "utf8");
assert.ok(
  webhook.includes("flipQuoteOrderTypeAfterDeposit"),
  "stripe-webhook must call flipQuoteOrderTypeAfterDeposit after deposit_paid",
);
assert.ok(
  webhook.includes('from "./order-type-after-deposit.js"'),
  "stripe-webhook must import order-type-after-deposit helper",
);

console.log("order-type-after-deposit: ok");
