# Partner portal V2 workflow model

> **Deprecated public-site UI.** This document describes the workflow that was
> modelled on this repo's `/partner` page (`partner.html`). That UI is
> deprecated. **`https://partner.searsmelvin.co.uk/` is the only partner
> workspace.** Do not implement new partner features in `partner.html` or in
> the leftover `/api/partner-auth` and `/api/partner-orders` Functions. PR
> #152 (align this public-site portal with the live subdomain app) was closed
> as out of scope for that app. The public site now 301s `/partner` there.

V2 is a read-and-create interface over the existing Sears Melvin data model. It adds no tables, columns, triggers or production-data migrations.

## Existing records used

- `orders` is the commercial and customer-facing anchor.
- `people` remains the canonical person/contact record.
- `jobs.stage` supplies the broad production position when a job record exists.
- `order_permits` and `order_proofs` supply independent approval evidence.
- `invoices` and `order_payments` supply the commercial evidence.
- catalogue products and cemeteries populate the order wizard.

The portal derives seven independent lanes: payment/confirmation, physical-specification pre-approval, formal permit, inscription proof, material, production, and installation. Missing historical records are shown as missing evidence; they are not treated as completed work.

## Confirmed MVP decisions (2026-08-10)

These are operating rules, not assumptions:

1. A quote or enquiry becomes a live order when the required payment is recorded. The payment date starts the timeline communicated to the customer.
2. Payment starts three workstreams in parallel: cemetery physical-specification pre-approval, the formal permit, and inscription proofing.
3. Cemetery pre-approval of the physical memorial specification is the gate for ordering material and starting the internal production timeline. Pre-approval may be obtained by phone or email; the portal must record the outcome, contact/method, timestamp and notes.
4. If the cemetery rejects or requires a change to the physical specification, the order returns to an editable specification state. Every submitted version, decision and resulting change must remain visible in the order activity history.
5. Inscription wording is deliberately excluded from the material-release lock. Proofs can be revised and approved independently until the operational cut-off before lettering/installation.
6. Customer-facing timing continues to be measured from payment, even when cemetery pre-approval delays the internal production start. The internal view must expose that delay rather than silently moving the date.
7. Commercial order value is the invoiced memorial and service value, including add-ons, but excluding cemetery and permit fees passed through to the payer.
8. For the MVP, permit/cemetery fees must use the existing dedicated permit-fee/cost fields and must not be entered as normal additional options. A general line-item fee classification is only needed if other pass-through fee types emerge.

## MVP state flow

```text
Enquiry / quote
      |
      | required payment recorded (customer timeline starts)
      v
Confirmed live order
      |
      +--> Physical-spec pre-approval --> changes required --> revise and resubmit
      |                 |
      |                 +--> approved --> material ready to order --> ordered --> received
      |
      +--> Formal permit --> with family/FD --> submitted --> approved
      |
      +--> Inscription proof v1..n --> sent --> changes requested / approved
                                      (does not block material release)

Material received + production complete + formal installation conditions satisfied
      --> installation scheduled --> installed / completed
```

Every arrow that changes business state should create an activity entry. The current Google sign-in session is mapped to the shared internal partner and does not persist the employee email, so MVP events are attributed only to the **Sears Melvin internal workspace**. Individual attribution must wait for named staff identities.

## Confirmed no-schema MVP implementation

### Operational tracking

- Derive payment confirmation from the existing paid invoice/payment evidence and `jobs.paid_at`; do not create a second order concept.
- Keep formal permit progress in `order_permits`.
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
- Google establishes an individual identity at sign-in, but V2 deliberately does not claim per-user permissions or audit attribution until named staff records exist.
- Sears Melvin can record cemetery physical-specification pre-approval and material ordered/received. Material ordering is blocked unless payment and the latest pre-approval outcome are both recorded.
- Material ordering starts the internal production timeline and acts as the normal physical-specification lock. A later changes-required decision is retained as a visible exception rather than silently rewriting history.
- Proof decisions are disabled by default and remain unavailable to the shared Sears Melvin login.
- Permit upload, named-user permissions and commission settlement are visibly marked as not connected.

## Later architecture changes worth making

Only introduce these once the operational rules are agreed:

1. Named staff identities, branches and scoped roles.
2. Per-order authority for family communication and proof approval.
3. A versioned physical-specification approval record and an auditable material-release event. This must remain independent from versioned inscription proofs.
4. Secure permit-document upload and review states.
5. Named actor attribution on the append-only activity/audit trail for irreversible actions.
6. Explicit commission, VAT, deposit and balance rules.
7. A general invoice-line classification only if the dedicated permit/cemetery fee fields stop covering all pass-through charges.

Until then, the existing schema is sufficient for the V2 internal pilot because the new state transitions use controlled existing fields and append-only order events. Manual phone/off-platform sales-contact history remains explicitly incomplete.
