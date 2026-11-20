import { onRequest as continueRequest } from "./_internal-paths.js";
import { legacyQueryRedirect } from "./_public-redirects.js";

export async function onRequest(context) {
  const redirect = legacyQueryRedirect(context.request);
  if (redirect) return redirect;
  return continueRequest(context);
}
