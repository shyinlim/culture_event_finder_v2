from django.http import JsonResponse
from django.views.decorators.http import require_GET

from events.providers import PROVIDERS
from events.providers.base import Event, UpstreamError
from events.services import BadRequest, search_events


def _error(status: int, code: str, message: str) -> JsonResponse:
    return JsonResponse({"error": {"code": code, "message": message}}, status=status)


def _event_to_json(event: Event) -> dict:
    return {
        "id": event.id,
        "title": event.title,
        "startTime": event.start_time,
        "endTime": event.end_time,
        "location": event.location,
        "locationName": event.location_name,
        "onSales": event.on_sales,
        "price": event.price,
    }


@require_GET
def countries(request):
    data = [
        {
            "code": p.code,
            "name": p.name,
            "locations": p.locations,
            "categories": p.categories,
        }
        for p in PROVIDERS.values()
    ]
    return JsonResponse(data, safe=False)


@require_GET
def events(request, country):
    # Determine 404 in view; do not catch KeyError broadly around search_events.
    # Otherwise any internal KeyError in service would masquerade as unsupported country.
    provider = PROVIDERS.get(country)
    if provider is None:
        return _error(404, "not_found", f"country not supported: {country}")
    try:
        result = search_events(
            provider,
            request.GET.get("category", ""),
            request.GET.get("location", ""),
            request.GET.get("month", ""),
        )
    except BadRequest as exc:
        return _error(400, "bad_request", str(exc))
    except UpstreamError as exc:
        return _error(502, "upstream_error", str(exc))
    return JsonResponse(
        {
            "events": [_event_to_json(e) for e in result["events"]],
            "meta": result["meta"],
        }
    )
