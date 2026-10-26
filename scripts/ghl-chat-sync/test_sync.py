import datetime as dt
import types
import unittest
from unittest import mock

import sm_ghl_chat_sync as sync


def contact(**values):
    base = {"id": "c1", "locationId": sync.LOC, "dateAdded": "2026-10-20T12:00:00Z"}
    base.update(values)
    return base


class SyncTests(unittest.TestCase):
    def test_utm_mapping_filters_placeholders(self):
        attr = {"utmSource": " google ", "utmMedium": "cpc", "campaign": " Autumn ",
                "utmTerm": "None", "utmContent": " headstones ", "wbraid": "None"}
        self.assertEqual(sync.utm_from_attribution(attr), {
            "utm_source": "google", "utm_medium": "cpc",
            "utm_campaign": "Autumn", "utm_content": "headstones",
        })
        self.assertEqual(sync.clicks_from_mapping(attr), {})

    def test_enquiry_payload_maps_last_touch_and_intent_fallback(self):
        row = contact(source="Live Chat", attributionSource={"utmSource": "google"},
                      lastAttributionSource={"utmSource": "bing", "utmMedium": "cpc",
                                             "utmCampaign": "last", "utmTerm": "term",
                                             "utmContent": "content", "gbraid": "last-braid"})
        payload = sync.enquiry_payload(
            row, "p1", {"gclid": "click"}, "2026-10-21",
            used_intent={"utm_medium": "cpc", "utm_campaign": "intent", "utm_term": "fallback"})
        self.assertEqual(payload["utm_source"], "google")
        self.assertEqual(payload["utm_medium"], "cpc")
        self.assertEqual(payload["utm_campaign"], "intent")
        self.assertEqual(payload["last_utm_campaign"], "last")
        self.assertEqual(payload["last_utm_term"], "term")
        self.assertEqual(payload["last_gbraid"], "last-braid")

    def test_google_ads_detection(self):
        self.assertTrue(sync.is_google_ads({"wbraid": "x"}, {}))
        self.assertTrue(sync.is_google_ads({}, {"utm_source": "GoOgLe"}))
        self.assertFalse(sync.is_google_ads({}, {"utm_source": "google", "utm_medium": "organic"}))
        self.assertFalse(sync.is_google_ads({}, {"utm_source": "bing", "utm_medium": "cpc"}))

    def test_shared_test_contact_rules(self):
        self.assertTrue(sync.is_test_contact(contact(firstName="qa-test")))
        self.assertTrue(sync.is_test_contact(contact(email="info+qa@company.co.uk")))
        self.assertTrue(sync.is_test_contact(contact(attributionSource={"gclid": "TEST-QA"})))
        self.assertFalse(sync.is_test_contact(contact(firstName="Celeste", lastName="Testa",
                                                      email="real@gmail.com")))

    def test_classify(self):
        self.assertEqual(sync.classify(contact(source="Live Chat")), "chat")
        self.assertEqual(sync.classify(contact(tags=["missed-call"])), "call")
        self.assertEqual(sync.classify(contact(source="", phone="0400000000",
                                               attributionSource={"medium": "other"})), "call")
        self.assertEqual(sync.classify(contact(source="Website quote")), "form")
        self.assertEqual(sync.classify(contact(tags=["quote-request"])), "form")
        self.assertEqual(sync.classify(contact(source="Referral")), "other")

    def test_click_source_precedence(self):
        row = contact(
            attributionSource={"gclid": "first"},
            lastAttributionSource={"gclid": "second", "gbraid": "last"},
            customFields=[{"id": sync.GHL_FIELD_IDS["gclid"], "value": "third"}],
        )
        self.assertEqual(sync.contact_clicks(row), ({"gclid": "first"}, "attributionSource"))
        row["attributionSource"] = {}
        self.assertEqual(sync.contact_clicks(row)[1], "lastAttributionSource")
        row["lastAttributionSource"] = {}
        self.assertEqual(sync.contact_clicks(row), ({"gclid": "third"}, "custom_fields"))

    def test_intent_identity_and_unique_time_windows(self):
        row = contact(email="a@example.com", source="Live Chat")
        intents = [{"id": "i1", "email": "a@example.com", "kind": "chat",
                    "created_at": "2026-10-20T11:30:00Z", "gclid": "x"}]
        self.assertEqual(sync.choose_click_intent(row, "chat", intents, [row])["id"], "i1")
        intents[0]["created_at"] = "2026-10-20T11:29:59Z"
        self.assertIsNone(sync.choose_click_intent(row, "chat", intents, [row]))

    def test_order_window_boundaries(self):
        centre = sync.parse_time("2026-10-20T12:00:00Z")
        self.assertTrue(sync.in_order_window("2026-07-22T12:00:00Z", centre))
        self.assertTrue(sync.in_order_window("2026-10-21T12:00:00Z", centre))
        self.assertFalse(sync.in_order_window("2026-07-22T11:59:59Z", centre))
        self.assertFalse(sync.in_order_window("2026-10-21T12:00:01Z", centre))

    def test_contact_dry_run_has_no_mutating_request(self):
        row = contact(source="Live Chat", email="a@example.com",
                      attributionSource={"gclid": "secret-click"})
        args = types.SimpleNamespace(apply=False, types={"chat", "call", "form"})
        calls = []

        def fake_request(label, url, headers, method="GET", payload=None):
            calls.append(method)
            if "people" in url:
                return []
            return {}

        with mock.patch.object(sync, "get_contact", return_value=row), \
             mock.patch.object(sync, "request_json", side_effect=fake_request):
            sync.process_contact(row, args, "token", "https://db.invalid", "key",
                                 "2026-10-21", [], [row], "2026-10-21T00:00:00Z")
        self.assertFalse({"PUT", "POST", "PATCH"}.intersection(calls))

    def test_google_ads_mirror_planned_in_dry_run(self):
        row = contact(source="Live Chat", email="a@gmail.com",
                      attributionSource={"gclid": "secret-click", "utmSource": "google"},
                      customFields=[{"id": sync.GHL_FIELD_IDS["gclid"], "value": "secret-click"}])
        args = types.SimpleNamespace(apply=False, types={"chat"}, exclusion={})
        with mock.patch.object(sync, "get_contact", return_value=row), \
             mock.patch.object(sync, "find_person", return_value=({"p1": {"id": "p1"}}, "email")), \
             mock.patch.object(sync, "enquiry_exists", return_value=(False, None)):
            result = sync.process_contact(row, args, "token", "https://db.invalid", "key",
                                          "2026-10-21", [], [row], "2026-10-21T00:00:00Z")
        self.assertIn("add_tag:source-google-ads", result["ghl_mirror"]["planned"])

    def test_google_ads_mirror_failure_does_not_undo_insert(self):
        row = contact(source="Live Chat", email="a@gmail.com",
                      attributionSource={"gclid": "secret-click", "utmSource": "google"},
                      customFields=[{"id": sync.GHL_FIELD_IDS["gclid"], "value": "secret-click"}])
        args = types.SimpleNamespace(apply=True, types={"chat"}, exclusion={})
        with mock.patch.object(sync, "get_contact", return_value=row), \
             mock.patch.object(sync, "find_person", return_value=({"p1": {"id": "p1"}}, "email")), \
             mock.patch.object(sync, "enquiry_exists", return_value=(False, None)), \
             mock.patch.object(sync, "insert_enquiry", return_value="e1"), \
             mock.patch.object(sync, "update_contact", side_effect=sync.ApiError("mirror failed")), \
             mock.patch.object(sync, "add_tags", side_effect=sync.ApiError("tags failed")):
            result = sync.process_contact(row, args, "token", "https://db.invalid", "key",
                                          "2026-10-21", [], [row], "2026-10-21T00:00:00Z")
        self.assertEqual(result["enquiry"]["action"], "inserted")
        self.assertEqual(len(result["ghl_mirror"]["errors"]), 2)

    def test_excluded_order_skips_contact_and_order_without_writes(self):
        exclusion = {"order_numbers": {"SM-1"}, "emails": {"blocked@gmail.com"},
                     "phones": set(), "person_ids": set(), "contact_ids": set()}
        args = types.SimpleNamespace(apply=True, types={"chat", "call", "form"},
                                     exclusion=exclusion)
        row = contact(source="Live Chat", email="blocked@gmail.com",
                      attributionSource={"gclid": "secret-click"})
        with mock.patch.object(sync, "get_contact") as get_contact, \
             mock.patch.object(sync, "request_json") as request:
            result = sync.process_contact(row, args, "token", "https://db.invalid", "key",
                                          "2026-10-21", [], [row], "2026-10-21T00:00:00Z")
            order = sync.process_order({"order_number": "SM-1"}, args, "token",
                                       "https://db.invalid", "key")
        self.assertEqual(result["enquiry"]["reason"], "excluded_order")
        self.assertEqual(order["reason"], "excluded_order")
        get_contact.assert_not_called()
        request.assert_not_called()


    def test_utm_filled_from_landing_url(self):
        row = contact(attributionSource={"url": "https://searsmelvin.co.uk/memorials?gclid=x&utm_source=google&utm_medium=cpc&utm_campaign=c1"})
        p = sync.enquiry_payload(row, "p1", {"gclid": "x"}, "2026-10-26")
        self.assertEqual((p["utm_source"], p["utm_medium"], p["utm_campaign"]), ("google", "cpc", "c1"))
        self.assertEqual(p["landing_page"], "/memorials")
        self.assertNotIn("utm_derived", p["details"])

    def test_utm_derived_only_for_click_without_utms(self):
        row = contact(attributionSource={"url": "https://searsmelvin.co.uk/memorials?gclid=x&gad_source=1", "utmSource": None})
        p = sync.enquiry_payload(row, "p1", {"gclid": "x"}, "2026-10-26")
        self.assertEqual((p["utm_source"], p["utm_medium"]), ("google", "cpc"))
        self.assertEqual(p["details"]["utm_derived"], "google_ads_click")
        row = contact(attributionSource={"url": "https://x/memorials?utm_source=bing"})
        p = sync.enquiry_payload(row, "p1", {"gclid": "x"}, "2026-10-26")
        self.assertEqual(p["utm_source"], "bing"); self.assertIsNone(p["utm_medium"])
        row = contact(attributionSource={"url": "https://x/memorials"})
        p = sync.enquiry_payload(row, "p1", {}, "2026-10-26")
        self.assertIsNone(p["utm_source"])

    def test_mirror_is_fill_blank_only(self):
        payload = {"utm_source": "google", "utm_medium": "cpc", "landing_page": "/memorials", "lead_source": "Google Ads"}
        fields = {sync.MIRROR_FIELD_IDS["utm_source"]: "kept", sync.MIRROR_FIELD_IDS["utm_medium"]: " "}
        keys = sync.mirror_keys(sync.mirror_updates(fields, payload))
        self.assertNotIn("utm_source", keys)
        self.assertEqual(sorted(keys), ["ad_source", "landing_page", "lead_source", "utm_medium"])
        self.assertEqual(sync.apply_mirror("t", "c1", fields, payload, False)["planned"][-1], "add_tag:source-google-ads")


if __name__ == "__main__":
    unittest.main()
