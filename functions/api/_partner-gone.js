import { hardenedJson } from "./_security.js";

export const PARTNER_MOVED = {
  ok: false,
  error: "Moved. Use https://partner.searsmelvin.co.uk",
};

export function partnerGone() {
  return hardenedJson(PARTNER_MOVED, 410);
}
