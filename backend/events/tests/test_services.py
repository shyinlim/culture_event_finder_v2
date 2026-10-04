import responses
from django.core.cache import cache
from django.test import SimpleTestCase

from events.providers import PROVIDERS
from events.providers.base import Event, UpstreamError
from events.providers.taiwan import MOC_API_URL
from events.services import BadRequest, overlaps_month, search_events

TW = PROVIDERS["tw"]


def make_event(start, end):
    return Event(
        id="e1",
        title="t",
        start_time=start,
        end_time=end,
        location="臺北市",
        location_name="",
        on_sales=False,
        price="",
    )


class OverlapTests(SimpleTestCase):
    def test_year_long_exhibition_is_found_in_september(self):
        # Exhibitions span months; matching start month alone misses these events in September.
        event = make_event("2026/01/01 09:00:00", "2026/12/31 18:00:00")
        self.assertTrue(overlaps_month(event, 2026, 9))
        self.assertFalse(overlaps_month(event, 2025, 12))

    def test_missing_end_time_uses_start_time(self):
        event = make_event("2026/07/31 19:00:00", None)
        self.assertTrue(overlaps_month(event, 2026, 7))
        self.assertFalse(overlaps_month(event, 2026, 8))


class SearchEventsTests(SimpleTestCase):
    def setUp(self):
        cache.clear()

    def moc_show(self, location, time="2026/07/12 19:30:00"):
        return {
            "time": time,
            "endTime": "",
            "location": location,
            "locationName": "",
            "onSales": "N",
            "price": "0",
        }

    @responses.activate
    def test_end_to_end_from_moc_json_to_filtered_result(self):
        # End-to-end test without mocking provider from MoC payload to filtered results.
        responses.add(
            responses.GET,
            MOC_API_URL,
            json=[
                {"UID": "a", "title": "台北場", "showInfo": [self.moc_show("台北市中正區")]},
                {"UID": "b", "title": "高雄場", "showInfo": [self.moc_show("高雄市鹽埕區")]},
                {
                    "UID": "c",
                    "title": "八月場",
                    "showInfo": [self.moc_show("臺北市信義區", "2026/08/02 10:00:00")],
                },
            ],
        )

        # Support both traditional variant characters and prefix matching.
        first = search_events(TW, "6", "台北", "2026-07")
        self.assertEqual([e.title for e in first["events"]], ["台北場"])
        self.assertEqual(first["meta"], {"rawCount": 3, "matchedCount": 1, "cacheAge": None})
        self.assertEqual(
            first["events"][0].shows,
            [{"startTime": "2026/07/12 19:30:00", "endTime": None}],
        )

        # Second query uses cache and avoids upstream HTTP calls.
        second = search_events(TW, "6", "臺北", "2026-07")
        self.assertEqual(len(responses.calls), 1)
        self.assertIsNotNone(second["meta"]["cacheAge"])

    @responses.activate
    def test_multi_show_events_grouped_by_title_and_location(self):
        responses.add(
            responses.GET,
            MOC_API_URL,
            json=[
                {
                    "UID": "w1",
                    "title": "王羽佳",
                    "showInfo": [
                        {
                            "time": "2026/10/10 11:00:00",
                            "endTime": "2026/10/10 12:00:00",
                            "location": "臺北市中正區",
                            "locationName": "國家兩廳院",
                            "onSales": "N",
                            "price": "",
                        },
                        {
                            "time": "2026/10/10 14:00:00",
                            "endTime": "2026/10/10 15:00:00",
                            "location": "臺北市中正區",
                            "locationName": "國家兩廳院",
                            "onSales": "Y",
                            "price": "500",
                        },
                    ],
                },
                {
                    "UID": "w2",
                    "title": "王羽佳",
                    "showInfo": [
                        {
                            "time": "2026/10/20 19:00:00",
                            "endTime": "2026/10/20 21:00:00",
                            "location": "高雄市鳳山區",
                            "locationName": "衛武營",
                            "onSales": "Y",
                            "price": "600",
                        }
                    ],
                },
            ],
        )
        res = search_events(TW, "1", "臺北", "2026-10")
        self.assertEqual(len(res["events"]), 1)
        event = res["events"][0]
        self.assertEqual(event.title, "王羽佳")
        self.assertEqual(event.location, "臺北市中正區")
        self.assertEqual(event.start_time, "2026/10/10 11:00:00")
        self.assertEqual(event.end_time, "2026/10/10 15:00:00")
        self.assertTrue(event.on_sales)
        self.assertEqual(event.price, "500")
        self.assertEqual(
            event.shows,
            [
                {"startTime": "2026/10/10 11:00:00", "endTime": "2026/10/10 12:00:00"},
                {"startTime": "2026/10/10 14:00:00", "endTime": "2026/10/10 15:00:00"},
            ],
        )

    @responses.activate
    def test_upstream_failure_is_cached_for_60_seconds(self):
        responses.add(responses.GET, MOC_API_URL, status=500)
        with self.assertRaises(UpstreamError):
            search_events(TW, "6", "臺北", "2026-07")
        with self.assertRaises(UpstreamError):
            search_events(TW, "6", "臺北", "2026-07")
        # Upstream errors are cached to avoid hammering the slow upstream.
        self.assertEqual(len(responses.calls), 1)

    def test_invalid_params_raise_bad_request(self):
        cases = [
            ("999999", "臺北", "2026-07"),  # Unsupported category.
            ("²", "臺北", "2026-07"),  # Superscript digit rejected by whitelist.
            ("", "臺北", "2026-07"),  # Missing required parameter.
            ("6", "東京", "2026-07"),  # Unsupported location.
            ("6", "臺北", "0000-01"),  # Invalid year format.
            ("6", "臺北", "2026-13"),
        ]
        for category, location, month in cases:
            with self.subTest(category=category, location=location, month=month):
                with self.assertRaises(BadRequest):
                    search_events(TW, category, location, month)
