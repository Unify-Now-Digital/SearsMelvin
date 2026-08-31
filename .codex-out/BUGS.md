# Sears Melvin public-site bug list

## P0

### P0-1 — iOS memorial cemetery Places/Autofill/modal collision — fixed

The boot input opened Contact Autofill while Maps replaced that focused node.
At approximately 390px the replacement then used Google's full-screen Places
panel, burying the quote form, and buffered typing could be replayed into the
new control (`HendonHendon`).

Fix: touch focus is intercepted before replacement. Narrow screens now keep the
stable input and render current Places `AutocompleteSuggestion` results inside
the modal. Desktop retains `PlaceAutocompleteElement`; mobile overlay scrolling
also prevents clipping. Places remains the primary path after first focus.

## P1

### P1-1 — obsolete Places selection event lost selected values — fixed

Migrated `gmp-placeselect` / `event.place` to current `gmp-select`,
`event.placePrediction`, `toPlace()`, and minimal detail fields.

### P1-2 — empty anonymous cemetery API breaks contact and permit checker — client hardened; infrastructure remains

Contact shows a typed-name fallback and submits safely. Permit-checker exposes
a genuine unavailable state rather than enabling an empty search. The prepared
anonymous-read RLS migration still requires review/application outside this PR.

### P1-3 — contact used the wrong data source — fixed

Removed its Places implementation and restored the tenant-scoped Supabase-only
list, selected FK capture, and typed-name fallback.

### P1-4 — Places results were generic geography — fixed with documented limit

Desktop and narrow-screen requests now combine GB restriction with
`includedPrimaryTypes: ['cemetery']`. Google has no separate “memorial ground”
filter, and individual sites may be classified differently or absent. Typed
names remain valid, and failures/no matches can fall back to the owned list.

### P1-5 — mobile cookie banner dismissal could fail — fixed

Accept/Decline wrote local storage before hiding the banner, so a storage
exception could leave it covering sticky RAQ. Dismissal now happens first,
storage access is guarded, and the quote bar is resynchronised. The observed
anonymous `POST /api/admin 401` was not a consent request; the product loader
probed admin preview for every visitor. Public loads now use Supabase directly,
with `/api/admin` limited to explicit `?preview=1` previews.

## P2

### P2-1 — legacy autocomplete and Leaflet assets were dead/conflicting — fixed

Removed deprecated legacy autocomplete fallback, unused Leaflet/map code,
legacy `.pac-*` styles, and unreachable assets.

### P2-2 — Maps/RPC failures could strand the cemetery field — fixed

The loader now includes `loading=async` plus async/defer. Script failures,
mobile suggestion RPC failures, place-detail failures, and desktop `gmp-error`
events show status text and retain or restore owned-list/free-text search.

### P2-3 — cemetery docs contradicted runtime ownership — fixed

Updated the tooling audit and repository guidance to the authoritative
three-surface model.

### P2-4 — `/quote` link text is misleading — remaining

`quote.html` is a customer quote viewer/editor, not memorial RAQ. The 404 page
labels its link “Free quote”; fix in a small content PR.

## P3 / watch

- Anonymous/publishable Supabase browser configuration is duplicated in static
  HTML, increasing rotation drift.
- Permit-checker data is sparse (`processing_weeks` may be null).
- Cemetery-only filtering improves precision but is not a complete cemetery
  directory; Google classification/coverage limits require typed-name fallback.
- Source-contract coverage passes, but keyboard and visual-viewport acceptance
  still needs a real iPhone/Safari pass.
