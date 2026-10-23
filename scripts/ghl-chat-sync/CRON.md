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
