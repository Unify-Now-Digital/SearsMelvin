# GTM baseline diff

This file compares the live GTM container with the snapshot in this repo.
The check is read-only.

## How the check works

1. Read the live container from https://www.googletagmanager.com/gtm.js?id=GTM-KRDX4BQ5.
2. Read the snapshot from docs/gtm-snapshot.json.
3. Compare each tag, its triggers, its value, and its parameters.
4. Use the same parser as scripts/tracking-check.mjs.
5. Leave the GTM container unchanged.
6. Leave docs/gtm-snapshot.json unchanged.

## Decision

1. On 8 November 2026 Arin confirmed the click-to-call conversion value.
2. The confirmed value is 150 GBP.
3. The value matches live GTM v26.
4. This check does not change GTM.

## Versions

1. The snapshot version is 26.
2. The live version is 26.
3. The public gtm.js file serves only the live version.
4. The snapshot version and the live version are the same.
5. The check date is 8 November 2026.

## Drift

1. The drift is resolved.
2. The snapshot now matches live v26.
3. The snapshot has 29 tags.
4. The live container has 29 tags.
5. 29 tags match on kind, id, value, parameters, and triggers.
6. The check found 0 differences.
7. The Google Ads click-to-call tag okRkCPGTqJsdEK-15Oo- uses value 150.
8. The GA4 click_to_call event sends value 150 and currency GBP.
9. The Ads user-provided data tag listens for sm_quote_submit.

## Custom HTML

1. The snapshot stores kind, id, value, parameters, and triggers.
2. The snapshot does not store custom HTML source.
3. The live container has 1 custom HTML tag.
4. That tag still pushes sm_chat_submit only when window.__smChatHook is missing.
5. That HTML source does not contain view_item_list, select_item, or filter_select.

## Ecommerce event names

1. view_item_list is not a tag id. The live file contains the string 3 times.
2. select_item is not a tag id. The live file contains the string 3 times.
3. filter_select is not a tag id. The live file contains the string 0 times.
4. view_item_list and select_item appear inside the GTM library event map.
5. They are not tags in this container.
6. filter_select does not appear in the live file.

## Full tag list

The value column shows the live value.
A Drift row is described in the Drift section above.
Parameters use the snapshot shape. `{{variable}}` means the tag reads a GTM variable.

| Status | Kind | Id | Value | Parameters | Triggers |
| --- | --- | --- | --- | --- | --- |
| Same | Google Ads call conversion (number swap) | K1otCIWr1JodEK-15Oo- | none | {} | if _eq({{__e}},gtm.js) |
| Same | Google Ads conversion | _M8_CK2IrYkcEK-15Oo- | 400 | {} | if _eq({{__e}},sm_lead_submit) |
| Same | Google Ads conversion | l5TiCLCIrYkcEK-15Oo- | {{variable}} | {} | if _eq({{__e}},sm_quote_submit) |
| Same | Google Ads conversion | MipOCNXwuLscEK-15Oo- | 200 | {} | if _eq({{__e}},sm_chat_submit) |
| Same | Google Ads conversion | okRkCPGTqJsdEK-15Oo- | 150 | {} | if _cn({{__v:gtm.elementUrl}},tel:) && _eq({{__e}},gtm.linkClick) && _re({{__v:gtm.triggers}},(^$\|((^\|,)245755202_7($\|,)))) |
| Same | Google Ads user-provided data | none | none | {} | if _cn({{__v:gtm.elementClasses}},shortlist-btn-) && _eq({{__e}},gtm.click) \| if _eq({{__e}},gtm.elementVisibility) && _re({{__v:gtm.triggers}},(^$\|((^\|,)245755202_15($\|,)))) \| if _eq({{__e}},gtm.formSubmit) && _cn({{__u:PATH}},memorials) && _re({{__v:gtm.triggers}},(^$\|((^\|,)245755202_17($\|,)))) ; unless _eq({{__v:gtm.elementId}},quoteForm) \| if _eq({{__e}},sm_chat_submit) \| if _eq({{__e}},sm_lead_submit) \| if _eq({{__e}},sm_quote_submit) |
| Same | Click listener | none | none | {} | if _eq({{__e}},gtm.js) |
| Same | Element visibility listener | none | none | {} | if _eq({{__e}},gtm.js) |
| Same | Element visibility listener | none | none | {} | if _eq({{__e}},gtm.js) |
| Same | Form submit listener | none | none | {} | if _eq({{__e}},gtm.js) |
| Same | Form submit listener | none | none | {} | if _eq({{__e}},gtm.js) |
| Same | GA4 event | brochure_download | none | {"source":"{{variable}}"} | if _eq({{__e}},brochure_download) |
| Same | GA4 event | click_to_call | none | {"value":"150","currency":"GBP"} | if _cn({{__v:gtm.elementUrl}},tel:) && _eq({{__e}},gtm.linkClick) && _re({{__v:gtm.triggers}},(^$\|((^\|,)245755202_7($\|,)))) |
| Same | GA4 event | click_to_email | none | {} | if _eq({{__e}},gtm.linkClick) && _cn({{__v:gtm.elementUrl}},mailto:) && _re({{__v:gtm.triggers}},(^$\|((^\|,)245755202_9($\|,)))) |
| Same | GA4 event | finder_start | none | {} | if _cn({{__u:PATH}},finder) && _eq({{__e}},gtm.js) |
| Same | GA4 event | generate_lead | none | {"form_name":"contact_enquiry","value":"400","currency":"GBP","transport_type":"beacon"} | if _eq({{__e}},sm_lead_submit) |
| Same | GA4 event | generate_lead | none | {"form_name":"shortlist","value":"400","currency":"GBP","transport_type":"beacon"} | if _eq({{__e}},gtm.formSubmit) && _cn({{__u:PATH}},memorials) && _re({{__v:gtm.triggers}},(^$\|((^\|,)245755202_17($\|,)))) ; unless _eq({{__v:gtm.elementId}},quoteForm) |
| Same | GA4 event | ghl_chat_submission | none | {} | if _eq({{__e}},sm_chat_submit) |
| Same | GA4 event | page_view | none | {"page_location":"{{variable}}"} | if _eq({{__e}},consent_granted_by_click) |
| Same | GA4 event | request_quote | none | {"value":"{{variable}}","currency":"GBP","transport_type":"beacon"} | if _eq({{__e}},sm_quote_submit) |
| Same | GA4 event | share_shortlist | none | {"method":"{{variable}}"} | if _cn({{__v:gtm.elementClasses}},shortlist-btn-) && _eq({{__e}},gtm.click) |
| Same | Conversion linker | none | none | {} | if _eq({{__e}},gtm.js) |
| Same | Google tag | AW-16866941615 | none | {} | if _eq({{__e}},gtm.init) |
| Same | Google tag | G-RF3LYJMFVE | none | {} | if _eq({{__e}},gtm.init) |
| Same | Custom HTML | none | none | {} | if _eq({{__e}},gtm.js) |
| Same | Link click listener | none | none | {} | if _eq({{__e}},gtm.js) |
| Same | Link click listener | none | none | {} | if _eq({{__e}},gtm.js) |
| Same | Paused tag | none | none | {} | if _cn({{__u:PATH}},contact) && _eq({{__e}},gtm.formSubmit) && _re({{__v:gtm.triggers}},(^$\|((^\|,)245755202_11($\|,)))) |
| Same | Paused tag | none | none | {} | if _eq({{__e}},gtm.js) |

## Run the check again

1. From the repo root, run `node scripts/gtm-baseline-diff.mjs`.
2. The script fetches the live container.
3. The script rewrites this file.
4. The script does not publish a GTM version.
5. The script does not update docs/gtm-snapshot.json.
