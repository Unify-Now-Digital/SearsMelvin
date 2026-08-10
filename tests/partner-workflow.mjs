import assert from "node:assert/strict";

import { deriveWorkflow } from "../functions/api/partner-orders.js";

const baseOrder = {
  person_name: "Melvin Example",
  product_id: "00000000-0000-4000-8000-000000000001",
  cemetery_id: "00000000-0000-4000-8000-000000000002",
  status: "submitted",
  stone_status: "NA",
  permit_status: "pending",
  proof_status: "not_started",
  jobs: null,
};

const missingEvidence = deriveWorkflow(baseOrder);
assert.equal(missingEvidence.specification.state, "blocked");
assert.equal(missingEvidence.permit.state, "attention");
assert.equal(missingEvidence.proof.state, "not_started");
assert.equal(missingEvidence.material.state, "blocked");
assert.equal(missingEvidence.material.actionAvailable, false);
assert.equal(missingEvidence.materialLockEnforced, false);
assert.equal(missingEvidence.materialDecisionReady, false);

const paidAndPreapproved = deriveWorkflow(
  baseOrder,
  { state: "changes_requested", render_url: "https://example.test/proof.png" },
  { permit_phase: "pending" },
  [{ id: "invoice-1", status: "paid", paid_at: "2026-08-01T09:00:00Z" }],
  [],
  { mode: "internal", proofDecisionEnabled: false },
  [{ event_type: "spec_preapproval_approved", created_at: "2026-08-02T10:00:00Z" }],
);
assert.equal(paidAndPreapproved.permit.state, "attention");
assert.equal(paidAndPreapproved.proof.state, "attention");
assert.equal(paidAndPreapproved.specification.state, "complete");
assert.equal(paidAndPreapproved.material.state, "decision_required");
assert.equal(paidAndPreapproved.materialDecisionReady, true);
assert.equal(paidAndPreapproved.material.actionAvailable, true);

const preapprovedButUnpaid = deriveWorkflow(
  baseOrder,
  null,
  null,
  [],
  [],
  { mode: "internal", proofDecisionEnabled: false },
  [{ event_type: "spec_preapproval_approved", created_at: "2026-08-02T10:00:00Z" }],
);
assert.equal(preapprovedButUnpaid.paymentConfirmed, false);
assert.equal(preapprovedButUnpaid.material.state, "blocked");
assert.equal(preapprovedButUnpaid.materialDecisionReady, false);

const inProduction = deriveWorkflow({
  ...baseOrder,
  stone_status: "In Stock",
  jobs: { stage: "in_production", stage_status: "active" },
});
assert.equal(inProduction.material.state, "complete");
assert.equal(inProduction.production.state, "in_progress");
assert.equal(inProduction.installation.state, "blocked");

const paid = deriveWorkflow(
  baseOrder,
  null,
  null,
  [{ id: "invoice-1", status: "issued", stripe_status: "paid" }],
);
assert.equal(paid.commercial.state, "complete");
assert.equal(paid.paymentConfirmed, true);
assert.equal(paid.material.state, "blocked");

const postCommitException = deriveWorkflow(
  { ...baseOrder, stone_status: "Ordered", jobs: { stage: "in_production", paid_at: "2026-08-01T09:00:00Z" } },
  null,
  null,
  [],
  [],
  { mode: "internal", proofDecisionEnabled: false },
  [{ event_type: "spec_preapproval_changes_required", created_at: "2026-08-03T10:00:00Z" }],
);
assert.equal(postCommitException.material.state, "attention");
assert.equal(postCommitException.material.exception, true);

const proofDecision = deriveWorkflow(
  baseOrder,
  { state: "sent", render_url: "https://example.test/proof.png" },
  null,
  [],
  [],
  { mode: "partner", proofDecisionEnabled: true },
);
assert.equal(proofDecision.proof.decisionAvailable, true);

console.log("partner workflow tests passed");
