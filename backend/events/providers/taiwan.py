from datetime import datetime

import requests
import urllib3
from toolkitsy.logger import logger

from events.providers.base import BaseProvider, Event, UpstreamError

# Disable insecure request warning for MoC API certificate issue
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

MOC_API_URL = "https://cloud.culture.tw/frontsite/trans/SearchShowAction.do"
MOC_TIME_FORMAT = "%Y/%m/%d %H:%M:%S"

# 20 prefixes cover 22 administrative divisions (Hsinchu and Chiayi shared)
LOCATIONS = [
    {"value": "臺北", "zh": "臺北", "en": "Taipei"},
    {"value": "新北", "zh": "新北", "en": "New Taipei"},
    {"value": "基隆", "zh": "基隆", "en": "Keelung"},
    {"value": "桃園", "zh": "桃園", "en": "Taoyuan"},
    {"value": "新竹", "zh": "新竹", "en": "Hsinchu"},
    {"value": "苗栗", "zh": "苗栗", "en": "Miaoli"},
    {"value": "臺中", "zh": "臺中", "en": "Taichung"},
    {"value": "彰化", "zh": "彰化", "en": "Changhua"},
    {"value": "南投", "zh": "南投", "en": "Nantou"},
    {"value": "雲林", "zh": "雲林", "en": "Yunlin"},
    {"value": "嘉義", "zh": "嘉義", "en": "Chiayi"},
    {"value": "臺南", "zh": "臺南", "en": "Tainan"},
    {"value": "高雄", "zh": "高雄", "en": "Kaohsiung"},
    {"value": "屏東", "zh": "屏東", "en": "Pingtung"},
    {"value": "宜蘭", "zh": "宜蘭", "en": "Yilan"},
    {"value": "花蓮", "zh": "花蓮", "en": "Hualien"},
    {"value": "臺東", "zh": "臺東", "en": "Taitung"},
    {"value": "澎湖", "zh": "澎湖", "en": "Penghu"},
    {"value": "金門", "zh": "金門", "en": "Kinmen"},
    {"value": "連江", "zh": "連江", "en": "Lienchiang"},
]

CATEGORIES = [
    {"value": "6", "zh": "展覽", "en": "Exhibition"},
    {"value": "1", "zh": "音樂", "en": "Music"},
    {"value": "2", "zh": "戲劇", "en": "Theater"},
    {"value": "3", "zh": "舞蹈", "en": "Dance"},
    {"value": "4", "zh": "親子", "en": "Family"},
    {"value": "5", "zh": "獨立音樂", "en": "Indie Music"},
    {"value": "7", "zh": "講座", "en": "Lecture"},
    {"value": "8", "zh": "電影", "en": "Movie"},
    {"value": "11", "zh": "綜藝", "en": "Variety Show"},
    {"value": "17", "zh": "演唱會", "en": "Concert"},
    {"value": "19", "zh": "研習課程", "en": "Workshop"},
    {"value": "200", "zh": "閱讀", "en": "Reading"},
]


def parse_events(payload: list) -> list[Event]:
    """Parse MoC JSON response into Event objects."""
    events = []
    for item in payload:
        title = item["title"].strip()
        for index, show in enumerate(item["showInfo"]):
            end_time = show.get("endTime") or None
            # Validate timestamp format early
            datetime.strptime(show["time"], MOC_TIME_FORMAT)
            if end_time:
                datetime.strptime(end_time, MOC_TIME_FORMAT)
            events.append(Event(
                id=f"{item['UID']}-{index}",
                title=title,
                start_time=show["time"],
                end_time=end_time,
                location=show.get("location") or "",
                location_name=show.get("locationName") or "",
                on_sales=show.get("onSales") == "Y",
                price=show.get("price") or "",
            ))
    return events


class TaiwanProvider(BaseProvider):
    code = "tw"
    name = {"zh": "台灣", "en": "Taiwan"}
    locations = LOCATIONS
    categories = CATEGORIES

    def fetch_events(self, category: str) -> list[Event]:
        try:
            response = requests.get(
                MOC_API_URL,
                params={"method": "doFindTypeJ", "category": category},
                verify=False,
                timeout=15,
            )
            response.raise_for_status()
            payload = response.json()
        except (requests.RequestException, ValueError) as exc:
            logger.error("MoC request failed category=%s: %r", category, exc)
            raise UpstreamError(f"MoC request failed: {exc}") from exc

        if not isinstance(payload, list):
            logger.error("MoC payload is %s, expected list category=%s", type(payload).__name__, category)
            raise UpstreamError("MoC payload is not a list")

        try:
            events = parse_events(payload)
        except (KeyError, TypeError, AttributeError, ValueError) as exc:
            logger.error("MoC format drift category=%s: %r", category, exc)
            raise UpstreamError("MoC payload format changed") from exc

        if payload and not events:
            logger.error("MoC format drift category=%s: raw=%d parsed=0", category, len(payload))
            raise UpstreamError("MoC payload parsed to zero events")
        return events
