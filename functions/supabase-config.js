/**
 * Public browser config for the Supabase publishable key.
 * Route: /supabase-config
 *
 * Pages load this before their inline catalogue scripts. The body is the
 * publishable key (or the legacy anon JWT until that env var is set).
 * Never a secret: publishableKey() refuses sb_secret_ and service_role.
 */

import { supabaseBrowserConfigScript } from "./api/_supabase-keys.js";

export async function onRequestGet({ env }) {
  return new Response(supabaseBrowserConfigScript(env), {
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      "Cache-Control": "public, max-age=60",
      "X-Content-Type-Options": "nosniff",
      "X-Robots-Tag": "noindex",
    },
  });
}
