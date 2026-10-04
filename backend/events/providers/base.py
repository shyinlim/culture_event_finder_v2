from abc import ABC, abstractmethod
from dataclasses import dataclass


class UpstreamError(Exception):
    """Raised when external data source fails: unreachable, timeout, or format drift."""


@dataclass(frozen=True)
class Event:
    id: str
    title: str
    start_time: str          # Original MoC format "YYYY/MM/DD HH:MM:SS"
    end_time: str | None
    location: str            # Street address
    location_name: str       # Venue name
    on_sales: bool
    price: str               # Raw text, e.g. "500", "0", "Free"


class BaseProvider(ABC):
    """Abstract base provider for event sources."""

    code: str                      # "tw"
    name: dict[str, str]           # {"zh": "台灣", "en": "Taiwan"}
    locations: list[dict]          # [{"value": "臺北", "zh": "臺北", "en": "Taipei"}, ...]
    categories: list[dict]         # [{"value": "6", "zh": "展覽", "en": "Exhibition"}, ...]

    @abstractmethod
    def fetch_events(self, category: str) -> list[Event]:
        """Fetch all events for a given category. Raises UpstreamError on failure."""
