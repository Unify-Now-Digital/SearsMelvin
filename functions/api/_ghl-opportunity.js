/**
 * GoHighLevel opportunity upsert for website submissions.
 *
 * Rule (Arin, 8 Oct 2026): a won SM opportunity carries the full order value
 * excluding the permit fee and is human-owned. Nothing automated may rewrite
 * it, and a returning paid customer must not get a second card.
 *
 * Before this module, the site searched only OPEN opportunities. A customer
 * whose order was already won therefore looked brand new, and their next quote
 * form created a fresh New card at the website guide price. That's how a paid
 * customer ended up with a duplicate open 'The Charnwood' card on 1 Oct 2026,
 * inflating the pipeline.
 *
 * Now:
 *   - the contact has ANY won opportunity → no opportunity is created or
 *     updated. The contact gets the `returning-customer-enquiry` tag and a note
 *     describing the new enquiry, for a person to pick up.
 *   - else an open opportunity exists → update it in place (unchanged
 *     behaviour: stage preserved, so one contact submitting several configs
 *     still produces ONE card).
 *   - else → create a New card (unchanged).
 *
 * Underscore prefix: helper module, not a route.
 */
const GHL_BASE = "https://services.leadconnectorhq.com";
export const RETURNING_CUSTOMER_TAG = "returning-customer-enquiry";

const statusOf = (o) => String(o?.status ?? "").toLowerCase();

/**
 * Pure decision. `opportunities` is every opportunity on the contact (all
 * statuses), or null when the lookup failed.
 */
export function decideWebsiteOpportunityAction(opportunities) {
  // Fail open: a duplicate card is recoverable, a silently dropped lead is not.
  if (!Array.isArray(opportunities)) return { action: "create", reason: "lookup-failed" };
  const won = opportunities.find((o) => statusOf(o) === "won");
  if (won) {
    return { action: "returning-customer", won: { id: won.id, name: won.name || "" } };
  }
  const open = opportunities.find((o) => statusOf(o) === "open");
  if (open) return { action: "update", existing: { id: open.id, pipelineStageId: open.pipelineStageId } };
  return { action: "create", reason: "no-open-or-won" };
}

/**
 * Every opportunity on this contact, across all statuses. Returns null on any
 * error so the caller can fail open.
 */
export async function findContactOpportunities(env, contactId, pipelineId) {
  const out = [];
  let startAfter, startAfterId;
  try {
    for (let page = 0; page < 5; page++) {
      const params = new URLSearchParams({
        location_id: env.GHL_LOCATION_ID,
        contact_id: contactId,
        status: "all",
        limit: "100",
      });
      // Pipeline-scoped (from #164): only SM-pipeline cards count.
      if (pipelineId) params.set("pipeline_id", pipelineId);
      if (startAfter != null) params.set("startAfter", String(startAfter));
      if (startAfterId) params.set("startAfterId", startAfterId);
      const res = await fetch(`${GHL_BASE}/opportunities/search?${params}`, {
        headers: { "Authorization": `Bearer ${env.GHL_API_KEY}`, "Version": "2021-07-28" },
      });
      if (!res.ok) return null;
      const body = await res.json();
      const batch = body?.opportunities ?? [];
      out.push(...batch);
      if (batch.length < 100) break;
      startAfter = body?.meta?.startAfter;
      startAfterId = body?.meta?.startAfterId;
      if (startAfter == null && !startAfterId) break;
    }
    return out;
  } catch {
    return null;
  }
}

/** Plain-text contact note for a returning customer's new enquiry. */
export function returningCustomerNote({ won, enquiry = {}, submittedAt = new Date() }) {
  const when = new Date(submittedAt).toISOString().slice(0, 16).replace("T", " ") + " UTC";
  const lines = [
    `Returning customer: new website ${enquiry.type || "enquiry"} (${when}).`,
    `Enquiry: ${enquiry.title || "(untitled)"}`,
  ];
  if (Number(enquiry.guidePrice) > 0) {
    lines.push(`Website guide price: £${Number(enquiry.guidePrice).toFixed(2)} (guide only, not a quote)`);
  }
  if (enquiry.message) lines.push(`Message: ${String(enquiry.message).slice(0, 1000)}`);
  lines.push(
    `This contact already has a won opportunity${won?.name ? ` (${won.name})` : ""}${won?.id ? ` [${won.id}]` : ""}, ` +
    `so no new opportunity was created and the won one was not changed. ` +
    `If this is a genuinely new job, create the opportunity by hand.`,
  );
  return lines.join("\n");
}

/** Tag + note on the contact. Throws if either write failed, so bg() logs it. */
export async function flagReturningCustomer(env, contactId, { won, enquiry, submittedAt }) {
  const headers = {
    "Authorization": `Bearer ${env.GHL_API_KEY}`,
    "Version": "2021-07-28",
    "Content-Type": "application/json",
  };
  const results = await Promise.allSettled([
    fetch(`${GHL_BASE}/contacts/${contactId}/tags`, {
      method: "POST", headers, body: JSON.stringify({ tags: [RETURNING_CUSTOMER_TAG] }),
    }),
    fetch(`${GHL_BASE}/contacts/${contactId}/notes`, {
      method: "POST", headers, body: JSON.stringify({ body: returningCustomerNote({ won, enquiry, submittedAt }) }),
    }),
  ]);
  const failed = results.filter((r) => r.status === "rejected" || !r.value.ok);
  if (failed.length) throw new Error(`GHL returning-customer flag: ${failed.length} of 2 writes failed`);
}

/**
 * Upsert, not create. One contact submitting four quote configurations in a day
 * (which happens — see Annette McDonald, 28–29 Jul 2026) must produce ONE
 * opportunity, not four. On update the existing stage is preserved: a deal
 * already moved to Quoted or Invoiced must not be dragged back by a new
 * submission. A contact with a won opportunity gets a tag + note instead.
 *
 * Returns the decision ({ action, ... }) for logging/tests.
 */
export async function upsertWebsiteOpportunity(env, {
  contactId, name, monetaryValue, pipelineId, defaultStageId, enquiry, submittedAt,
}) {
  const headers = {
    "Authorization": `Bearer ${env.GHL_API_KEY}`,
    "Version": "2021-07-28",
    "Content-Type": "application/json",
  };

  const decision = decideWebsiteOpportunityAction(await findContactOpportunities(env, contactId, pipelineId));

  if (decision.action === "returning-customer") {
    await flagReturningCustomer(env, contactId, {
      won: decision.won,
      enquiry: { title: name, guidePrice: monetaryValue, ...enquiry },
      submittedAt,
    });
    return decision;
  }

  if (decision.action === "update") {
    // From #164: never overwrite a known value with £0 (enquiry/appointment
    // submissions send 0), and never touch status: the card is already open by
    // lookup, and forcing "open" could reopen a card won/lost in the meantime.
    const update = {
      pipelineId,
      pipelineStageId: decision.existing.pipelineStageId || defaultStageId,
      name,
    };
    const value = Number(monetaryValue);
    if (Number.isFinite(value) && value > 0) update.monetaryValue = value;
    const res = await fetch(`${GHL_BASE}/opportunities/${decision.existing.id}`, {
      method: "PUT",
      headers,
      body: JSON.stringify(update),
    });
    if (!res.ok) throw new Error(`GHL Opportunity update returned ${res.status}`);
    return decision;
  }

  const res = await fetch(`${GHL_BASE}/opportunities/`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      pipelineId,
      pipelineStageId: defaultStageId,
      locationId: env.GHL_LOCATION_ID,
      contactId, name,
      monetaryValue: monetaryValue || 0,
      source: "Website",
      status: "open",
    }),
  });
  if (!res.ok) throw new Error(`GHL Opportunity returned ${res.status}`);
  return decision;
}
