## Summary

- fix the iOS memorial cemetery focus race between the Supabase boot input,
  Contact Autofill, and Google `PlaceAutocompleteElement`
- keep Places primary on narrow screens through an in-modal
  `AutocompleteSuggestion` list, preventing full-screen takeover and duplicate
  keystroke replay
- restrict Places suggestions to GB cemetery primary types while retaining a
  typed-name/owned-list fallback for Google coverage limits
- update the Places widget to the current `gmp-select` / `placePrediction` API
  and remove the deprecated legacy autocomplete fallback
- load Maps with `loading=async` and recover visibly from script, RPC,
  selection, and widget errors
- make consent dismissal storage-failure-safe and stop anonymous public product
  loads from probing `/api/admin`
- restore contact and permit-checker to tenant-scoped Supabase-only cemetery
  lists, with safe empty/error states and no private-key workaround
- remove unreachable Leaflet/map and legacy autocomplete assets
- add public cemetery ownership regression coverage and correct stale repo docs

## Testing

- `node tests/public-cemetery-flows.mjs`
- inline JavaScript syntax compilation for `memorial.html`, `contact.html`, and
  `permit-checker.html`
- all `tests/*.mjs`
- `git diff --check`

## Operational note

The prepared anonymous cemetery RLS migration is still marked unapplied. This
PR improves client failure behavior but does not deploy or apply database
changes. Real iPhone/Safari acceptance remains recommended for the keyboard and
visual-viewport interaction. Google's cemetery primary type improves relevance
but cannot represent a complete cemetery directory, so free text remains
supported.
