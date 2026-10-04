import requests
import responses
from django.test import SimpleTestCase

from events.providers.base import UpstreamError
from events.providers.taiwan import MOC_API_URL, TaiwanProvider


def moc_item(uid="A1", shows=None):
    """Build a mock item in MoC API format."""
    return {
        "UID": uid,
        "title": " 夏夜交響 ",
        "showInfo": shows if shows is not None else [{
            "time": "2026/07/12 19:30:00",
            "endTime": "2026/07/14 21:00:00",
            "location": "臺北市中正區中山南路21-1號",
            "locationName": "國家音樂廳",
            "onSales": "Y",
            "price": "800",
        }],
    }


class TaiwanProviderTests(SimpleTestCase):
    def setUp(self):
        self.provider = TaiwanProvider()

    def test_location_prefixes_cover_22_counties(self):
        # 20 prefixes cover 22 administrative divisions (Hsinchu and Chiayi shared)
        values = [loc["value"] for loc in self.provider.locations]
        self.assertEqual(len(values), 20)
        for must_have in ("宜蘭", "連江", "新竹", "嘉義"):
            self.assertIn(must_have, values)

    @responses.activate
    def test_one_event_per_show(self):
        second_show = {
            "time": "2026/08/01 14:00:00", "endTime": "", "location": "高雄市鹽埕區",
            "locationName": "駁二", "onSales": "N", "price": "",
        }
        first_show = moc_item()["showInfo"][0]
        responses.add(responses.GET, MOC_API_URL, json=[moc_item(shows=[first_show, second_show])])

        events = self.provider.fetch_events("1")

        self.assertEqual([e.id for e in events], ["A1-0", "A1-1"])
        self.assertEqual(events[0].title, "夏夜交響")
        self.assertEqual(events[0].location_name, "國家音樂廳")
        self.assertTrue(events[0].on_sales)
        self.assertFalse(events[1].on_sales)
        self.assertIsNone(events[1].end_time)

    @responses.activate
    def test_empty_list_is_not_an_error(self):
        responses.add(responses.GET, MOC_API_URL, json=[])
        self.assertEqual(self.provider.fetch_events("6"), [])

    @responses.activate
    def test_non_list_payload_raises(self):
        responses.add(responses.GET, MOC_API_URL, json={"data": []})
        with self.assertRaises(UpstreamError):
            self.provider.fetch_events("6")

    @responses.activate
    def test_non_json_raises(self):
        responses.add(responses.GET, MOC_API_URL, body="<html>maintenance</html>")
        with self.assertRaises(UpstreamError):
            self.provider.fetch_events("6")

    @responses.activate
    def test_http_500_raises(self):
        responses.add(responses.GET, MOC_API_URL, status=500)
        with self.assertRaises(UpstreamError):
            self.provider.fetch_events("6")

    @responses.activate
    def test_timeout_raises(self):
        responses.add(responses.GET, MOC_API_URL, body=requests.exceptions.ConnectTimeout())
        with self.assertRaises(UpstreamError):
            self.provider.fetch_events("6")

    @responses.activate
    def test_renamed_field_is_format_drift(self):
        responses.add(responses.GET, MOC_API_URL, json=[{"UID": "A1", "name": "改名了"}])
        with self.assertRaises(UpstreamError):
            self.provider.fetch_events("6")

    @responses.activate
    def test_bad_time_format_is_format_drift(self):
        show = dict(moc_item()["showInfo"][0], time="2026-07-12")
        responses.add(responses.GET, MOC_API_URL, json=[moc_item(shows=[show])])
        with self.assertRaises(UpstreamError):
            self.provider.fetch_events("6")
