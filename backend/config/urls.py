from django.conf import settings
from django.http import HttpResponse, JsonResponse
from django.urls import include, path, re_path


def root_view(request):
    """Return basic API service information for the root path."""
    return JsonResponse(
        {
            "service": "culture-event-finder-backend",
            "status": "ok",
            "endpoints": {
                "health": "/health",
                "api": "/api/v1/",
            },
            "frontend": "http://localhost:8790",
        }
    )


def spa_catchall(request, path=""):
    """Serve the frontend SPA index.html for non-API/non-health routes."""
    dist_index = settings.BASE_DIR.parent / "frontend" / "dist" / "index.html"
    if dist_index.is_file():
        return HttpResponse(dist_index.read_text(encoding="utf-8"), content_type="text/html")
    if not path or path == "/":
        return root_view(request)
    return HttpResponse("Not Found", status=404)


urlpatterns = [
    path("health", include("health.urls")),
    path("health/", include("health.urls")),
    path("api/v1/", include("events.urls")),
    re_path(r"^(?P<path>.*)$", spa_catchall, name="spa_catchall"),
]
