/**
 * Retired marketing-site partner orders API.
 *
 * The live desk is https://partner.searsmelvin.co.uk (SearsMelvin-Partner).
 * Do not restore a portal here and do not proxy to that Worker.
 */

import { partnerGone } from "./_partner-gone.js";

export function onRequest() {
  return partnerGone();
}
