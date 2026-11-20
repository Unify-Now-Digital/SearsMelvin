/**
 * /areas and /areas/<borough>. More specific than functions/[[path]].js.
 * Unknown paths under /areas redirect to the catalogue.
 */

import { handleAreaRequest } from "../_area-pages.js";

export function onRequest(context) {
  return handleAreaRequest(context);
}
