#!/usr/bin/env python3
"""Idempotently backfill GHL chat click IDs and Supabase enquiries.

The default mode is read-only and prints/writes a redacted plan.  Pass
``--apply`` to perform the narrowly scoped GHL updates and enquiry inserts.
"""

import argparse
import datetime as dt
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter


LOC = "7JJQ1fkS2z8zv5XIDV0P"
SM_ORG = "3770972d-1bbd-417b-b413-297e844db285"
GHL_BASE = "https://services.leadconnectorhq.com"
GHL_FIELD_IDS = {
    "gclid": "nPQzJlq77T1azcH3K76i",
    "gbraid": "2JIK32V5Zc4B1TY3pq14",
    "wbraid": "uk0TSvGQiLAZvdZiZ1gp",
}
CLICK_KEYS = tuple(GHL_FIELD_IDS)
UTM_KEYS = ("utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content")
AD_SOURCE_FIELD_ID = "8rV7EBJDM6HhxEICWKKd"
# GHL contact fields mirrored fill-blank-only from the Supabase enquiry payload.
MIRROR_FIELD_IDS = {
    "utm_source": "FVvm3mLoUvumwHqLvuMa",
    "utm_medium": "cRHBo0Ol4gKESi6YcOeH",
    "utm_campaign": "lCQ4Q7NE3ZiCtVvLfCFH",
    "utm_term": "NapDuNh9NvFVd9GnAa4Z",
    "utm_content": "TOvFPq81QAkOhLASEx1v",
    "landing_page": "LZYwQ24LRc2Z7a5u9LWg",
    "lead_source": "hibtgT5Fud7K91PnKPen",
    "lead_channel": "Na4hf6DRzmn3MZHiUJy1",
}
# Extra fields copied only from a Supabase enquiry row (quotes/forms), fill-blank only.
ENQUIRY_MIRROR_FIELD_IDS = {
    **GHL_FIELD_IDS,
    "last_gclid": "JgZtSf521VQ1VpgCBwQF",
    "last_gbraid": "enCgjyv1ppTZ62Z6pwE9",
    "last_wbraid": "c9sjGGhaNrr9EpApV5Sy",
    "last_utm_source": "1EH7hMMYGrjHSem5K8I9",
    "last_utm_medium": "aJlzUlYplOuWKdsxaDft",
    "last_utm_campaign": "iLYeISfTJcBlUSnzWllw",
    "last_utm_term": "P91sMC50MsvJgyoKJdKs",
    "last_utm_content": "qOpcUwONwqYuf2PVQ26X",
}
ENQUIRY_TRACKING_COLUMNS = tuple(MIRROR_FIELD_IDS) + tuple(ENQUIRY_MIRROR_FIELD_IDS)
LOG_DIR = os.environ.get("SM_CHAT_SYNC_LOG_DIR", "/workspace/sm-ads-offline/ghl-chat-sync/logs")


class ApiError(RuntimeError):
    """An intentionally redacted HTTP error safe to include in output."""


def load_env(path):
    """Load the repository's simple KEY=VALUE format without overwriting env."""
    try:
        with open(path, encoding="utf-8") as env_file:
            for line in env_file:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    key, value = line.split("=", 1)
                    os.environ.setdefault(key, value)
    except FileNotFoundError:
        pass


def request_json(label, url, headers, method="GET", payload=None):
    data = None if payload is None else json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            raw = response.read()
            return json.loads(raw) if raw else None
    except urllib.error.HTTPError as exc:
        # Never include exc/url/body: they can contain tokens, PII, or click IDs.
        raise ApiError(f"{label} failed with HTTP {exc.code}") from None
    except urllib.error.URLError as exc:
        raise ApiError(f"{label} failed with a network error") from None
    except (json.JSONDecodeError, UnicodeDecodeError):
        raise ApiError(f"{label} returned invalid JSON") from None


def ghl_headers(token):
    return {
        "Authorization": "Bearer " + token,
        "Version": "2021-07-28",
        "User-Agent": "sm-chat-sync/1.0",
        "Content-Type": "application/json",
        "Accept": "application/json",
    }


def supabase_headers(key, prefer=None):
    headers = {
        "apikey": key,
        "Authorization": "Bearer " + key,
        "User-Agent": "sm-chat-sync/1.0",
        "Accept": "application/json",
        "Content-Type": "application/json",
    }
    if prefer:
        headers["Prefer"] = prefer
    return headers


def supabase_url(base, table, params=None):
    url = base.rstrip("/") + "/rest/v1/" + table
    if params:
        url += "?" + urllib.parse.urlencode(params, safe="(),.*:>")
    return url


def search_contacts(token, since, now):
    contacts = []
    page = 1
    while True:
        payload = {
            "locationId": LOC,
            "pageLimit": 100,
            "page": page,
            "filters": [{
                "field": "dateAdded",
                "operator": "range",
                "value": {"gte": since, "lte": now},
            }],
        }
        result = request_json(
            "GHL contact search",
            GHL_BASE + "/contacts/search",
            ghl_headers(token),
            method="POST",
            payload=payload,
        ) or {}
        batch = result.get("contacts") or []
        if not isinstance(batch, list):
            raise ApiError("GHL contact search returned an unexpected response")
        contacts.extend(batch)
        if len(batch) < 100:
            return contacts
        page += 1


def get_contact(token, contact_id):
    quoted = urllib.parse.quote(str(contact_id), safe="")
    result = request_json(
        "GHL contact read",
        GHL_BASE + "/contacts/" + quoted,
        ghl_headers(token),
    ) or {}
    contact = result.get("contact", result)
    if not isinstance(contact, dict):
        raise ApiError("GHL contact read returned an unexpected response")
    return contact


def update_contact(token, contact_id, updates):
    quoted = urllib.parse.quote(str(contact_id), safe="")
    return request_json(
        "GHL contact update",
        GHL_BASE + "/contacts/" + quoted,
        ghl_headers(token),
        method="PUT",
        payload={"customFields": updates},
    )


def add_tags(token, contact_id, tags):
    quoted = urllib.parse.quote(str(contact_id), safe="")
    return request_json(
        "GHL contact tags",
        GHL_BASE + "/contacts/" + quoted + "/tags",
        ghl_headers(token),
        method="POST",
        payload={"tags": tags},
    )


def mask_email(value):
    value = str(value or "").strip()
    if "@" not in value:
        return ""
    local, domain = value.rsplit("@", 1)
    return ((local[:1] + "***") if local else "***") + "@" + domain


def phone_digits(value):
    return "".join(re.findall(r"\d", str(value or "")))


def is_excluded_contact(contact, exclusion):
    exclusion = exclusion or {}
    email = str(contact.get("email") or "").strip().lower()
    phone = phone_digits(contact.get("phone"))[-10:]
    return (str(contact.get("id") or "") in exclusion.get("contact_ids", set()) or
            bool(email and email in exclusion.get("emails", set())) or
            bool(phone and phone in exclusion.get("phones", set())))


def parse_time(value):
    if not value:
        return None
    try:
        parsed = dt.datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=dt.timezone.utc)
        return parsed.astimezone(dt.timezone.utc)
    except (TypeError, ValueError):
        return None


def iso(value):
    return value.astimezone(dt.timezone.utc).isoformat().replace("+00:00", "Z")


def redact_click(value):
    value = str(value)
    return {"prefix": value[:6], "length": len(value)}


def contact_name(contact):
    direct = str(contact.get("name") or "").strip()
    if direct:
        return direct
    return " ".join(
        str(contact.get(key) or "").strip()
        for key in ("firstName", "lastName")
        if str(contact.get(key) or "").strip()
    )


def is_chat(contact):
    attribution = contact.get("attributionSource") or {}
    medium = attribution.get("medium", "") if isinstance(attribution, dict) else ""
    return "chat" in str(contact.get("source") or "").lower() or "chat" in str(medium).lower()


def classify(contact):
    if is_chat(contact):
        return "chat"
    source = str(contact.get("source") or "").strip()
    tags = contact.get("tags") or []
    tags = {str(tag).lower() for tag in (tags if isinstance(tags, list) else [tags])}
    attribution = contact.get("attributionSource") or {}
    medium = str(attribution.get("medium") or "").lower() if isinstance(attribution, dict) else ""
    if ("call" in source.lower() or tags.intersection({"call", "missed-call"}) or
            (medium in ("other", "") and not contact.get("email") and
             contact.get("phone") and not source)):
        return "call"
    if source.startswith("Website") or tags.intersection({"website-lead", "quote-request"}):
        return "form"
    return "other"


def is_test_contact(contact):
    email = str(contact.get("email") or "").strip().lower()
    names = [contact.get("name"), contact.get("firstName"), contact.get("lastName")]
    tags = contact.get("tags") or []
    if not isinstance(tags, list):
        tags = [tags]
    name_test = any(re.search(r"(^|[^a-z])test(?=$|[^a-z])", str(value or ""), re.I)
                    for value in names)
    email_test = False
    if "@" in email:
        local, domain = email.rsplit("@", 1)
        email_test = (local == "test" or "+qa" in local or "+test" in local or
                      "test+" in local or domain in ("example.com", "test.com") or
                      email == "admin@unifynow.digital" or local == "info+qa")
    tracking = {}
    for key in ("attributionSource", "lastAttributionSource"):
        if isinstance(contact.get(key), dict):
            tracking.update(contact[key])
    tracking_test = any(str(tracking.get(key) or "").strip().lower().startswith("test")
                        for key in ("gclid", "gbraid", "wbraid", "utmSource", "utmCampaign", "campaign"))
    marker_test = any(str(tracking.get(key) or "").strip().lower() in ("qa", "test")
                      for key in ("utmSource", "utmCampaign", "campaign"))
    return (name_test or email_test or tracking_test or marker_test or
            any(str(tag).strip().lower() == "test" for tag in tags))


def custom_field_values(contact):
    values = {}
    for field in contact.get("customFields") or []:
        if isinstance(field, dict) and field.get("id"):
            values[str(field["id"])] = field.get("value", field.get("field_value"))
    return values


def clicks_from_mapping(value):
    if not isinstance(value, dict):
        return {}
    return {key: str(value[key]).strip() for key in CLICK_KEYS
            if value.get(key) is not None and str(value[key]).strip()
            and str(value[key]).strip().lower() not in ("none", "null", "undefined")}


def utm_from_attribution(attr):
    if not isinstance(attr, dict):
        return {}
    source_keys = {
        "utm_source": ("utmSource", "utm_source"),
        "utm_medium": ("utmMedium", "utm_medium"),
        "utm_campaign": ("utmCampaign", "campaign", "utm_campaign"),
        "utm_term": ("utmTerm", "utm_term"),
        "utm_content": ("utmContent", "utm_content"),
    }
    result = {}
    for target, candidates in source_keys.items():
        for candidate in candidates:
            raw = attr.get(candidate)
            value = str(raw).strip()[:100] if raw is not None else ""
            if value and value.lower() not in ("none", "null", "undefined"):
                result[target] = value
                break
    return result


def url_params(attr):
    value = attr.get("url") if isinstance(attr, dict) else None
    if not value:
        return {}
    try:
        text = str(value)
        query = urllib.parse.urlsplit(text if "://" in text else "//" + text).query
        return {k: v[0] for k, v in urllib.parse.parse_qs(query).items() if v}
    except ValueError:
        return {}


def fill_utms(utms, attr, clicks):
    """Fill missing UTMs from the landing URL query only. Never derives or
    guesses a value (Supabase is the source of truth). Never overwrites.
    Always returns False (kept for call-site compatibility)."""
    params = url_params(attr)
    for key in UTM_KEYS:
        raw = str(params.get(key) or "").strip()[:100]
        if key not in utms and raw and raw.lower() not in ("none", "null", "undefined"):
            utms[key] = raw
    return False


def is_google_ads(clicks, utms):
    if any(clicks.get(key) for key in CLICK_KEYS):
        return True
    source = str(utms.get("utm_source") or "").strip().lower()
    medium = str(utms.get("utm_medium") or "").strip().lower()
    return source == "google" and medium != "organic"


def contact_clicks(contact):
    for field, label in (("attributionSource", "attributionSource"),
                         ("lastAttributionSource", "lastAttributionSource")):
        clicks = clicks_from_mapping(contact.get(field))
        if clicks:
            return clicks, label
    fields = custom_field_values(contact)
    clicks = {key: str(fields[field_id]).strip() for key, field_id in GHL_FIELD_IDS.items()
              if str(fields.get(field_id) or "").strip()}
    return (clicks, "custom_fields") if clicks else ({}, None)


def native_clicks(contact):
    return contact_clicks(contact)[0]


def in_window(value, centre, before, after):
    moment = parse_time(value)
    return bool(moment and centre and centre - before <= moment <= centre + after)


def choose_click_intent(contact, kind, intents, contacts):
    centre = parse_time(contact.get("dateAdded"))
    email = str(contact.get("email") or "").strip().lower()
    phone = phone_digits(contact.get("phone"))[-10:]
    usable = [row for row in intents if not row.get("matched_ghl_contact_id") and clicks_from_mapping(row)]
    identity = [row for row in usable
                if in_window(row.get("created_at"), centre, dt.timedelta(minutes=30), dt.timedelta(minutes=10))
                and ((email and str(row.get("email") or "").strip().lower() == email) or
                     (phone and phone_digits(row.get("phone"))[-10:] == phone))]
    if identity:
        return max(identity, key=lambda row: parse_time(row.get("created_at")))
    # No time-only fallback: an anonymous tap/chat click near in time is NOT proof
    # it belongs to this contact (27 Oct 2026: another visitor's phone-tap click IDs
    # were copied onto a different caller's contact). Identity (email/phone) only.
    return None


def in_order_window(value, order_time):
    return in_window(value, order_time, dt.timedelta(days=90), dt.timedelta(days=1))


def unique_people(rows):
    return {str(row.get("id")): row for row in rows if row.get("id")}


def find_person(contact, supabase_base, key):
    headers = supabase_headers(key)
    email = str(contact.get("email") or "").strip().lower()
    if email:
        rows = request_json(
            "Supabase people email lookup",
            supabase_url(supabase_base, "people", {
                "organization_id": "eq." + SM_ORG,
                "email": "ilike." + email,
                "select": "id,email,phone",
            }),
            headers,
        ) or []
        matches = unique_people(rows)
        if matches:
            return matches, "email"

    wanted = phone_digits(contact.get("phone"))[-10:]
    if not wanted:
        return {}, None
    rows = request_json(
        "Supabase people phone lookup",
        supabase_url(supabase_base, "people", {
            "organization_id": "eq." + SM_ORG,
            "phone": "not.is.null",
            "select": "id,email,phone",
        }),
        headers,
    ) or []
    matches = unique_people(
        row for row in rows if phone_digits(row.get("phone"))[-10:] == wanted
    )
    return matches, "phone"


def enquiry_exists(contact_id, person_id, gclid, supabase_base, key):
    headers = supabase_headers(key)
    common = {"organization_id": "eq." + SM_ORG, "select": "id", "limit": "1"}
    by_contact = request_json(
        "Supabase enquiry contact lookup",
        supabase_url(supabase_base, "enquiries", {
            **common, "details->>ghl_contact_id": "eq." + str(contact_id)
        }),
        headers,
    ) or []
    if by_contact:
        return True, "existing_ghl_contact"
    if gclid:
        by_gclid = request_json(
            "Supabase enquiry gclid lookup",
            supabase_url(supabase_base, "enquiries", {
                **common,
                "person_id": "eq." + str(person_id),
                "gclid": "eq." + str(gclid),
            }),
            headers,
        ) or []
        if by_gclid:
            return True, "existing_person_gclid"
    return False, None


def source_path(attribution):
    value = attribution.get("url") if isinstance(attribution, dict) else None
    if not value:
        return None
    try:
        text = str(value)
        parsed = urllib.parse.urlsplit(text if "://" in text else "//" + text)
        return parsed.path or "/"
    except ValueError:
        return None


def enquiry_payload(contact, person_id, clicks, today, kind="chat", used_intent=None):
    attribution = contact.get("attributionSource") or {}
    if not isinstance(attribution, dict):
        attribution = {}
    contact_id = str(contact.get("id") or "")
    path = source_path(attribution)
    first_utms = utm_from_attribution(attribution)
    intent_utms = utm_from_attribution(used_intent)
    for key in UTM_KEYS:
        if key not in first_utms and key in intent_utms:
            first_utms[key] = intent_utms[key]
    derived = fill_utms(first_utms, attribution, clicks)
    last_attribution = contact.get("lastAttributionSource") or {}
    if not isinstance(last_attribution, dict):
        last_attribution = {}
    last_utms = utm_from_attribution(last_attribution)
    last_clicks = clicks_from_mapping(last_attribution)
    if last_attribution:
        derived = fill_utms(last_utms, last_attribution, last_clicks) or derived
    return {
        "organization_id": SM_ORG,
        "person_id": person_id,
        "channel": "contact",
        "sub_type": "phone-call" if kind == "call" else "web-chat",
        "lead_channel": "Phone" if kind == "call" else "Web chat",
        "lead_source": "Google Ads" if is_google_ads(clicks, first_utms) else "Unknown",
        "status": "new",
        "source_page": path,
        "landing_page": path,
        "gclid": clicks.get("gclid"),
        "gbraid": clicks.get("gbraid"),
        "wbraid": clicks.get("wbraid"),
        **{key: first_utms.get(key) for key in UTM_KEYS},
        **{"last_" + key: last_utms.get(key) for key in UTM_KEYS},
        **{"last_" + key: last_clicks.get(key) for key in CLICK_KEYS},
        "created_at": contact.get("dateAdded"),
        "message": (
            f"{'Phone call' if kind == 'call' else 'Web chat'} lead (GHL contact {contact_id}). "
            f"Backfilled from GHL {kind} contact on {today}; no customer action needed."
        ),
        "details": {
            "ghl_contact_id": contact_id,
            "source": "ghl_chat_sync",
            "attribution_session_source": attribution.get("sessionSource"),
            **({"utm_derived": "google_ads_click"} if derived else {}),
        },
    }


def mirror_updates(fields, payload, extra_ids=None):
    """Fill-blank-only GHL updates for UTMs, landing page, lead source/channel
    and Ad source. A non-empty GHL value is never overwritten."""
    blank = lambda fid: fields.get(fid) is None or str(fields.get(fid)).strip() == ""
    ids = {**MIRROR_FIELD_IDS, **(extra_ids or {})}
    updates = [{"id": fid, "field_value": payload[key]} for key, fid in ids.items()
               if payload.get(key) and blank(fid)]
    if payload.get("lead_source") == "Google Ads" and blank(AD_SOURCE_FIELD_ID):
        updates.append({"id": AD_SOURCE_FIELD_ID, "field_value": "Google Ads"})
    return updates


def mirror_keys(updates):
    names = {fid: key for key, fid in {**MIRROR_FIELD_IDS, **ENQUIRY_MIRROR_FIELD_IDS}.items()}
    names[AD_SOURCE_FIELD_ID] = "ad_source"
    return [names.get(item["id"], item["id"]) for item in updates]


def existing_enquiry_row(contact_id, base, key):
    """The Supabase enquiry already linked to this GHL contact (tracking columns)."""
    rows = request_json("Supabase linked enquiry lookup", supabase_url(base, "enquiries", {
        "organization_id": "eq." + SM_ORG, "details->>ghl_contact_id": "eq." + str(contact_id),
        "select": "id,created_at," + ",".join(dict.fromkeys(ENQUIRY_TRACKING_COLUMNS)),
        "order": "created_at.asc", "limit": "1"}), supabase_headers(key)) or []
    return rows[0] if rows else None


def apply_mirror(token, contact_id, fields, payload, apply, extra_ids=None, existing_tags=None):
    """payload must be a Supabase enquiry row (or the exact row being inserted)."""
    updates = mirror_updates(fields, payload, extra_ids)
    have = {str(t).lower() for t in (existing_tags or [])}
    tags = [t for t in (["source-google-ads"] if payload.get("lead_source") == "Google Ads" else [])
            if t not in have]
    mirror = {"planned": mirror_keys(updates) + ["add_tag:" + t for t in tags]}
    if not apply:
        return mirror
    mirror.update({"applied": [], "errors": []})
    try:
        if updates:
            update_contact(token, contact_id, updates)
            verified = custom_field_values(get_contact(token, contact_id))
            bad = [item for item in updates if str(verified.get(item["id"]) or "") != str(item["field_value"])]
            if bad:
                raise ApiError("GHL mirror verification failed for: " + ",".join(mirror_keys(bad)))
            mirror["applied"] += mirror_keys(updates)
            mirror["verified"] = True
    except Exception as exc:
        mirror["errors"].append(str(exc) if isinstance(exc, ApiError) else type(exc).__name__)
    for tag in tags:
        try:
            add_tags(token, contact_id, [tag])
            mirror["applied"].append("add_tag:" + tag)
        except Exception as exc:
            mirror["errors"].append(str(exc) if isinstance(exc, ApiError) else type(exc).__name__)
    return mirror


def insert_enquiry(payload, supabase_base, key):
    result = request_json(
        "Supabase enquiry insert",
        supabase_url(supabase_base, "enquiries"),
        supabase_headers(key, "return=representation"),
        method="POST",
        payload=payload,
    ) or []
    if not isinstance(result, list) or not result or not result[0].get("id"):
        raise ApiError("Supabase enquiry insert returned no record id")
    return str(result[0]["id"])


def base_record(contact):
    phone = phone_digits(contact.get("phone"))
    return {
        "ghl_contact_id": str(contact.get("id") or ""),
        "name": contact_name(contact),
        "email": mask_email(contact.get("email")),
        "phone_last4": phone[-4:] if phone else "",
        "dateAdded": contact.get("dateAdded"),
        "type": classify(contact),
        "click_source": None,
        "native_click_keys_present": {},
        "ghl_field_updates": {"planned": [], "applied": [], "verified": False},
        "ghl_mirror": None,
        "person_id": None,
        "person_match_method": None,
        "enquiry": {"action": "skip", "reason": None, "new_enquiry_id": None},
    }


def fetch_intents(base, key, since, state):
    try:
        return request_json("Supabase click intents lookup", supabase_url(base, "click_intents", {
            "organization_id": "eq." + SM_ORG, "matched_ghl_contact_id": "is.null",
            "created_at": "gte." + since,
            "select": "id,email,phone,kind,created_at,gclid,gbraid,wbraid,utm_source,utm_medium,utm_campaign,utm_term,utm_content,matched_ghl_contact_id"}),
            supabase_headers(key)) or []
    except ApiError as exc:
        if "HTTP 404" in str(exc):
            state["unavailable"] = True
            return []
        raise


def patch_row(label, base, table, row_id, key, payload, extra=None):
    params = {"id": "eq." + str(row_id)}
    params.update(extra or {})
    return request_json(label, supabase_url(base, table, params), supabase_headers(key),
                        method="PATCH", payload=payload)


def nearest_enquiry(person_id, when, base, key):
    rows = request_json("Supabase nearest enquiry lookup", supabase_url(base, "enquiries", {
        "organization_id": "eq." + SM_ORG, "person_id": "eq." + str(person_id),
        "and": f"(created_at.gte.{iso(when-dt.timedelta(days=1))},created_at.lte.{iso(when+dt.timedelta(days=1))})",
        "select": "id,created_at," + ",".join(dict.fromkeys(ENQUIRY_TRACKING_COLUMNS))}), supabase_headers(key)) or []
    rows = [row for row in rows if parse_time(row.get("created_at"))]
    return min(rows, key=lambda row: abs((parse_time(row["created_at"]) - when).total_seconds())) if rows else None


def process_contact(contact, args, token, supabase_base, supabase_key, today,
                    intents=None, all_contacts=None, matched_at=None):
    record = base_record(contact)
    contact_id = record["ghl_contact_id"]
    try:
        if not contact_id:
            raise ApiError("GHL contact has no id")
        if str(contact.get("locationId") or "") != LOC:
            record["enquiry"]["reason"] = "wrong_location"
            return record
        kind = classify(contact)
        if kind not in args.types:
            record["enquiry"]["reason"] = "type_not_selected"
            return record
        if is_test_contact(contact):
            record["enquiry"]["reason"] = "test_contact"
            return record
        if is_excluded_contact(contact, getattr(args, "exclusion", None)):
            record["enquiry"]["reason"] = "excluded_order"
            return record

        full_contact = get_contact(token, contact_id)
        if str(full_contact.get("locationId") or "") != LOC:
            record["enquiry"]["reason"] = "wrong_location"
            return record
        if is_test_contact(full_contact):
            record["enquiry"]["reason"] = "test_contact"
            return record
        if is_excluded_contact(full_contact, getattr(args, "exclusion", None)):
            record["enquiry"]["reason"] = "excluded_order"
            return record
        if kind == "form":
            # Quotes/forms: Supabase is the source of truth. If the website's own GHL
            # hand-off failed (e.g. the n8n Gmail safety net created the contact),
            # copy the enquiry's click IDs/UTMs/landing page/Ad source onto blank GHL fields.
            record["supabase_mirror"] = mirror_form_from_supabase(
                full_contact, args, token, supabase_base, supabase_key)
        clicks, click_source = contact_clicks(full_contact)
        used_intent = None
        if not clicks:
            used_intent = choose_click_intent(full_contact, kind, intents or [], all_contacts or [contact])
            if used_intent:
                clicks, click_source = clicks_from_mapping(used_intent), "click_intents"
        record["click_source"] = click_source
        record["native_click_keys_present"] = {
            name: redact_click(value) for name, value in clicks.items()
        }
        if not clicks:
            record["enquiry"]["reason"] = "no_click_id"
            return record
        people, method = find_person(contact, supabase_base, supabase_key)
        record["person_match_method"] = method
        if not people:
            record["enquiry"]["reason"] = "no_person"
            return record
        if len(people) > 1:
            record["enquiry"]["reason"] = "ambiguous_person"
            return record
        person_id = next(iter(people))
        record["person_id"] = person_id
        if str(person_id) in (getattr(args, "exclusion", None) or {}).get("person_ids", set()):
            record["enquiry"]["reason"] = "excluded_order"
            return record
        fields = custom_field_values(full_contact)
        updates = [
            {"id": GHL_FIELD_IDS[name], "field_value": value}
            for name, value in clicks.items()
            if fields.get(GHL_FIELD_IDS[name]) is None or str(fields.get(GHL_FIELD_IDS[name])).strip() == ""
        ]
        record["ghl_field_updates"]["planned"] = [
            {"key": name, "field_id": GHL_FIELD_IDS[name], "value": redact_click(clicks[name])}
            for name in CLICK_KEYS
            if any(item["id"] == GHL_FIELD_IDS[name] for item in updates)
        ]
        if args.apply and updates:
            update_contact(token, contact_id, updates)
            verified_contact = get_contact(token, contact_id)
            verified = custom_field_values(verified_contact)
            failed = [
                name for name, value in clicks.items()
                if any(item["id"] == GHL_FIELD_IDS[name] for item in updates)
                and str(verified.get(GHL_FIELD_IDS[name]) or "") != value
            ]
            if failed:
                raise ApiError("GHL contact update verification failed for: " + ",".join(failed))
            record["ghl_field_updates"]["applied"] = list(record["ghl_field_updates"]["planned"])
            record["ghl_field_updates"]["verified"] = True
        if args.apply and used_intent:
            patch_row("Supabase click intent update", supabase_base, "click_intents",
                      used_intent["id"], supabase_key,
                      {"matched_ghl_contact_id": contact_id, "matched_at": matched_at},
                      {"matched_ghl_contact_id": "is.null"})

        if kind == "form":
            when = parse_time(full_contact.get("dateAdded"))
            nearest = nearest_enquiry(person_id, when, supabase_base, supabase_key) if when else None
            if nearest and all(nearest.get(name) is None for name in CLICK_KEYS):
                record["enquiry"] = {"action": "patched" if args.apply else "plan_patch",
                                     "reason": None, "new_enquiry_id": str(nearest["id"])}
                if args.apply:
                    patch_row("Supabase enquiry update", supabase_base, "enquiries", nearest["id"],
                              supabase_key, {name: clicks.get(name) for name in CLICK_KEYS},
                              {name: "is.null" for name in CLICK_KEYS})
            else:
                record["enquiry"]["reason"] = "no_patchable_enquiry"
            return record

        exists, reason = enquiry_exists(
            contact_id, person_id, clicks.get("gclid"), supabase_base, supabase_key
        )
        if exists:
            record["enquiry"]["reason"] = reason
            # Older chat/call contacts: backfill blank GHL fields from the Supabase
            # row only (never from GHL-side or derived values).
            row = existing_enquiry_row(contact_id, supabase_base, supabase_key)
            record["ghl_mirror"] = (apply_mirror(token, contact_id, fields, row, args.apply,
                                                 existing_tags=full_contact.get("tags"))
                                    if row else {"planned": [], "reason": "no_linked_supabase_row"})
            return record
        if not args.apply:
            record["enquiry"] = {
                "action": "plan_insert", "reason": None, "new_enquiry_id": None
            }
            preview = enquiry_payload(full_contact, person_id, clicks, today, kind, used_intent=used_intent)
            record["ghl_mirror"] = apply_mirror(token, contact_id, fields, preview, False,
                                                existing_tags=full_contact.get("tags"))
            return record

        payload = enquiry_payload(full_contact, person_id, clicks, today, kind, used_intent=used_intent)
        new_id = insert_enquiry(payload, supabase_base, supabase_key)
        record["enquiry"] = {
            "action": "inserted", "reason": None, "new_enquiry_id": new_id
        }
        record["ghl_mirror"] = apply_mirror(token, contact_id, fields, payload, True,
                                            existing_tags=full_contact.get("tags"))
        return record
    except Exception as exc:
        record["error"] = str(exc) if isinstance(exc, ApiError) else type(exc).__name__
        record["enquiry"] = {
            "action": "skip", "reason": "error", "new_enquiry_id": None
        }
        return record


def mirror_form_from_supabase(full_contact, args, token, base, key):
    try:
        people, method = find_person(full_contact, base, key)
        if len(people or []) != 1:
            return {"reason": "no_person" if not people else "ambiguous_person"}
        when = parse_time(full_contact.get("dateAdded"))
        row = nearest_enquiry(next(iter(people)), when, base, key) if when else None
        if not row:
            return {"reason": "no_enquiry"}
        fields = custom_field_values(full_contact)
        return apply_mirror(token, str(full_contact.get("id")), fields, row, args.apply,
                            ENQUIRY_MIRROR_FIELD_IDS, existing_tags=full_contact.get("tags"))
    except Exception as exc:
        return {"errors": [str(exc) if isinstance(exc, ApiError) else type(exc).__name__]}


def find_person_values(email, phone, base, key):
    return find_person({"email": email, "phone": phone}, base, key)


def duplicate_contact(token, email, phone):
    params = {"locationId": LOC}
    if email:
        params["email"] = email
    elif phone:
        params["number"] = phone
    else:
        return None
    result = request_json("GHL duplicate contact search",
                          GHL_BASE + "/contacts/search/duplicate?" + urllib.parse.urlencode(params),
                          ghl_headers(token)) or {}
    return result.get("contact") if isinstance(result.get("contact"), dict) else None


def process_order(order, args, token, base, key):
    record = {"order_number": str(order.get("order_number") or ""), "source": None,
              "reason": None, "action": "skip", "click_keys_present": {}}
    if record["order_number"] in (getattr(args, "exclusion", None) or {}).get("order_numbers", set()):
        record["reason"] = "excluded_order"
        return record
    order_time, person_id = parse_time(order.get("created_at")), order.get("person_id")
    if not person_id:
        people, _ = find_person_values(order.get("customer_email"), order.get("customer_phone"), base, key)
        if not people:
            record["reason"] = "no_person"; return record
        if len(people) != 1:
            record["reason"] = "ambiguous_person"; return record
        person_id = next(iter(people))
    enquiries = request_json("Supabase order enquiry lookup", supabase_url(base, "enquiries", {
        "organization_id": "eq." + SM_ORG, "person_id": "eq." + str(person_id),
        "or": "(gclid.not.is.null,gbraid.not.is.null,wbraid.not.is.null)",
        "select": "id,created_at,gclid,gbraid,wbraid", "order": "created_at.desc"}),
        supabase_headers(key)) or []
    eligible = [row for row in enquiries if order_time and in_order_window(row.get("created_at"), order_time)]
    clicks, enquiry_id = {}, None
    if eligible:
        chosen = max(eligible, key=lambda row: parse_time(row["created_at"]))
        clicks, enquiry_id, record["source"] = clicks_from_mapping(chosen), chosen["id"], "enquiry"
    else:
        contact = duplicate_contact(token, order.get("customer_email"), order.get("customer_phone"))
        if contact:
            contact = get_contact(token, contact["id"]) if contact.get("id") else contact
            contact_values, _ = contact_clicks(contact)
            if order_time and in_order_window(contact.get("dateAdded"), order_time) and contact_values:
                clicks, record["source"] = contact_values, "ghl_contact"
            elif contact_values:
                record["reason"] = "click_outside_window"
    if not clicks:
        record["reason"] = record["reason"] or ("click_outside_window" if enquiries else "no_click_in_window")
        return record
    record["click_keys_present"] = {name: redact_click(value) for name, value in clicks.items()}
    record["action"] = "patched" if args.apply else "plan_patch"
    if args.apply:
        payload = {name: clicks.get(name) for name in CLICK_KEYS}
        if enquiry_id:
            payload["click_enquiry_id"] = enquiry_id
        patch_row("Supabase order update", base, "orders", order["id"], key, payload,
                  {name: "is.null" for name in CLICK_KEYS})
    return record


def fetch_orders(base, key, since):
    return request_json("Supabase orders lookup", supabase_url(base, "orders", {
        "organization_id": "eq." + SM_ORG, "archived_at": "is.null", "is_test": "not.is.true",
        "gclid": "is.null", "gbraid": "is.null", "wbraid": "is.null", "created_at": "gte." + since,
        "select": "id,order_number,person_id,customer_email,customer_phone,created_at"}),
        supabase_headers(key)) or []


def build_exclusion(order_numbers, base, key, token):
    exclusion = {"order_numbers": set(order_numbers), "emails": set(), "phones": set(),
                 "person_ids": set(), "contact_ids": set()}
    if not order_numbers:
        return exclusion
    rows = request_json("Supabase excluded orders lookup", supabase_url(base, "orders", {
        "organization_id": "eq." + SM_ORG, "order_number": "in.(" + ",".join(order_numbers) + ")",
        "select": "id,order_number,person_id,customer_email,customer_phone"}),
        supabase_headers(key)) or []
    found = {str(row.get("order_number")) for row in rows}
    if found != set(order_numbers):
        raise ApiError("excluded orders not found: " + ",".join(sorted(set(order_numbers) - found)))
    for row in rows:
        email = str(row.get("customer_email") or "").strip().lower()
        phone = phone_digits(row.get("customer_phone"))[-10:]
        if email:
            exclusion["emails"].add(email)
        if phone:
            exclusion["phones"].add(phone)
        if row.get("person_id"):
            exclusion["person_ids"].add(str(row["person_id"]))
        duplicate = duplicate_contact(token, email, row.get("customer_phone"))
        if duplicate and duplicate.get("id"):
            exclusion["contact_ids"].add(str(duplicate["id"]))
    return exclusion


def summarize(records, mode, orders=None, intents_unavailable=False):
    orders = orders or []
    reasons = Counter(
        item["enquiry"].get("reason") for item in records if item["enquiry"].get("reason")
    )
    actions = Counter(item["enquiry"].get("action") for item in records)
    by_type = {}
    for kind in ("chat", "call", "form"):
        rows = [row for row in records if row["type"] == kind]
        by_type[kind] = {"contacts": len(rows),
                         "with_click": sum(bool(row["native_click_keys_present"]) for row in rows),
                         "ghl_updates_planned": sum(len(row["ghl_field_updates"]["planned"]) for row in rows),
                         "enquiry_inserts_planned": sum(row["enquiry"]["action"] == "plan_insert" for row in rows),
                         "enquiry_patches_planned": sum(row["enquiry"]["action"] == "plan_patch" for row in rows)}
    result = {
        "mode": mode,
        "contacts": len(records),
        "errors": sum("error" in item for item in records),
        "ghl_updates_planned": sum(len(item["ghl_field_updates"]["planned"]) for item in records),
        "ghl_updates_applied": sum(len(item["ghl_field_updates"]["applied"]) for item in records),
        "enquiry_actions": dict(sorted(actions.items())),
        "skip_reasons": dict(sorted(reasons.items())),
        "types": by_type,
        "orders": {"considered": len(orders),
                   "planned": sum(row["action"] == "plan_patch" for row in orders),
                   "by_source": dict(sorted(Counter(row["source"] for row in orders if row["source"]).items())),
                   "skip_reasons": dict(sorted(Counter(row["reason"] for row in orders if row["reason"]).items()))},
    }
    if intents_unavailable:
        result["notices"] = ["click_intents_unavailable"]
    return result


def parse_args(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--since")
    parser.add_argument("--contact-id", help="process only this GHL contact")
    parser.add_argument("--apply", action="store_true", help="perform GHL and Supabase writes")
    parser.add_argument("--types", default="chat,call,form")
    parser.add_argument("--orders-backfill", action=argparse.BooleanOptionalAction, default=True)
    parser.add_argument("--order-lookback-days", type=int, default=120)
    parser.add_argument("--exclude-orders", default="",
                        help="comma-separated order numbers to exclude")
    args = parser.parse_args(argv)
    args.since = args.since or iso(dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=60))
    args.types = {item.strip() for item in args.types.split(",") if item.strip()}
    args.exclude_orders = {item.strip() for item in args.exclude_orders.split(",") if item.strip()}
    if not args.types.issubset({"chat", "call", "form"}):
        parser.error("--types may contain only chat,call,form")
    return args


def validate_since(value):
    try:
        parsed = parse_time(value)
    except (TypeError, ValueError):
        raise SystemExit("--since must be an ISO-8601 timestamp") from None
    if parsed is None:
        raise SystemExit("--since must include a timezone")
    return value


def main(argv=None):
    args = parse_args(argv)
    validate_since(args.since)
    load_env("/home/box/.secrets/sm_ads_offline.env")
    load_env("/home/box/.secrets/sm_supabase.env")
    token = os.environ.get("SM_GHL_PIT_CALL_TRANSCRIPTS")
    supabase_base = os.environ.get("SUPABASE_URL")
    supabase_key = os.environ.get("SUPABASE_KEY")
    missing = [
        name for name, value in (
            ("SM_GHL_PIT_CALL_TRANSCRIPTS", token),
            ("SUPABASE_URL", supabase_base),
            ("SUPABASE_KEY", supabase_key),
        ) if not value
    ]
    if missing:
        print("Missing required configuration: " + ", ".join(missing), file=sys.stderr)
        return 2

    started = dt.datetime.now(dt.timezone.utc)
    now = started.isoformat().replace("+00:00", "Z")
    mode = "apply" if args.apply else "dry-run"
    args.exclusion = build_exclusion(args.exclude_orders, supabase_base, supabase_key, token)
    if args.contact_id:
        contacts = [get_contact(token, args.contact_id)]
    else:
        contacts = search_contacts(token, args.since, now)

    today = started.date().isoformat()
    intent_state = {}
    intents = fetch_intents(supabase_base, supabase_key,
                            iso(parse_time(args.since) - dt.timedelta(minutes=30)), intent_state)
    records = [
        process_contact(contact, args, token, supabase_base, supabase_key, today,
                        intents, contacts, now)
        for contact in contacts
    ]
    orders = []
    if args.orders_backfill:
        since = iso(started - dt.timedelta(days=args.order_lookback_days))
        orders = [process_order(row, args, token, supabase_base, supabase_key)
                  for row in fetch_orders(supabase_base, supabase_key, since)]
    output = {
        "generated_at": now,
        "mode": mode,
        "since": args.since,
        "location_id": LOC,
        "contact_id_filter": args.contact_id,
        "contacts": records,
        "orders": orders,
        "summary": summarize(records, mode, orders, intent_state.get("unavailable", False)),
    }
    os.makedirs(LOG_DIR, exist_ok=True)
    stamp = started.strftime("%Y%m%d-%H%M%S")
    path = os.path.join(LOG_DIR, f"{mode}-{stamp}-{started.microsecond:06d}.json")
    with open(path, "x", encoding="utf-8") as output_file:
        json.dump(output, output_file, indent=2, sort_keys=True)
        output_file.write("\n")
    print(json.dumps(output, indent=2, sort_keys=True))
    print("Log written to " + path, file=sys.stderr)
    return 1 if output["summary"]["errors"] else 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except ApiError as exc:
        print("Fatal: " + str(exc), file=sys.stderr)
        raise SystemExit(1) from None
