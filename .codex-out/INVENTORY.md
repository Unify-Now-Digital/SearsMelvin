# Sears Melvin public-site engineering inventory

Scope: `searsmelvin.co.uk` public repository only. Partner/admin implementation
was not changed. Sweep date: 2026-08-31.

## Cemetery paths and ownership

| Surface | Data path | Intended lifecycle | Sweep result |
|---|---|---|---|
| `memorial.html` RAQ | Supabase `QUOTE_CEMETERIES`, then Google Places | Owned list is the boot/free-text/FK path. Places becomes primary on first interaction: desktop uses `PlaceAutocompleteElement`; narrow screens use `AutocompleteSuggestion` inside the modal. | Preserved as an intentional dual path. Both Places paths restrict to GB and the `cemetery` primary type, with visible owned-list/free-text fallback. |
| `contact.html` | Supabase cemeteries only | Search the active, non-test Sears Melvin rows; preserve a typed name if the public list is unavailable. | Google Places path removed. Owned list, selected FK, visible loading/failure states restored. |
| `permit-checker.html` | Supabase cemeteries only | Requires owned permit/rule data; Google Places cannot supply it. | Tenant/test filters added; empty `[]` is now an unavailable state rather than false success. |
| `functions/api/submit.js` | Server-side best-effort cemetery resolution | Resolves free text when no FK was supplied and scopes the query to the SM organisation. | Existing implementation retained; security test already covers the org filter. |

## Stale/deprecated APIs and dead code

- Fixed: memorial listened for the preview-era `gmp-placeselect` event and read
  `event.place`. Current Places uses `gmp-select`, `event.placePrediction`, then
  `toPlace()`. See the current Google migration guide:
  <https://developers.google.com/maps/documentation/javascript/legacy/places-migration-ac-widget>.
- Removed: legacy `google.maps.places.Autocomplete` fallback. Google documents
  it as the legacy widget; keeping it behind the new element produced two
  different focus/value contracts and recreated the mobile race.
- Removed: Leaflet CSS/JS and the unreachable `_initQMap`, marker, map, and
  `#qCemeteryMap` styles from memorial. No map element or caller remained.
- Removed: legacy `.pac-*` styling and unused `.cemetery-search-wrap` rules,
  which only targeted the removed legacy autocomplete.
- Removed: unused permit-checker `_cemeteriesLoaded` state.
- Fixed: the Maps loader omitted `loading=async`. It now uses that flag plus
  async/defer, and script, suggestion-RPC, selection, and widget errors restore
  a visible, usable cemetery fallback.
- Fixed: `docs/TOOLING-AUDIT.md` and `CLAUDE.md` claimed contact used Places and
  memorial's Supabase boot path was dead. Both contradicted the authoritative
  public sitemap and the actual required behavior.

## Dual paths that can fight

- Memorial's boot input previously accepted Supabase events, opened Safari
  Contact Autofill, triggered Maps on that same focus, and was then destroyed by
  Places while still focused. The new-element popup also lived under a
  `max-height`/`overflow-y:auto` modal. This was the P0 collision.
- Memorial submission had four possible value holders. It still reads the
  selected Supabase value, selected Places value, or currently mounted free
  text, but selection changes now clear stale values from the other path.
- Google's element owns a full-screen narrow-screen prediction surface that
  page CSS cannot reliably contain. Mobile now renders current Places API
  suggestions into the existing modal list. Avoiding focused-node replacement
  also prevents the `HendonHendon` keystroke replay.
- Contact had been changed into a second Places implementation even though its
  public contract is Supabase-only. That duplicate Maps loader and global
  `_onMapsReady` callback are removed.
- `quote.html` is not a second RAQ form: it is the token/email customer quote
  viewer/editor. It should not be merged with memorial RAQ. However, the 404
  page labels `/quote` as “Free quote,” which is misleading and remains listed
  as a small content bug.

## Public configuration and data boundary

- `/api/config` intentionally returns browser-public identifiers only and
  rejects cross-origin reads. Memorial uses its Maps value; contact no longer
  fetches it.
- Public memorial loads no longer probe `/api/admin` and generate an expected
  anonymous 401. That protected request is limited to explicit `?preview=1`
  admin previews; cookie consent remains a local-storage/Consent Mode action.
- The Supabase anonymous browser identifier is duplicated across many static
  pages. This is public by design, not a secret leak, but it makes rotation and
  migration to a publishable key error-prone. Centralisation remains follow-up
  work outside this focused patch.
- Every cemetery browser query touched by this sweep now explicitly filters to
  the Sears Melvin organisation, active rows, and non-test rows. RLS remains the
  real security boundary; URL filters are defense in depth and data hygiene.
- `migrations/2026-08-26-fix-public-cemetery-read-and-audit-log.sql` is marked
  not applied. No client-side private/service key workaround was introduced.

## Other public sweep notes

- Public product reads already carry SM organisation, listed/active, and
  category filters from the prior pricing-integrity work.
- Partner routes are redirects/410 shims by deliberate design. No partner or
  admin rewrite was performed.
- CSP remains report-only without a reporting endpoint, and public identifiers
  remain duplicated; both are existing low-priority findings in the tooling
  audit rather than cemetery P0 scope.
