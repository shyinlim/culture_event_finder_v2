from django.urls import path

from events import views

urlpatterns = [
    path("countries", views.countries),
    path("<str:country>/events", views.events),
]
