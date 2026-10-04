from django.urls import path, include

urlpatterns = [
    path("health", include("health.urls")),
    path("health/", include("health.urls")),
]
