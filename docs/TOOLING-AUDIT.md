# Tooling audit register

A standing record of what has been checked across the stack, what is wrong, and
how to re-check it. **Keep this current** — update the status column when you fix
something, and add a dated line to "Verified good" when you confirm a fact, so
the next audit starts from evidence rather than from scratch.

Last full repo sweep: **2026-08-31** (SM public cemetery/mobile paths).
Earlier Cloudflare/Supabase/GitHub sweep: **2026-08-26**.

---

## Open findings

| # | Severity | Area | Finding | Status |
|---|----------|------|---------|--------|
| 1 | **High** | Supabase RLS | `cemeteries_public_read` is granted to `authenticated`, but the public site uses the **anon** key. Every browser-side cemetery query returns `[]`. | Fix written, **not applied** — `migrations/2026-08-26-fix-public-cemetery-read-and-audit-log.sql` |
| 2 | Medium | Worker code | `lookupCemeteryIdByName` searched all tenants' cemeteries | **Fixed** — org filter added, asserted in `tests/security-smoke.mjs` |
| 3 | Medium | Supabase | `activity_log_write` is SECURITY DEFINER, callable by any signed-in user, and inserts the caller-supplied `p_user_id` without consulting `auth.uid()` — audit-log entries can be attributed to anyone | Fix written, **not applied** — same migration |
| 4 | Medium | Cloudflare | Worker `sears-melvin-form` was live, orphaned, and sent off-brand copy (phone `01268 208 559`, "South London & Beyond", ClickUp) | **Done** — deleted 2026-08-26, confirmed absent from `workers_list` |
| 5 | Medium | Supabase | `create_quote` RPC resolves the cemetery without an org filter (same class as #2) | Open — see note 3 in the migration |
| 6 | Low | Headers | CSP is `Report-Only` with **no** `report-uri`/`report-to`, so it collects nothing and can never graduate to enforced | Open |
| 7 | Low | Headers | `X-Robots-Tag: noindex` was on `/partner*` only | **Fixed** — added to `/admin*` and `/track*` |
| 8 | Low | Worker code | Customer confirmation email was sent to an empty address on phone-only submissions (Resend 400, swallowed) | **Fixed** |
| 9 | Low | Frontend | The Supabase anon key is hardcoded in **16** HTML files; rotating it means 16 edits. `site-globals.js` already loads everywhere and is the natural home. It is also a legacy JWT anon key rather than a publishable key. | Open |
| 10 | Low | Cloudflare | `round-violet-3531` and `cool-dawn-8e53` are empty placeholder Workers from a quickstart | Open — safe to delete |
| 11 | Low | GitHub | 15 stale remote branches (`agent/*`, `claude/*`, `codex/*`, `cloudflare/*`) | Open |
| 12 | Low | Supabase | Test organisations in production: `New Test Org`, `NEW TEST ORG 2`, `WRITE TEST TARGET`, `Riverside Memorials` | Open |
| 13 | Low | Supabase | Auth leaked-password protection (HaveIBeenPwned) disabled | Open |
| 14 | Low | Supabase perf | 4 duplicate indexes (`order_people` ×3, `inbox_messages` ×1), 37 unindexed FKs, 38 unused indexes, 2 `auth_rls_initplan` warnings on `enquiries` | Open — **low priority**, largest table is 6,633 rows |
| 15 | Info | Data | Sears Melvin has only 6 cemeteries and `processing_weeks` is null on all of them, so `/permit-checker` will still look thin once #1 is fixed | Open — data entry, not code |
| 16 | — | Quote form | Quotes do not add cemetery permit fees to the guide total | **Not a defect — by design.** Memorial Places selections are free text; the Supabase boot path can provide an FK. See `CLAUDE.md`. |
| 17 | Medium | Contact form | `/contact` must use the owned Supabase list, but the anon RLS issue can return no rows | **Client hardened 2026-08-31** — scoped list and FK capture restored, with visible typed-name fallback. RLS migration remains unapplied. |
| 21 | **Critical** | Memorial mobile | iOS focused the boot input, opened Contact Autofill, then Maps replaced the focused node inside an overflow-clipped modal | **Fixed 2026-08-31** — touch focus is transferred only after the stable Places element mounts; mobile overlay owns scrolling. |
| 22 | **High** | Maps API | Current Places widget renamed `gmp-placeselect`/`event.place` to `gmp-select`/`placePrediction`, so selected values could stop being captured | **Fixed 2026-08-31**; legacy `google.maps.places.Autocomplete` fallback removed. |
| 18 | **High** | Quote pricing | `/api/submit` trusted the browser's product price and add-on lines; the configurator also carried a hidden £250 infill on non-kerb products and omitted the default £250 infill from kerb totals | **Fixed in `codex/pricing-integrity`** — the Worker now rebuilds every quote from the current SM-scoped catalogue; focused tests and rendered Castell/Hartwell checks pass |
| 19 | **High** | Quote editing | Legacy quote edits discarded price fields and never updated `orders.value`, while the edit page showed stale hardcoded add-on prices | **Fixed in `codex/pricing-integrity`** — edits use the same canonical calculator and persist the recalculated value; the edit integration test passes |
| 20 | Medium | Public catalogue | Public product reads filtered only on `is_active`, exposing an active £1 uncategorized test product and omitting tenant/listing scope from catalogue, search, sitemap, and product routes | **Website fixed in `codex/pricing-integrity`** — all public reads require the SM org, `is_listed=true`, and a category. Direct anon product RLS remains a separate policy decision |

### Finding #1 in detail — rescoped 2026-08-26

The policy name says "public read" but the grant is to `authenticated` only, so
any page querying `cemeteries` with the anon key gets an empty array.

Three public paths are affected differently:

- **`/permit-checker`** — Supabase only, no Google fallback. The page's entire
  purpose is looking up a cemetery's permit fee and timescale, so it cannot use
  Google: it needs our own priced rows. Non-functional until the grant is fixed.

- **`/memorials/<slug>`** uses Supabase only as its boot/FK path, then replaces
  it with Google Places after first focus. Empty anon rows reduce the boot
  suggestions but do not explain the iOS Places/Autofill bug.
- **`/contact`** is Supabase-only and now shows a typed-name fallback when the
  owned list is empty or unavailable.

Cemetery capture may be free text or a selected owned row. The Worker's
`lookupCemeteryIdByName` still resolves free text where it can. Recorded for
context only, over the 120 days to 2026-08-26:

| | Total | With cemetery text typed | With a resolved `cemetery_id` |
|---|---|---|---|
| Enquiries | 81 | 53 | 0 |
| Quote orders | 30 | 21 | 0 |

**Consequence for the migration:** its cemetery half unblocks the full contact
and permit-checker lists plus memorial's boot/FK path. The `activity_log_write`
half is independent and unaffected.

---

## Verified good — do not re-litigate without re-running the check

- **2026-08-31 — leftover marketing-site partner desk is gone.** `partner.html`
  deleted; `/partner`, `/partner/`, `/partner.html`, `/partner/*` 301 to
  `https://partner.searsmelvin.co.uk/` via `_redirects` plus Pages Functions
  (`functions/partner.js`, `functions/partner.html.js`,
  `functions/partner/[[path]].js`). `/api/partner-auth` and
  `/api/partner-orders` return 410 JSON and do not proxy. Live desk remains
  the other Worker (`sears-melvin-partner`).
- **2026-08-28 — website quote prices are rebuilt server-side.** The submitted
  browser total, permit fee, and line-item prices are ignored. Product, size,
  colour, add-ons, lettering, and kerb infill are resolved from the current
  Sears Melvin catalogue and business rules before Supabase, email, or GHL sees
  the quote. The same calculator protects legacy quote edits and updates
  `orders.value`. All standalone tests pass, including dedicated pricing and
  quote-edit regressions.
- **2026-08-28 — rendered pricing regression checks pass.** The Castell renders
  at £1,450 and £1,535 after selecting the £85 vase, with no hidden infill. The
  Hartwell renders at £4,390 with its £250 chippings and remains £4,390 after
  changing the chippings colour. The active uncategorized £1 test product is
  absent from the filtered catalogue.
- **2026-08-26 — the website does not create or send invoices.** No Stripe
  invoice creation and no `POST /rest/v1/invoices` in `functions/`; no pay or
  invoice CTA in any template; last `INV-WEB-` row 19 May 2026 (commit #125
  landed 21 May); 27 website quote orders since with zero invoices attached; no
  Postgres function inserts into `invoices`.
- **2026-08-26 — RLS holds against the public anon key.** `enquiries`, `orders`,
  `people`, `invoices`, `payments`, `activity_logs` → 0 rows;
  `inbox_messages`, `inbox_conversations`, `partners`, `quote_access_tokens`,
  `customer_portal_tokens` → 401; only `products` / `stone_colours` return data.
- **2026-08-26 — no secrets committed.** The only key in the HTML is the Supabase
  anon key (public by design). No service-role key, Stripe secret, or Resend key
  in tracked files. `node_modules` is not committed.
- **2026-08-26 — the destructive org RPCs guard themselves.** Supabase flags 15
  SECURITY DEFINER functions as callable by `authenticated`. Twelve were reviewed
  (the other three are the `user_is_*` authz primitives themselves); 11 of those
  12 — `delete_organization`, `change_member_role`, `remove_organization_member`
  and the rest — check membership internally, so those warnings are expected.
  `activity_log_write` is the one real exception: finding #3.
- **2026-08-26 — `_headers` and `robots.txt` are otherwise sound.** HSTS with
  preload, nosniff, frame-ancestors, tightened enforced CSP on `/admin*` and
  `/partner*`, sensible cache tiers.

---

## Re-audit playbook

Run these to refresh the register. All are read-only.

**Does anything auto-create invoices again?**
```bash
grep -rn "stripePost(\"/invoices\|/rest/v1/invoices" functions/ | grep -iE "post|create"
grep -rniE "pay (deposit|now)|Deposit Invoice|hosted_invoice_url" functions/api/submit.js functions/api/quotes.js
```
```sql
select count(*) from orders o left join invoices i on i.order_id=o.id
where o.order_type='quote' and o.created_at > '2026-05-21' and i.id is not null;  -- expect 0
```

**What can the public anon key actually read?** (expect 0 rows / 401 on everything
but the catalogue)
```bash
KEY=$(grep -oP "(?<=SUPABASE_ANON_KEY = ')[^']+" index.html | head -1)
for t in enquiries orders people invoices payments activity_logs products; do
  echo -n "$t: "; curl -s "https://bfwohzcugtwbhhxdqgme.supabase.co/rest/v1/$t?select=*&limit=1" \
    -H "apikey: $KEY" -H "Authorization: Bearer $KEY" | head -c 60; echo
done
```

**Is cemetery resolution working?** (the number that matters is the third column)
```sql
select count(*) total,
       count(*) filter (where nullif(trim(coalesce(location,'')),'') is not null) with_text,
       count(*) filter (where cemetery_id is not null) resolved
from enquiries e join organizations o on o.id=e.organization_id and o.name='Sears Melvin'
where e.created_at > now() - interval '90 days';
```

**Supabase advisors** — `get_advisors` for `security` and `performance` on
`bfwohzcugtwbhhxdqgme`. Expect a wall of INFO-level `rls_enabled_no_policy`:
that is the safe deny-all default for service-role-only tables, not a problem.

**Cloudflare** — `workers_list`, then `workers_get_worker_code` on anything
unfamiliar. Cross-check against the repo:
```bash
grep -rn "workers.dev" --include=*.html --include=*.js .   # expect no hits
```

**Repo hygiene**
```bash
for f in tests/*.mjs; do node "$f" || echo "FAIL $f"; done
git ls-remote --heads origin | wc -l
```

---

## Improvement backlog (not defects)

Ordered by value, from the 2026-08-26 email and tooling review:

1. **Preheader text.** No template sets one, so Gmail's preview line scrapes the
   header ("Sears Melvin Memorials New Quote Request Received…"). One hidden line
   per template is the cheapest inbox win available.
2. **The business notification has no action.** It reports everything and stops —
   no reply-to-customer link, no deep link to the order in the admin portal.
3. **`source_page` is captured and never shown.** With area landing pages in play
   (`SEO-ACTION-PLAN.md`), knowing a lead came from `/areas/barnet` belongs in
   the notification.
4. **No quote reference number** in either copy, so neither side has anything to
   quote back on the phone.
5. **Serve cemeteries from a Pages Function** rather than the browser hitting
   PostgREST with the anon key. `submit.js` already does this server-side
   with `orgFilter`. It removes finding #1's whole class of problem and shrinks
   the anon key's surface to nothing.
6. **Subject-line convention.** Keep the event type as the first token — it is
   what triage and Gmail filters key on. Better still, route business
   notifications to `info+quote@` / `info+enquiry@` / `info+deposit@` so filters
   key on `to:` and survive any copy change.
