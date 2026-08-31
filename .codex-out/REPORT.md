# Sears Melvin public cemetery/mobile cleanup report

Date: 2026-08-31
Branch: `codex/sm-public-cemetery-mobile-cleanup`
Base: fetched `origin/main` at `771332c`
PR title: **SM public: fix iOS cemetery picker and clean up data paths**
PR URL: **not created — GitHub credentials are unavailable in this workspace**

## Colour-bullet summary

- 🟢 **Done** — Fixed the P0 iOS focus/replacement/modal-clipping collision
  while keeping Google Places as memorial RAQ's intended primary picker after
  first interaction.
- 🟢 **Done** — At ~390px, replaced the element's full-screen takeover with an
  in-modal Places suggestion list and removed the focused-value replay behind
  `HendonHendon`.
- 🟢 **Done** — Restricted Places to GB cemetery primary types, added visible
  failure fallback, and corrected the Maps async-loading warning.
- 🟢 **Done** — Made cookie dismissal resilient to storage errors and removed
  the unrelated anonymous `/api/admin` 401 from ordinary product loads.
- 🟢 **Done** — Migrated memorial to current `gmp-select` selection
  handling; removed deprecated legacy Autocomplete, unused Leaflet/map code,
  legacy styles, and stale cross-path values.
- 🟢 **Done** — Restored contact and permit-checker to SM-scoped
  Supabase-only cemetery lists. Contact retains a clear typed-name fallback;
  permit-checker reports empty data as unavailable.
- 🟢 **Done** — Added focused regression coverage, corrected repository
  guidance/audit drift, and produced `INVENTORY.md` plus `BUGS.md`.
- 🟡 **Watch** — A real iPhone/Safari acceptance pass is still required;
  Node/source-contract tests cannot reproduce the iOS keyboard visual viewport.
- 🟡 **Watch** — Permit data remains sparse, so successful anonymous reads
  may still show incomplete timescales.
- 🟡 **Watch** — Google's `cemetery` type is a precision filter, not a complete
  directory; memorial grounds may be classified differently or missing.
- 🔴 **Fix / remaining** — Review and apply the prepared anonymous cemetery
  RLS migration through the normal database change process. It is intentionally
  not applied by this branch, and no private/service key workaround was added.
- 🔴 **Fix / remaining** — GitHub CLI and HTTPS Git credentials are absent,
  so the branch could not be pushed and the PR could not be opened here.
- 🔵 **Next** — Authenticate, run the exact push/PR commands below, review the
  focused commits, and complete iPhone/Safari validation before merge.

## Commits

- `6a87cbe` — Fix public cemetery flows on mobile
- `4b61b12` — Document public cemetery data ownership
- `1d799c5` — Contain cemetery Places search on mobile

## Key file diffs

- `memorial.html` — stable touch-to-Places handoff, current selection event,
  contained mobile Places results, cemetery bias, visible RPC/script fallback,
  safe consent, public/admin boundary, and dead legacy Maps/Leaflet removal.
- `contact.html` — removes Maps entirely; adds SM Supabase suggestions, selected
  FK capture, ARIA status, and typed-name fallback.
- `permit-checker.html` — adds SM/non-test filters and treats empty rows as load
  failure.
- `tests/public-cemetery-flows.mjs` — locks the three-surface ownership and
  modern Maps API, mobile containment, error fallback, consent, and public/admin
  boundary contracts.
- `CLAUDE.md`, `docs/TOOLING-AUDIT.md` — correct stale data-path guidance.
- `.codex-out/INVENTORY.md`, `.codex-out/BUGS.md` — full requested sweep outputs.

## Verification

Passed:

- `git diff --check`
- `node tests/public-cemetery-flows.mjs`
- inline JavaScript compilation for the three changed public pages
- every existing `tests/*.mjs` test

No production deployment, force-push, main merge, database mutation, partner
rewrite, or secret/private key change was performed.

## Exact GitHub handoff commands

Run from `/workspace/SearsMelvin` after authenticating GitHub CLI:

```bash
gh auth login
git push -u origin codex/sm-public-cemetery-mobile-cleanup
gh pr create --base main --head codex/sm-public-cemetery-mobile-cleanup \
  --title "SM public: fix iOS cemetery picker and clean up data paths" \
  --body-file .codex-out/PR_BODY.md
```
