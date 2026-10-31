// Backup for internal paths that have no more specific Function.
// More specific routes (/api/*, /memorials/*, /partner*, /sitemap.xml,
// /supabase-config) win. Public HTML and assets are not in _routes.json,
// so this does not run for them.
export { onRequest } from "./_internal-paths.js";
