# Sears Melvin website tracking contract

**Source of truth for every analytics/ads hook on searsmelvin.co.uk.** If you change a
form, a page template, a phone number, a link or anything pushed to `dataLayer`, read
this first. CI (`tests/tracking-contract.mjs`, `.github/workflows/tests.yml`) fails a PR
that breaks it; `scripts/tracking-check.mjs` checks the live site and live GTM daily.

- GTM container: **GTM-KRDX4BQ5** (live version 21 at time of writing; snapshot in `docs/gtm-snapshot.json`)
- GA4: **G-RF3LYJMFVE** (property 527695823)
- Google Ads: **AW-16866941615** (customer 417-417-3541, manager 527-130-1935)

## Golden rules

1. Push conversion events **only on a confirmed successful server response**, **first**, before the form is hidden, reset or redirected.
2. **No personal details in `dataLayer`** (no name, email, phone, message, address). Enhanced conversions read the consent-gated form fields inside GTM instead.
3. GA4 lead/quote events use **`transport_type: beacon`** (set on the GTM tags) so they survive the page unloading.
4. Every visible phone number is exactly **`020 3835 2548`** (the Google forwarding-number swap only matches this format). Every `tel:` link must show it as text. Schema JSON-LD keeps `+442038352548`.
5. **No `utm_*` on internal links.** UTMs are only for inbound campaigns (and the outbound brochure email/PDF links in `functions/api/brochure.js` / the PDF).
6. Every public page loads GTM (GTM-KRDX4BQ5) and the GHL chat loader with the chat hook.
7. Never change conversion values, primary/secondary or bidding from the website side.
8. If you change GTM, run `node scripts/tracking-check.mjs --update-snapshot` and commit the new `docs/gtm-snapshot.json` in the same PR, with a GTM version name that says what changed.

## dataLayer events the site pushes

| Event | Pushed from | When | GTM tags that depend on it |
|---|---|---|---|
| `sm_lead_submit` `{form_id:'contactForm', enquiry_type}` | `contact.html` | `/api/submit` returns `ok`, before the form is hidden | GA4 `generate_lead` (params form_name=contact_enquiry, value 400 GBP, beacon); Ads **generate_lead** `AW-16866941615/_M8_CK2IrYkcEK-15Oo-` (tag value 400); Ads user-provided data (`__awud`) |
| `sm_quote_submit` `{form_id:'quoteForm'}` | `memorial.html` quote modal | `/api/submit` (channel quote) returns `ok`, before the form is hidden | GA4 `request_quote` (value = variable, GBP, beacon); Ads **request_quote** `AW-16866941615/l5TiCLCIrYkcEK-15Oo-` (value = variable). Moved to this event in GTM v21; the old `#quoteSuccessMsg` element-visibility trigger is **legacy** (the page still scrolls the message into view inside the modal). |
| `sm_chat_submit` | inline LeadConnector loader `<script>` in every public page `<head>` | GHL chat widget `registerBeforeSubmit` (fires once per submission, 3 s debounce) | GA4 `ghl_chat_submission` (once per load); Ads **Chat start** `AW-16866941615/MipOCNXwuLscEK-15Oo-` (tag value 200); `__awud` |
| `ghl_chat_submission` | same place, right after `sm_chat_submit` | same | **No trigger on purpose.** Adding a GTM trigger on it would double count chats. |
| `brochure_download` `{source, email_given}` | `site-upgrades.js` (`brochureEvents`) | brochure download click / email sent | GA4 `brochure_download` (param source). Optional Ads conversion only if `googleAds.brochureConversionLabel` is set in `site-config.js`. |
| `consent_update` | cookie banner script on every page | Accept/Decline | Consent mode; GTM consent defaults are `denied` until Accept. |

The chat loader also sets `window.__smChatHook = true` before GTM loads. That disables the
older GTM Custom HTML "GHL Chat Widget Listener" (fetch/XHR hook), which raced the widget
and missed most chats. Do not remove the flag, or chats will be counted twice.

### generate_lead on quote/shortlist pages (keep)
GA4 `generate_lead` also has a second tag: `gtm.formSubmit` on `/memorials*` **unless** the form is `quoteForm`
(form_name=shortlist, value 400, beacon). It covers the shortlist enquiry form. Keep it.

## GTM tags (live v21, from `docs/gtm-snapshot.json`)

| Tag type | ID / label | Value | Trigger |
|---|---|---|---|
| Google tag | G-RF3LYJMFVE | | Initialization |
| Google tag | AW-16866941615 | | Initialization |
| GA4 event | generate_lead (contact) | 400 GBP | `sm_lead_submit` |
| GA4 event | generate_lead (shortlist) | 400 GBP | formSubmit on /memorials, not `quoteForm` |
| GA4 event | request_quote | variable | `sm_quote_submit` |
| GA4 event | ghl_chat_submission | | `sm_chat_submit` (once per load) |
| GA4 event | click_to_call | 270 GBP | link click on `tel:` |
| GA4 event | click_to_email | | link click on `mailto:` |
| GA4 event | brochure_download | | `brochure_download` |
| GA4 event | finder_start | | page path contains `finder` |
| GA4 event | share_shortlist | | click on `.shortlist-btn-*` |
| Ads conversion | `_M8_CK2IrYkcEK-15Oo-` generate_lead | 400 | `sm_lead_submit` |
| Ads conversion | `l5TiCLCIrYkcEK-15Oo-` request_quote | variable | `sm_quote_submit` |
| Ads conversion | `MipOCNXwuLscEK-15Oo-` Chat start | 200 | `sm_chat_submit` |
| Ads conversion | `okRkCPGTqJsdEK-15Oo-` SM Website click-to-call (tel link) | 270 | link click on `tel:` |
| Ads call conversion (`__awcc`) | `K1otCIWr1JodEK-15Oo-` SM Website call (GFN), number swap | | All pages |
| Ads user-provided data, conversion linker, listeners | | | various |
| Custom HTML | GHL Chat Widget Listener (legacy, neutralised by `__smChatHook`) | | All pages |

The exact tag list with triggers and params is `docs/gtm-snapshot.json`.

## Google Ads conversion actions (read from the Ads API, 14 Oct 2026)

| ID | Name | Type | Primary? | Default value |
|---|---|---|---|---|
| 7535805485 | generate_lead | Website (GTM) | Primary | £540 |
| 7535805488 | request_quote | Website (GTM) | Primary | £810 |
| 7841909233 | SM Website click-to-call (tel link) | Website (GTM), label okRkCPGTqJsdEK-15Oo- | Primary | £270 |
| 7604821101 | Lead form - Submit | Google-hosted lead form | Primary | £1 |
| 7535805491 | click_to_call | Click to call (ad) | Secondary | £270 |
| 7640856661 | Chat start | Website (GTM), label MipOCNXwuLscEK-15Oo- | Secondary | £1 default; the GTM tag sends £200 |
| 7840535941 | SM Website call (GFN) | Website call, label K1otCIWr1JodEK-15Oo-, 90 s | Secondary | £1 |
| 7559130441 | Calls from ads | Ad call | Secondary | £1 |
| 7840372295 | SM Won order (offline) | Offline click upload | Secondary | £0 (value sent per upload) |

Note the GTM tag values (400 lead) differ from the Ads default values (540 lead, 810 quote).
Do not change either from a website PR. GA4 key events (generate_lead, request_quote,
ghl_chat_submission, click_to_call) are configured in GA4 Admin; confirm there before relying on them.

## Click-ID / attribution capture

- `site-upgrades.js` reads `gclid`, `gbraid`, `wbraid` and `utm_source/medium/campaign/term/content`
  on every page load and stores them in `localStorage.sm_attr` for **90 days**.
  **First touch wins**; only a **new click ID** replaces the record (UTM-only revisits don't).
- Every form sends `attribution: SMUpgrades.getAttribution()`: contact, quote (memorial), shortlist,
  home appointment and brochure email.
- `functions/api/submit.js` cleans it (`cleanAttribution`) and writes it to the Supabase
  `enquiries` columns `gclid, gbraid, wbraid, utm_*` (migration `2026-10-14-add-enquiry-attribution.sql`;
  quotes: PATCH of the enquiry returned by `create_quote`), and to the GHL contact custom fields
  `contact.contactgclid / contactgbraid / contactwbraid / contactutm_*` (resolved by key).
- `functions/api/brochure.js` sets the same GHL fields on the brochure upsert (SM PIT).

## Daily offline upload (outside this repo)

`/workspace/sm-ads-offline/sm_offline_upload.py` (box), weekdays 08:17 Madrid, to Ads action
**SM Won order (offline) 7840372295** via the Data Manager API.
- Source: GHL SM won opportunities in the Invoiced stage; value = actual deposit amount and date
  from the deposits CSV (never the full order value).
- Matching: one click ID (gclid, else gbraid, else wbraid), taken from the GHL contact fields first,
  then the latest Supabase `enquiries` click ID for that email; plus SHA-256 email and phone.
- **Dedupe:** `transactionId = SM-<Mason order number>`; orders already in `uploaded_orders.txt`
  are skipped; one upload per order (manual merges for known duplicate contacts); rows without an
  order number are skipped. Default is dry run; `--live` uploads.

## Dedupe rules (summary)
- Chat: one push per submission (3 s debounce), GTM GA4 chat tag once per page load, legacy listener off.
- Lead/quote: pushed once per confirmed response; GTM tags `once_per_event`.
- `ghl_chat_submission` and `sm_chat_submit` must never both have triggers.
- Offline: transactionId per order + ledger.

## Checks
- **CI:** `node tests/tracking-contract.mjs` (all `tests/*.mjs` run on every PR).
- **Live, read-only:** `node scripts/tracking-check.mjs` (exit 1 on any problem, 2 on error).
  `--base <url>` checks a preview, `--json` for machines, `--update-snapshot` after an intended GTM change.
