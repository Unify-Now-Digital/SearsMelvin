# Hourly scheduling

Dry-run is the default. This runs at minute 7 each hour and prevents overlapping runs:

```cron
7 * * * * flock -n /tmp/sm-ghl-chat-sync.lock sh -c 'cd /workspace/sm-ads-offline/ghl-chat-sync && /usr/bin/python3 sm_ghl_chat_sync.py >> logs/cron.log 2>&1'
```

Writes remain off unless `--apply` is explicitly added. After validating dry-run output, the apply variant is:

```cron
# 7 * * * * flock -n /tmp/sm-ghl-chat-sync.lock sh -c 'cd /workspace/sm-ads-offline/ghl-chat-sync && /usr/bin/python3 sm_ghl_chat_sync.py --apply >> logs/cron.log 2>&1'
```

Configure `logrotate` for `logs/cron.log` (weekly rotation, compression, and a suitable retention period); the script's timestamped JSON files in `logs/` should also be expired according to the site's retention policy.

For n8n, use an hourly **Schedule Trigger** followed by an **Execute Command** node running the same `cd ... && python3 sm_ghl_chat_sync.py` command. n8n Cloud cannot execute local scripts, so cron on this box is preferred.

## Installed 21 Oct 2026 (box crontab, user box)

```cron
7 * * * * flock -n /tmp/sm-ghl-chat-sync.lock sh -c 'cd /workspace/sm-ads-offline/ghl-chat-sync && /usr/bin/python3 sm_ghl_chat_sync.py --apply --exclude-orders 285 >> logs/cron.log 2>&1'
```
Order 285 excluded (order + its GHL contact) until Arin says otherwise.

## 26 Oct 2026: cron missing after the 24 Oct box reset
The box reset removed the crontab (and `cron` itself), `/workspace/sm-ads-offline/ghl-chat-sync/` and the
`SUPABASE_URL` / `SUPABASE_KEY` env vars, so no chat sync has run since 24 Oct. Reinstall only with Arin's OK:
re-create the folder from this repo, restore the two Supabase env vars, install cron, and add the line above.
This version also mirrors UTMs, landing page, lead source/channel and Ad source to GHL (fill-blank only),
reads UTMs from the landing URL when GHL's utmSource/utmMedium are empty, and as a last resort records
`google`/`cpc` for a Google Ads click (flagged as `details.utm_derived = "google_ads_click"`).
