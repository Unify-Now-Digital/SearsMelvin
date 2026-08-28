import assert from "node:assert/strict";

import { deriveWorkflow, mapPermitPhase, PERMIT_SPINE } from "../functions/api/partner-orders.js";

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
assert.notEqual(missingEvidence.specification.state, "blocked");
assert.equal(missingEvidence.specification.state, "not_started");
assert.equal(missingEvidence.paymentConfirmed, false);
assert.equal(missingEvidence.specification.actionAvailable, false);
assert.equal(missingEvidence.permit.state, "blocked");
assert.equal(missingEvidence.permit.gatedBySpec, true);
assert.equal(missingEvidence.permit.spineKey, "match_form");
assert.equal(missingEvidence.permit.spineLabel, "Match form");
assert.equal(missingEvidence.permit.steps.length, 7);
assert.equal(missingEvidence.proof.state, "blocked");
assert.equal(missingEvidence.proof.gatedBySpec, true);
assert.equal(missingEvidence.material.state, "blocked");
assert.equal(missingEvidence.material.actionAvailable, false);
assert.equal(missingEvidence.materialLockEnforced, false);
assert.equal(missingEvidence.materialDecisionReady, false);

const unpaidInternalSpec = deriveWorkflow(
  baseOrder,
  null,
  null,
  [],
  [],
  { mode: "internal", proofDecisionEnabled: true },
);
assert.equal(unpaidInternalSpec.paymentConfirmed, false);
assert.notEqual(unpaidInternalSpec.specification.state, "blocked");
assert.equal(unpaidInternalSpec.specification.actionAvailable, true);
assert.equal(unpaidInternalSpec.permit.state, "blocked");
assert.equal(unpaidInternalSpec.permit.actionAvailable, true);
assert.equal(unpaidInternalSpec.proof.state, "blocked");
assert.equal(unpaidInternalSpec.proof.decisionAvailable, false);
assert.equal(unpaidInternalSpec.material.actionAvailable, false);

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
assert.equal(preapprovedButUnpaid.specification.state, "complete");
assert.equal(preapprovedButUnpaid.specification.actionAvailable, true);
assert.equal(preapprovedButUnpaid.material.state, "blocked");
assert.equal(preapprovedButUnpaid.materialDecisionReady, false);

const paidWithoutSpec = deriveWorkflow(
  baseOrder,
  { state: "sent", render_url: "https://example.test/proof.png" },
  { permit_phase: "pending" },
  [{ id: "invoice-1", status: "partial", paid_at: "2026-08-01T09:00:00Z" }],
  [],
  { mode: "internal", proofDecisionEnabled: true },
);
assert.equal(paidWithoutSpec.paymentConfirmed, true);
assert.equal(paidWithoutSpec.clockStarted, true);
assert.equal(paidWithoutSpec.permit.state, "blocked");
assert.equal(paidWithoutSpec.permit.actionAvailable, true);
assert.equal(paidWithoutSpec.proof.state, "blocked");
assert.equal(paidWithoutSpec.proof.owner, "authorised_approver");
assert.equal(paidWithoutSpec.proof.decisionAvailable, true);
assert.equal(paidWithoutSpec.material.state, "decision_required");
assert.equal(paidWithoutSpec.material.warning, true);
assert.equal(paidWithoutSpec.material.actionAvailable, true);
assert.equal(paidWithoutSpec.materialDecisionReady, false);

const paidNoInvoiceRow = deriveWorkflow(
  { ...baseOrder, stage: "deposit_paid", jobs: { paid_at: "2026-08-28T09:00:00Z" } },
);
assert.equal(paidNoInvoiceRow.paymentConfirmed, true);
assert.equal(paidNoInvoiceRow.clockStarted, true);
assert.equal(paidNoInvoiceRow.invoiceIssued, false);
assert.match(paidNoInvoiceRow.commercial.summary, /live clock/);

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
assert.equal(paid.material.state, "decision_required");
assert.equal(paid.material.warning, true);

const stripePartial = deriveWorkflow(
  baseOrder,
  null,
  null,
  [{ id: "invoice-stripe", status: "partial", payment_method: "Stripe" }],
);
assert.equal(stripePartial.paymentConfirmed, true);
assert.equal(stripePartial.commercial.state, "complete");

const stripeCompleted = deriveWorkflow(
  { ...baseOrder, status: "completed", stage: "deposit_paid" },
);
assert.equal(stripeCompleted.paymentConfirmed, true);

const stripeLedger = deriveWorkflow(
  baseOrder,
  null,
  null,
  [{ id: "invoice-2", status: "issued" }],
  [{ status: "paid", source: "payments", received_at: "2026-08-28T10:00:00Z" }],
);
assert.equal(stripeLedger.paymentConfirmed, true);
assert.equal(stripeLedger.confirmedAt, "2026-08-28T10:00:00Z");

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

const internalProof = deriveWorkflow(
  baseOrder,
  { state: "sent" },
  null,
  [],
  [],
  { mode: "internal", proofDecisionEnabled: true },
);
assert.equal(internalProof.proof.decisionAvailable, true);

const installReady = deriveWorkflow(
  { ...baseOrder, stone_status: "In Stock", jobs: { stage: "in_production", paid_at: "2026-08-01T09:00:00Z" } },
  { state: "approved", approved_at: "2026-08-04T10:00:00Z" },
  { permit_phase: "approved", approved_at: "2026-08-05T10:00:00Z" },
  [{ id: "invoice-1", status: "partial" }],
  [],
  { mode: "internal", proofDecisionEnabled: true },
);
assert.equal(installReady.installation.state, "ready");
assert.equal(installReady.material.state, "complete");

const installBlockedWithoutProof = deriveWorkflow(
  { ...baseOrder, stone_status: "In Stock", jobs: { stage: "in_production", paid_at: "2026-08-01T09:00:00Z" } },
  { state: "sent", render_url: "https://example.test/proof.png" },
  { permit_phase: "approved", approved_at: "2026-08-05T10:00:00Z" },
  [{ id: "invoice-1", status: "partial" }],
);
assert.equal(installBlockedWithoutProof.installation.state, "blocked");
assert.equal(installBlockedWithoutProof.material.state, "complete");

assert.deepEqual(PERMIT_SPINE.map((step) => step.label), [
  "Match form",
  "Send to customer",
  "Receive back signed from the correct person",
  "Complete memorial and our details",
  "Send to cemetery",
  "Resolve any issues",
  "Confirm approval",
]);

const aliasChecks = [
  ["pending", "match_form", "Match form"],
  ["form_needed", "match_form", "Match form"],
  ["form_sent", "send_to_customer", "Send to customer"],
  ["with_customer", "send_to_customer", "Send to customer"],
  ["customer_completed", "receive_signed", "Receive back signed from the correct person"],
  ["completing", "complete_details", "Complete memorial and our details"],
  ["submitted", "send_to_cemetery", "Send to cemetery"],
  ["resolve_issues", "resolve_issues", "Resolve any issues"],
  ["rejected", "resolve_issues", "Resolve any issues"],
  ["approved", "confirm_approval", "Confirm approval"],
];
for (const [stored, key, label] of aliasChecks) {
  const mapped = mapPermitPhase(stored);
  assert.equal(mapped.step.key, key, stored);
  assert.equal(mapped.step.label, label, stored);
}

const approvedSpine = mapPermitPhase("approved", { permit_phase: "approved", approved_at: "2026-08-05T10:00:00Z" });
assert.equal(approvedSpine.approved, true);
assert.ok(approvedSpine.steps.every((step) => step.state === "complete"));

const issuesAfterStamp = mapPermitPhase("resolve_issues", { permit_phase: "resolve_issues", approved_at: "2026-08-05T10:00:00Z" });
assert.equal(issuesAfterStamp.approved, false);
assert.equal(issuesAfterStamp.steps[5].state, "current");

console.log("partner workflow tests passed");
