import { redirectToPartnerHome } from "../_partner-home-redirect.js";

export function onRequest() {
  return redirectToPartnerHome();
}
