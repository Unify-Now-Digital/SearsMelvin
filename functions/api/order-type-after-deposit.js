/**
 * After deposit/full payment, orders.order_type must not remain 'quote'.
 * Legacy portal quotes were stored as order_type='quote'; payment used to
 * flip only stage → deposit_paid and leave the type stuck.
 *
 * @param {unknown} currentType
 * @returns {'New Memorial' | string} New Memorial when quote/empty; otherwise unchanged non-quote type
 */
export function resolveOrderTypeAfterDeposit(currentType) {
  if (currentType == null) return "New Memorial";
  const trimmed = String(currentType).trim();
  if (trimmed === "") return "New Memorial";
  if (trimmed.toLowerCase() === "quote") return "New Memorial";
  return trimmed;
}

/**
 * Idempotent: only rows still typed quote get New Memorial.
 * Safe to call after every deposit_paid patch.
 */
export async function flipQuoteOrderTypeAfterDeposit(env, sbHeaders, orderId) {
  if (!orderId || !env.SUPABASE_URL || !env.SM_ORG_ID) return;
  try {
    const res = await fetch(
      `${env.SUPABASE_URL}/rest/v1/orders?id=eq.${encodeURIComponent(orderId)}` +
        `&organization_id=eq.${encodeURIComponent(env.SM_ORG_ID)}` +
        `&order_type=eq.quote`,
      {
        method: "PATCH",
        headers: { ...sbHeaders, Prefer: "return=minimal" },
        body: JSON.stringify({ order_type: "New Memorial" }),
      },
    );
    if (!res.ok) {
      console.error(JSON.stringify({ message: "order_type_flip_failed", status: res.status }));
    }
  } catch {
    console.error(JSON.stringify({ message: "order_type_flip_unavailable" }));
  }
}
