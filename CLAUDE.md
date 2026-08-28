# Sears Melvin Memorials — orientation for AI agents

Static site + Cloudflare Pages Functions for a North London (NW11) memorial
masonry business. Read this before changing anything; it records decisions that
are easy to undo by accident.

Companion doc: `docs/TOOLING-AUDIT.md` — the standing audit register (open
findings, verified-good facts, and a copy-pasteable re-audit playbook). Update
it whenever you audit or fix something in that list.

## Shape of the system

- **Frontend** — hand-written HTML at the repo root, one file per page. No build
  step, no framework, no bundler. `site-globals.js` is shared across pages.
- **Backend** — Cloudflare Pages Functions in `functions/`. Routes:
  `/api/submit` (all public form submissions), `/api/quotes` (customer quote
  edits), `/api/customer-order` (customer portal), `/api/stripe`,
  `/api/stripe-webhook`, `/api/admin`, `/api/upload-photo`, `/api/config`,
  plus `/memorials/:slug` and `/sitemap.xml`. Leftover and **deprecated**
  (do not build on them): `/api/partner-auth`, `/api/partner-orders`. The
  public-site `/partner` UI is retired; see "Deliberate absences".
- **Database** — Supabase project **Mason App** (`bfwohzcugtwbhhxdqgme`), shared
  with a second tenant. **Everything is multi-tenant: scope every query by
  `SM_ORG_ID`.** See "Multi-tenancy" below — this has caused real bugs.
- **Email** — Resend, from `info@searsmelvin.co.uk`. All templates are inline
  HTML string builders in the Function that sends them.
- **CRM** — GoHighLevel (contact + opportunity) as a background side-effect.

## Deliberate absences — do not "restore" these

- **The website does not create or send invoices.** Draft quote invoices and the
  Stripe deposit/full "Pay" buttons were removed in #122 and #125 (May 2026).
  Verified still true on 2026-08-26: no `INV-WEB-` invoice since 19 May, and 27
  website quote orders since with zero invoices attached. Invoices are raised in
  the admin app / Make. Payment-*time* flow (`/api/stripe` +
  `/api/stripe-webhook`) is separate and stays.
- **The public forms do not price permit fees, and do not resolve the cemetery
  against our own table in the browser.** The cemetery field on the product
  quote form and on `/contact` is a plain Google Places autocomplete: it submits
  the chosen name as free text and nothing else. A matcher that mapped the
  Google pick back onto our priced `cemeteries` rows (setting `cemetery_id` and
  a permit fee) was built on 2026-08-26 and removed the same day at the
  business's request. Quotes are guide totals; the permit fee is confirmed by
  the team afterwards. Do not reintroduce client-side cemetery matching or a
  permit-fee line driven by it. The Worker's `lookupCemeteryIdByName` still
  resolves a cemetery server-side where it can — that is separate and stays.
- **ClickUp is not part of this site.** Removed in #135.
- The legacy `sears-melvin-form` Cloudflare Worker is dead and unreferenced
  (see the audit doc). Do not wire anything back to it.
- **The public-site `/partner` UI is deprecated.** Arin Melvin decided
  `https://partner.searsmelvin.co.uk/` is the only partner workspace.
  `searsmelvin.co.uk/partner` 301s there (`_redirects`, plus a thin
  `partner.html` fallback because Cloudflare Pages serves a matching static
  file before `_redirects`). Do not build new partner UI or workflow on
  `partner.html` or the leftover `/api/partner-auth` and `/api/partner-orders`
  Functions; they stay only so this first deprecation PR does not break
  deploys. PR #152 (align this repo's portal with the live subdomain app)
  was closed as out of scope.

## Multi-tenancy

`cemeteries`, `people`, `products`, `orders`, `enquiries`, `invoices` and more
are shared with another tenant. Two real bugs have come from forgetting this:

- `cemeteries` holds ~6 Sears Melvin rows and ~134 belonging to the other
  tenant. A name lookup without `organization_id=eq.${SM_ORG_ID}` can attach the
  wrong cemetery — and the wrong permit fee — to a quote. `tests/security-smoke.mjs`
  asserts every `cemeteries` read in `submit.js` carries the org filter.
- `people` is deliberately **not** org-scoped on lookup: there is a global unique
  index on email, so the person row is shared and the *enquiry* carries the org.
  This is intentional; see the comment on `upsertPerson`.

Use the existing convention:
`const orgFilter = env.SM_ORG_ID ? \`&organization_id=eq.${encodeURIComponent(env.SM_ORG_ID)}\` : "";`

## Security conventions

- Public endpoints call `isSameOriginRequest`, `checkRateLimit` and
  `readBoundedJson` from `functions/api/_security.js`. Keep that shape.
- `validateSubmission` in `submit.js` checks that `product` **is an object** but
  does **not** vet the fields inside it. Anything from `product` that reaches an
  `href`, a URL, or SQL must be re-validated at the point of use — see
  `productPageUrl()` for the pattern.
- The browser holds the Supabase **anon** key (published in ~16 HTML files, by
  design). It must never be able to read anything but the catalogue. Verified
  2026-08-26: `enquiries`, `orders`, `people`, `invoices`, `payments`,
  `activity_logs` all return 0 rows to anon. Re-check after any RLS change —
  the playbook in the audit doc has the one-liner.
- Never put a secret in `/api/config`; it is a public browser payload.

## Working on emails

All templates live next to their sender. Renders are easy to check: extract the
template functions and write HTML to disk, then screenshot with the pre-installed
Chromium (`/opt/pw-browsers/chromium`). Things that bite:

- Email clients block images by default. Give linked images `border="0"` and put
  a colour on the wrapping anchor so alt text isn't default-blue.
- Product links come from `product.slug`, re-validated against
  `^[a-z0-9-]{1,120}$`. No slug → render unlinked, never a broken link.
- Business copy goes to `BUSINESS_EMAIL`; customer copy needs an address to
  exist (phone-only submissions are legal).

## Testing

No package.json, no test runner. Tests are standalone Node scripts:

```
for f in tests/*.mjs; do node "$f" || echo "FAIL $f"; done
```

They mock `globalThis.fetch` and drive the real exported handlers. Add to them
rather than starting a new pattern. When you add a test, confirm it actually
fails without your change before trusting it.

## Migrations

`migrations/*.sql`, applied by hand — there is no runner and no state table.
A file in this directory is **not** proof it has been applied. Say so explicitly
in the file header when it hasn't been.

## Deploying

Cloudflare Pages builds from `main`. Branch, PR, and let a human merge; the
designated working branch is set per task. Env vars live in the Pages dashboard,
never in `wrangler.jsonc`.
