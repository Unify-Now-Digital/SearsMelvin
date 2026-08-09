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
assert.equal(missingEvidence.specification.state, "complete");
assert.equal(missingEvidence.permit.state, "attention");
assert.equal(missingEvidence.proof.state, "not_started");
assert.equal(missingEvidence.material.state, "blocked");
assert.equal(missingEvidence.material.actionAvailable, false);
assert.equal(missingEvidence.materialLockEnforced, false);
assert.equal(missingEvidence.materialDecisionReady, false);

const approvedEvidence = deriveWorkflow(
  baseOrder,
  { state: "approved", approved_at: "2026-08-01T10:00:00Z", render_url: "https://example.test/proof.png" },
  { permit_phase: "approved", approved_at: "2026-08-02T10:00:00Z" },
  [],
  [],
  { mode: "internal", proofDecisionEnabled: false },
);
assert.equal(approvedEvidence.permit.state, "complete");
assert.equal(approvedEvidence.proof.state, "complete");
assert.equal(approvedEvidence.material.state, "decision_required");
assert.equal(approvedEvidence.materialDecisionReady, true);
assert.equal(approvedEvidence.material.actionAvailable, false);

const inProduction = deriveWorkflow({
  ...baseOrder,
  stone_status: "In Stock",
  jobs: { stage: "in_production", stage_status: "active" },
});
assert.equal(inProduction.material.state, "complete");
assert.equal(inProduction.production.state, "in_progress");
assert.equal(inProduction.installation.state, "ready");

const paid = deriveWorkflow(
  baseOrder,
  null,
  null,
  [{ id: "invoice-1", status: "issued", stripe_status: "paid" }],
);
assert.equal(paid.commercial.state, "complete");

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
