import calendar
import re
import time
from datetime import date, datetime

from django.core.cache import cache
from toolkitsy.logger import logger

from events.providers.base import BaseProvider, Event, UpstreamError

MONTH_PATTERN = re.compile(r"(19|20)\d{2}-(0[1-9]|1[0-2])")
FAILURE_TTL_SECONDS = 60  # Cache upstream failure for 60 seconds to avoid repeated calls.
UPSTREAM_FAILED = "upstream_failed"


class BadRequest(Exception):
    """Raised when query parameters are invalid. Handled as 400 by views."""


def normalize_place(text: str) -> str:
    """Normalize '台' to '臺' for consistent whitelist matching and location filtering."""
    return text.replace("台", "臺")


def _day(moc_time: str) -> date:
    # MoC format is 'YYYY/MM/DD HH:MM:SS'. Provider validates format, extract date here.
    return datetime.strptime(moc_time.split(" ")[0], "%Y/%m/%d").date()


def overlaps_month(event: Event, year: int, month: int) -> bool:
    """Return True if [start, end] interval overlaps with [first_day, last_day] of month."""
    start = _day(event.start_time)
    end = _day(event.end_time) if event.end_time else start
    first_day = date(year, month, 1)
    last_day = date(year, month, calendar.monthrange(year, month)[1])
    return start <= last_day and end >= first_day


def _validate(provider: BaseProvider, category: str, location: str, month: str) -> str:
    """Validate query parameters against provider whitelist and return normalized location."""
    if category not in {c["value"] for c in provider.categories}:
        raise BadRequest(f"unsupported category: {category!r}")
    place = normalize_place(location)
    if place not in {loc["value"] for loc in provider.locations}:
        raise BadRequest(f"unsupported location: {location!r}")
    if not MONTH_PATTERN.fullmatch(month):
        raise BadRequest(f"month must be YYYY-MM: {month!r}")
    return place


def _cached_events(provider: BaseProvider, category: str) -> tuple[list[Event], int | None]:
    """Cache-aside pattern. Return (events, cache_age_in_seconds or None on cache miss)."""
    key = f"events:{provider.code}:{category}"
    cached = cache.get(key)
    if cached == UPSTREAM_FAILED:
        logger.info("cache NEGATIVE key=%s", key)
        raise UpstreamError("upstream failed within the last 60 seconds")
    if cached is not None:
        events, stored_at = cached
        logger.info("cache HIT key=%s", key)
        return events, int(time.time() - stored_at)

    logger.info("cache MISS key=%s", key)
    try:
        events = provider.fetch_events(category)
    except UpstreamError:
        cache.set(key, UPSTREAM_FAILED, FAILURE_TTL_SECONDS)
        raise
    cache.set(key, (events, time.time()))  # TTL uses settings CACHES TIMEOUT (12 hours).
    return events, None


def search_events(provider: BaseProvider, category: str, location: str, month: str) -> dict:
    place = _validate(provider, category, location, month)
    events, cache_age = _cached_events(provider, category)
    year, mon = int(month[:4]), int(month[5:])

    matched = [
        e for e in events
        if place in normalize_place(e.location) and overlaps_month(e, year, mon)
    ]
    matched.sort(key=lambda e: e.start_time)  # ISO-like date string sorting matches chronological order.

    return {
        "events": matched,
        "meta": {"rawCount": len(events), "matchedCount": len(matched), "cacheAge": cache_age},
    }
