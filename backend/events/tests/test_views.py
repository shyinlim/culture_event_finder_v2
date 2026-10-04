from unittest.mock import patch

from django.core.cache import cache
from django.test import SimpleTestCase

from events.providers.base import Event, UpstreamError


class EventApiTests(SimpleTestCase):
    def setUp(self):
        cache.clear()

    def test_countries_carries_dropdown_options(self):
        res = self.client.get("/api/v1/countries")
        self.assertEqual(res.status_code, 200)
        tw = res.json()[0]
        self.assertEqual(tw["code"], "tw")
        self.assertEqual(len(tw["locations"]), 20)
        self.assertEqual(tw["categories"][0], {"value": "6", "zh": "展覽", "en": "Exhibition"})

    def test_unknown_country_is_404_json(self):
        res = self.client.get("/api/v1/jp/events?category=6&location=臺北&month=2026-07")
        self.assertEqual(res.status_code, 404)
        self.assertEqual(res.json()["error"]["code"], "not_found")

    def test_bad_params_are_400_json_not_500_html(self):
        for query in (
            "category=6",
            "category=²&location=臺北&month=2026-07",
            "category=6&location=臺北&month=0000-01",
        ):
            with self.subTest(query=query):
                res = self.client.get(f"/api/v1/tw/events?{query}")
                self.assertEqual(res.status_code, 400)
                self.assertEqual(res.json()["error"]["code"], "bad_request")

    # Patch search_events in events.views where it is imported and bound.
    @patch("events.views.search_events", side_effect=UpstreamError("MoC down"))
    def test_upstream_error_is_502(self, _):
        res = self.client.get("/api/v1/tw/events?category=6&location=臺北&month=2026-07")
        self.assertEqual(res.status_code, 502)
        self.assertEqual(res.json()["error"]["code"], "upstream_error")

    @patch("events.views.search_events")
    def test_success_uses_camel_case_contract(self, mock_search):
        mock_search.return_value = {
            "events": [
                Event(
                    "A1-0",
                    "夏夜交響",
                    "2026/07/12 19:30:00",
                    None,
                    "臺北市中正區",
                    "國家音樂廳",
                    True,
                    "800",
                )
            ],
            "meta": {"rawCount": 5, "matchedCount": 1, "cacheAge": None},
        }
        res = self.client.get("/api/v1/tw/events?category=6&location=臺北&month=2026-07")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(
            res.json()["events"][0],
            {
                "id": "A1-0",
                "title": "夏夜交響",
                "startTime": "2026/07/12 19:30:00",
                "endTime": None,
                "location": "臺北市中正區",
                "locationName": "國家音樂廳",
                "onSales": True,
                "price": "800",
            },
        )

    def test_every_response_has_request_id(self):
        res = self.client.get("/api/v1/countries", HTTP_X_REQUEST_ID="abc123")
        self.assertEqual(res["X-Request-ID"], "abc123")
        self.assertTrue(self.client.get("/health")["X-Request-ID"])
