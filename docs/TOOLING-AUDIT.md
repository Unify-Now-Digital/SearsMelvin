# Tooling audit register

A standing record of what has been checked across the stack, what is wrong, and
how to re-check it. **Keep this current** — update the status column when you fix
something, and add a dated line to "Verified good" when you confirm a fact, so
the next audit starts from evidence rather than from scratch.

Last full sweep: **2026-08-26** (Cloudflare, Supabase, repo, GitHub).

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
| 16 | **High** | Quote form | On `/memorials/<slug>` Google's autocomplete replaces the Supabase input, and its `gmp-placeselect` handler sets only a name string — never `_selectedCemeteryId` or `_selectedCemeteryFee`. So no quote captures a cemetery FK or a permit fee, regardless of #1. | Open — needs a name-match from the Google pick back to the priced list |

### Finding #1 in detail — corrected 2026-08-26

The policy name says "public read" but the grant is to `authenticated` only, so
any page querying `cemeteries` with the anon key gets an empty array. **Two**
public pages are affected — not three, as first written here:

- **`/permit-checker`** — Supabase only, no Google fallback. The page's entire
  purpose is looking up a cemetery's permit fee and timescale. Non-functional.
- **`/contact`** — Supabase only. Cemetery dropdown empty.

**`/memorials/<slug>` (the quote form) is NOT affected by the RLS bug, and its
cemetery field works fine.** `_onMapsReady` calls `wrap.replaceChild()` and
swaps the whole input for a Google `PlaceAutocompleteElement`, so the customer
gets UK-wide cemetery suggestions from Google. The Supabase-backed
`searchQuoteCemetery` / `selectQuoteCemetery` pair is unreachable dead code on
that page — the element it listens to no longer exists.

That matters, because `selectQuoteCemetery` is the **only** function that sets
`_selectedCemeteryId` and `_selectedCemeteryFee`. Google's `gmp-placeselect`
handler sets a display-name string and nothing else. So on the quote form the
permit fee can never be applied and the cemetery FK can never be captured —
a code bug, independent of the RLS grant. **Applying the migration alone will
not fix quote pricing.** See finding #16.

Measured over the 120 days to 2026-08-26:

| | Total | With cemetery text typed | With a resolved `cemetery_id` |
|---|---|---|---|
| Enquiries | 81 | 53 | **0** |
| Quote orders | 30 | 21 | **0** |

Every quote in that period understates the installed total by the permit fee
(£120–£195 across SM's cemeteries).

---

## Verified good — do not re-litigate without re-running the check

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
   PostgREST with the anon key. `partner-orders.js` already does exactly this
   with `orgFilter`. It removes finding #1's whole class of problem and shrinks
   the anon key's surface to nothing.
6. **Subject-line convention.** Keep the event type as the first token — it is
   what triage and Gmail filters key on. Better still, route business
   notifications to `info+quote@` / `info+enquiry@` / `info+deposit@` so filters
   key on `to:` and survive any copy change.
