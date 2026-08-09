# Partner portal V2 workflow model

V2 is a read-and-create interface over the existing Sears Melvin data model. It adds no tables, columns, triggers or production-data migrations.

## Existing records used

- `orders` is the commercial and customer-facing anchor.
- `people` remains the canonical person/contact record.
- `jobs.stage` supplies the broad production position when a job record exists.
- `order_permits` and `order_proofs` supply independent approval evidence.
- `invoices` and `order_payments` supply the commercial evidence.
- catalogue products and cemeteries populate the order wizard.

The portal derives seven independent lanes: specification, permit, proof, material decision, production, installation handoff, and invoice/payment. Missing historical records are shown as missing evidence; they are not treated as completed work.

## Safety boundaries

- The Sears Melvin workspace sees non-test orders for the configured organisation where `partner_id` is null or the Sears Melvin internal partner ID.
- Orders belonging to other funeral-director partners are excluded.
- External partner workspaces remain restricted to their own partner ID.
- Sears Melvin staff authenticate with a verified `searsmelvin.co.uk` Google Workspace identity and are mapped to the existing internal partner record; funeral-director partners retain one-time email links.
- Google establishes an individual identity at sign-in, but V2 deliberately does not claim per-user permissions or audit attribution until named staff records exist.
- Material readiness is advisory. V2 cannot order material or lock a specification.
- Proof decisions are disabled by default and remain unavailable to the shared Sears Melvin login.
- Permit upload, named-user permissions and commission settlement are visibly marked as not connected.

## Later architecture changes worth making

Only introduce these once the operational rules are agreed:

1. Named staff identities, branches and scoped roles.
2. Per-order authority for family communication and proof approval.
3. Versioned specification approval and an auditable material-release event.
4. Secure permit-document upload and review states.
5. An append-only activity/audit trail for irreversible actions.
6. Explicit commission, VAT, deposit and balance rules.

Until then, the existing schema is sufficient for the V2 internal pilot because all new workflow states are derived and read-only.
