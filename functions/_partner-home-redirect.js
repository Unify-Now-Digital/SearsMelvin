/** 301 the leftover marketing-site /partner* paths to the real partner desk. */
export const PARTNER_HOME = "https://partner.searsmelvin.co.uk/";

export function redirectToPartnerHome() {
  return new Response(null, {
    status: 301,
    headers: {
      Location: PARTNER_HOME,
      "Cache-Control": "no-store",
    },
  });
}
