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

## Versions

1. The snapshot version is 23.
2. The live version is 26.
3. The public gtm.js file serves only the live version.
4. This diff is the net change from version 23 to version 26.
5. The check date is 8 November 2026.

## Drift

1. The snapshot has 29 tags.
2. The live container has 29 tags.
3. 26 tags match on kind, id, value, parameters, and triggers.
4. The check found 3 differences.
5. The parser in scripts/tracking-check.mjs reports 6 drift lines for the same pair of files.
6. Each changed tag produces two parser lines. One line is the snapshot copy. One line is the live copy.

### 1. Call conversion value on the Google Ads tag

1. The tag is Google Ads conversion.
2. The id is okRkCPGTqJsdEK-15Oo-.
3. The snapshot value is 270.
4. The live value is 150.
5. The parameters are unchanged. They are {}.
6. The triggers are unchanged.

### 2. Ads user-provided data listens for sm_quote_submit

1. The tag is Google Ads user-provided data.
2. The id is none.
3. The value is unchanged. It is none.
4. The parameters are unchanged. They are {}.
5. The live tag has these triggers, and the snapshot does not: if _eq({{__e}},sm_quote_submit).
6. The shared triggers stay in place. Count: 5.

### 3. Call value on the GA4 click_to_call tag

1. The tag is GA4 event.
2. The id is click_to_call.
3. The value is unchanged. It is none.
4. The snapshot parameters are {"value":"270","currency":"GBP"}.
5. The live parameters are {"value":"150","currency":"GBP"}.
6. The triggers are unchanged.


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
| Drift | Google Ads conversion | okRkCPGTqJsdEK-15Oo- | 150 | {} | if _cn({{__v:gtm.elementUrl}},tel:) && _eq({{__e}},gtm.linkClick) && _re({{__v:gtm.triggers}},(^$\|((^\|,)245755202_7($\|,)))) |
| Drift | Google Ads user-provided data | none | none | {} | if _cn({{__v:gtm.elementClasses}},shortlist-btn-) && _eq({{__e}},gtm.click) \| if _eq({{__e}},gtm.elementVisibility) && _re({{__v:gtm.triggers}},(^$\|((^\|,)245755202_15($\|,)))) \| if _eq({{__e}},gtm.formSubmit) && _cn({{__u:PATH}},memorials) && _re({{__v:gtm.triggers}},(^$\|((^\|,)245755202_17($\|,)))) ; unless _eq({{__v:gtm.elementId}},quoteForm) \| if _eq({{__e}},sm_chat_submit) \| if _eq({{__e}},sm_lead_submit) \| if _eq({{__e}},sm_quote_submit) |
| Same | Click listener | none | none | {} | if _eq({{__e}},gtm.js) |
| Same | Element visibility listener | none | none | {} | if _eq({{__e}},gtm.js) |
| Same | Element visibility listener | none | none | {} | if _eq({{__e}},gtm.js) |
| Same | Form submit listener | none | none | {} | if _eq({{__e}},gtm.js) |
| Same | Form submit listener | none | none | {} | if _eq({{__e}},gtm.js) |
| Same | GA4 event | brochure_download | none | {"source":"{{variable}}"} | if _eq({{__e}},brochure_download) |
| Drift | GA4 event | click_to_call | none | {"value":"150","currency":"GBP"} | if _cn({{__v:gtm.elementUrl}},tel:) && _eq({{__e}},gtm.linkClick) && _re({{__v:gtm.triggers}},(^$\|((^\|,)245755202_7($\|,)))) |
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
