from django.http import JsonResponse
from django.urls import include, path

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

urlpatterns = [
    path("", root_view, name="root"),
    path("health", include("health.urls")),
    path("health/", include("health.urls")),
    path("api/v1/", include("events.urls")),
]
