# Partner portal V2 workflow model

Live dashboard: **https://partner.searsmelvin.co.uk** (custom domain). `searsmelvin.co.uk/partner` is this repo’s `partner.html`, not the larger unpublished app currently served on the subdomain. This SearsMelvin repo hardens the same partner APIs and UI; it does not replace the live subdomain unless a human points that domain here.

V2 is a read-and-create interface over the existing Sears Melvin data model. It adds no tables, columns, triggers or production-data migrations in the original MVP. The 28 Aug 2026 permit spine adds **enum values only** (see `migrations/2026-08-28-partner-permit-spine.sql`, **not applied**). Existing `permit_phase` rows are mapped in code, not rewritten.

Named staff (Arin / Matthew = admin, Aylin / Karen = operations, other `@searsmelvin.co.uk` = operations) are a static directory in `functions/api/_partner-staff.js`. Google Workspace sign-in still maps onto the **shared internal partner row for order scope**. Named Admin / Operations is chrome and `order_events` attribution only — not a second CMS, not per-user order permissions, and not GoHighLevel.

Magic-link and partner-setup emails land on `https://partner.searsmelvin.co.uk/#login=…` because `__Host-` session cookies are host-locked and will not follow someone from `searsmelvin.co.uk` onto the partner subdomain.

## Live product truth (Arin Admin audit, 28 Aug 2026)

The shipped UI on **https://partner.searsmelvin.co.uk** is ahead of older `partner.html` notes. Treat that audit as current product truth, then apply Arin’s locked exceptions below.

Live desks: Overview, Sales, Permits, Payments, Proofs, Orders, Installation, plus **New memorial**. Named Admin chrome (`Arin`). Orders chips: Confirmed / Needs action / Waiting / Quotes / Complete / All. Confirmed-order drawer lanes: Payment & confirmation, Cemetery specification, Cemetery permit, Design proof, Material decision, Production, Installation handoff.

Live gating (keep the display rules, then unlock what Arin locked):

| Workstream | Live today | This repo after Arin’s lock |
|------------|------------|-----------------------------|
| Cemetery permit + Design proof | Both **blocked** until physical-spec pre-approval | Same blocked display. Spine still visible. Permit steps are **recordable** on the Permits desk without upload. |
| Material | Can already be **Ordered** with a warning if no pre-approval | Same: warn and allow after payment; unpaid still blocked. |
| Spec recording | Confirmed orders only; quotes locked until payment | **Unlock spec-before-pay.** Staff can Record cemetery contact / Record pre-approval update on quotes. |
| Proofs desk | Verify wording / mock-up only. “Recognition never constitutes customer approval.” No staff Approve. Owner: **Authorised approver**. | Keep the verify copy and owner chip. **Internal Admin can Approve proof.** |
| Permits | Drawer: “Permit status: Select form”; “Direct stage editing is disabled…”; link to Permit desk. Desk hung loading. Collapsed family → submitted → approved in places. | Visible **7-step spine** on Permits desk, recordable, no upload, no hang (renders from already-loaded orders). Do not collapse to with-family → submitted → approved. |
| Wizard | Final button **Create quote record**. Accounts must still issue the invoice. No Request payment on the wizard. | Same. Request payment stays a **separate** action on the quote. No customer email. |
| Payments desk | Stripe-synced, read-only, does not create or send invoices. Confirmed orders can show “No invoice has been issued” while also payment-confirmed. | Stripe-recorded payment **starts the live clock**. Missing invoice row ≠ unpaid. |

Constraints still in force: no customer email sends, no GHL writes, no live payment charging, no permit file upload.

## Existing records used

- `orders` is the commercial and customer-facing anchor.
- `people` remains the canonical person/contact record.
- `jobs.stage` supplies the broad production position when a job record exists.
- `order_permits` and `order_proofs` supply independent approval evidence.
- `invoices` and the website `payments` ledger (plus `order_payments` when present) supply the commercial evidence.
- catalogue products and cemeteries populate the order wizard.

The portal derives seven independent lanes: payment/confirmation, physical-specification pre-approval, formal permit, inscription proof, material, production, and installation. Missing historical records are shown as missing evidence; they are not treated as completed work.

## Locked operating rules (2026-08-28)

Arin Melvin locked this process on 28 Aug 2026. Where it conflicts with the 10 Aug MVP notes below, **this section wins**.

1. **Stripe payment starts the live clock.** As soon as Stripe records payment, the partner UI must treat the order as paid/confirmed. There is no second manual Mason tick.
   - Website webhook writes `invoices.status` `partial` (deposit) or `completed` (full), a `payments` row, `orders.status` / `orders.stage=deposit_paid`. It does **not** write `order_payments`.
   - `deriveWorkflow` therefore treats invoice `partial` / `completed` / `paid`, `payments` ledger rows, `orders.stage=deposit_paid`, `orders.status` partial/completed, and `jobs.paid_at` as `paymentConfirmed`.
   - The webhook now also sets `invoices.paid_at` / `payment_date` and `jobs.paid_at` when the job is known, so both writers agree.

2. **Spec check with the cemetery can and usually should start before payment.** Recording `spec_preapproval_*` is not blocked on `paymentConfirmed`. The spec lane is not `blocked` solely because the order is unpaid.

3. **Material can be ordered before inscription wording is signed, and with a warning before cemetery spec pre-approval.** Proof does not block material. Live already allows Ordered with a warning if no pre-approval is on file. Payment is still required. Proof and permit remain installation gates.

4. **Permit is a seven-step operational spine on the Permits desk** (human labels, not jargon). The order drawer shows `Permit status: {current step}` and links “Open this permit in Permit desk”. Staff record progress without upload; funeral directors can see status. Do not collapse to with-family → submitted → approved. As a **workstream**, cemetery permit stays blocked until spec pre-approval, but steps remain visible and recordable.

5. **Internal Admin can Approve proof.** The Proofs desk still verifies wording / mock-up brief and says recognition never constitutes customer approval. Owner chip remains **Authorised approver**. Arin locked staff approval for named Admin. Funeral-director proof decisions stay behind `PARTNER_PROOF_DECISIONS_ENABLED`.

6. **Create quote record and Request payment are two controls.** The wizard final button is **Create quote record** (Accounts must still issue the invoice). There is no Request payment control on the wizard. Request payment is a separate action on the quote. This website still does not create or email invoices. Request payment records `order_events.payment_requested` and may move `jobs.stage` from `enquired`/`quoted` to `invoiced`.

7. **Funeral directors must not see other customers' orders.** Internal staff use Google Workspace mapped to the Sears Melvin partner record. Named chrome does not widen order scope.

### Permit spine — stored values and old → new display map

Canonical write target: `order_permits.permit_phase` (legacy display: `orders.permit_status`).

| Step | Human label | Written `permit_phase` | Old values that display here |
|------|-------------|------------------------|------------------------------|
| 1 | Match form | `match_form` | `form_needed`, `pending` |
| 2 | Send to customer | `form_sent` | `with_customer` |
| 3 | Receive back signed from the correct person | `customer_completed` | — |
| 4 | Complete memorial and our details | `completing` | — |
| 5 | Send to cemetery | `submitted` | — |
| 6 | Resolve any issues | `resolve_issues` | `rejected` |
| 7 | Confirm approval | `approved` | `not_required` |

Timestamps already on `order_permits`: `sent_at` (step 2), `returned_at` (step 3), `submitted_at` (step 5), `approved_at` (step 7).

June 2026 live enum (public schema read): `form_needed · with_customer · completing · submitted · approved`. Partner code already also treated `form_sent`, `customer_completed`, `pending`. New writes of `match_form` and `resolve_issues` need `migrations/2026-08-28-partner-permit-spine.sql` applied; until then the dashboard still **displays** old rows via the alias map.

## Confirmed MVP decisions (2026-08-10)

These remain operating rules except where the 28 Aug section above overrides them (spec-before-payment, staff proof decisions, split create vs request-payment, Stripe `partial`/`completed` as paid).

1. A quote or enquiry becomes a live order when the required payment is recorded. The payment date starts the timeline communicated to the customer.
2. After payment, permit and inscription proofing continue in parallel with spec work (spec may already have started).
3. Cemetery pre-approval of the physical memorial specification is the gate for ordering material and starting the internal production timeline. Pre-approval may be obtained by phone or email; the portal must record the outcome, contact/method, timestamp and notes.
4. If the cemetery rejects or requires a change to the physical specification, the order returns to an editable specification state. Every submitted version, decision and resulting change must remain visible in the order activity history.
5. Inscription wording is deliberately excluded from the material-release lock. Proofs can be revised and approved independently until the operational cut-off before lettering/installation.
6. Customer-facing timing continues to be measured from payment, even when cemetery pre-approval delays the internal production start. The internal view must expose that delay rather than silently moving the date.
7. Commercial order value is the invoiced memorial and service value, including add-ons, but excluding cemetery and permit fees passed through to the payer.
8. For the MVP, permit/cemetery fees must use the existing dedicated permit-fee/cost fields and must not be entered as normal additional options. A general line-item fee classification is only needed if other pass-through fee types emerge.

## MVP state flow

```text
Enquiry / quote / created order (no invoice yet)
      |
      +--> Physical-spec pre-approval (may start unpaid) --> changes required --> revise
      |                 |
      |                 +--> approved + payment recorded --> material ready to order
      |
      +--> Request payment (separate action) --> invoice in admin/Make --> Stripe
      |                 |
      |                 +--> payment recorded (customer timeline starts)
      |
      +--> Formal permit spine:
      |      Match form --> Send to customer --> Receive back signed
      |      --> Complete our details --> Send to cemetery
      |      --> Resolve any issues --> Confirm approval
      |
      +--> Inscription proof v1..n --> sent --> changes requested / approved
                                      (does not block material release)

Material received + production complete + permit approved + proof approved
      --> installation scheduled --> installed / completed
```

Every arrow that changes business state should create an activity entry. Google Workspace sign-in is mapped to the shared internal partner for **order scope**. When the session carries a named staff payload, operational events also record `actor_name` / `actor_email` / `actor_role`. Per-user permissions and a second CMS are still out of scope.

## Confirmed no-schema MVP implementation

### Operational tracking

- Derive payment confirmation from paid invoice evidence (`paid`, `partial`, `completed`), website `payments` rows, `jobs.paid_at`, and `orders.stage=deposit_paid`. Do not require `order_payments`.
- Keep formal permit progress in `order_permits`. Staff `update-permit` writes `permit_phase` plus the matching timestamp and mirrors `orders.permit_status`.
- Keep every inscription iteration in `order_proofs`; proof state is not a prerequisite for ordering material.
- Record physical-specification pre-approval and revisions as controlled `order_events` types. Each event detail should contain the specification snapshot, outcome, contact/method, notes and signed-in email.
- Continue to use `orders.stone_status` for `Ordered` and `In Stock`, paired with an `order_events` entry so the change has history.
- Derive the current physical-specification state from the latest relevant event. This avoids a database change for the pilot, but a dedicated versioned record is preferable once the workflow is proven.

### Sales action queue

Use existing `jobs` and inbox-conversation fields to calculate the queue:

1. **SM reply due:** unread conversation, or latest inbound message is newer than latest outbound message.
2. **Promised follow-up overdue/today:** open sales job with `jobs.wake_at` due.
3. **No next action:** open sales job with no `jobs.wake_at`.
4. **Waiting on family/FD:** latest outbound is newer than latest inbound and a future follow-up is scheduled.
5. **Later:** future follow-up is scheduled; show it below today's work.

Show last inbound, last SM contact, next action date, channel/contact preference, stage and value on each row. Treat value as a secondary sort after overdue replies and promised actions. Individual ownership can wait until named staff permissions are introduced.

Current-data caveat: the inbox cannot yet be treated as a complete contact ledger. On 2026-08-10, all 41 open sales jobs had an inbound timestamp, only 2 had an outbound timestamp, and none had `jobs.wake_at` set. The UI must label missing outbound history as **not captured**, not **never contacted**. The first MVP behaviour should therefore be setting/completing the next follow-up; a dependable manual phone/off-platform contact history needs either a proven existing write convention or a later job-activity record.

## Safety boundaries

- The Sears Melvin workspace sees non-test orders for the configured organisation where `partner_id` is null or the Sears Melvin internal partner ID.
- Orders belonging to other funeral-director partners are excluded.
- External partner workspaces remain restricted to their own partner ID.
- Sears Melvin staff authenticate with a verified `searsmelvin.co.uk` Google Workspace identity and are mapped to the existing internal partner record; funeral-director partners retain one-time email links.
- Google establishes an individual identity at sign-in. Named Admin / Operations chrome and activity attribution are now connected for the known Sears Melvin directory; per-user order permissions are still not claimed.
- Sears Melvin can record cemetery physical-specification pre-approval **while unpaid**. After payment, material can be Ordered with a warning if that pre-approval is not yet on file; unpaid material stays blocked.
- Material ordering starts the internal production timeline and acts as the normal physical-specification lock. A later changes-required decision is retained as a visible exception rather than silently rewriting history.
- Proof decisions are **enabled for named Sears Melvin Admin**. Funeral-director proof decisions remain disabled by default (`PARTNER_PROOF_DECISIONS_ENABLED`).
- Permit **upload** is not connected and must stay false. Permit **progress** is writable on the Permits desk without document evidence.
- Named-user permissions and commission settlement remain visibly marked as not connected.
- Create quote record does not POST invoices, call Stripe, send Resend, or touch GoHighLevel.
- The live staff dashboard URL is `https://partner.searsmelvin.co.uk`. Do not treat `searsmelvin.co.uk/partner` as the production dashboard Arin uses.
- Payments desk is Stripe-synced and read-only. A missing invoice row does not unset `paymentConfirmed`.

## Later architecture changes worth making

Only introduce these once the operational rules are agreed:

1. Per-user order permissions, branches and scoped roles (named chrome exists; order scope is still the shared partner row).
2. Per-order authority for family communication and proof approval.
3. A versioned physical-specification approval record and an auditable material-release event. This must remain independent from versioned inscription proofs.
4. Secure permit-document upload and review states — **not** in this change; tracking stays email + status.
5. A dedicated internal-notes store with visibility rules. Operational `order_events` already record named staff on workflow actions.
6. Explicit commission, VAT, deposit and balance rules.
7. A general invoice-line classification only if the dedicated permit/cemetery fee fields stop covering all pass-through charges.
8. Raising invoices from this website, if accounts ever want Request payment to do more than the admin app / Make.

Until then, the existing schema is sufficient for the V2 internal pilot because the new state transitions use controlled existing fields and append-only order events. Manual phone/off-platform sales-contact history remains explicitly incomplete.
