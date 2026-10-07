import os
import re
from pathlib import Path
from django.core.exceptions import ImproperlyConfigured
from toolkitsy.logger import configure

configure()  # toolkitsy logger: console only

BASE_DIR = Path(__file__).resolve().parent.parent

# 1. DEBUG mode flag
DEBUG = os.environ.get("DEBUG", "False").lower() in ("true", "1", "yes")

# 2. ALLOWED_HOSTS fail-fast guard
if DEBUG:
    allowed_hosts_env = os.environ.get("ALLOWED_HOSTS", "localhost,127.0.0.1,0.0.0.0,backend")
    ALLOWED_HOSTS = [h.strip() for h in allowed_hosts_env.split(",") if h.strip()]
else:
    if not os.environ.get("ALLOWED_HOSTS") or not os.environ["ALLOWED_HOSTS"].strip():
        raise ImproperlyConfigured("ALLOWED_HOSTS environment variable is required in production.")
    ALLOWED_HOSTS = [h.strip() for h in os.environ["ALLOWED_HOSTS"].split(",") if h.strip()]

INSTALLED_APPS = [
    "django.contrib.staticfiles",
    "health.apps.HealthConfig",
]

MIDDLEWARE = [
    "events.middleware.CorrelationIdMiddleware",
    "django.middleware.security.SecurityMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "django.middleware.common.CommonMiddleware",
]

ROOT_URLCONF = "config.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [BASE_DIR.parent / "frontend" / "dist"],
        "APP_DIRS": False,
        "OPTIONS": {
            "context_processors": [],
        },
    },
]

WSGI_APPLICATION = "config.wsgi.application"
ASGI_APPLICATION = "config.asgi.application"

DATABASES = {}

CACHES = {
    "default": {
        "BACKEND": "django.core.cache.backends.locmem.LocMemCache",
        "LOCATION": "culture-event-cache",
        "TIMEOUT": 43200,  # 12 hours
        "OPTIONS": {
            "MAX_ENTRIES": 200,
        },
    }
}

LANGUAGE_CODE = "zh-hant"
TIME_ZONE = "Asia/Taipei"
USE_I18N = True
USE_TZ = True

STATIC_URL = "/static/"
STATIC_ROOT = BASE_DIR.parent / "staticfiles"
STATICFILES_DIRS = [
    BASE_DIR.parent / "frontend" / "dist",
]

# Custom WhiteNoise immutable test to match Vite content-hashed assets (e.g. index-DcJk2sLm.js)
VITE_HASHED_FILE_REGEX = re.compile(r"-[A-Za-z0-9_-]{8,}\.(js|css|png|jpg|jpeg|gif|svg|woff2?)$")

def is_immutable_file(path, url):
    return bool(VITE_HASHED_FILE_REGEX.search(url))

WHITENOISE_IMMUTABLE_FILE_TEST = is_immutable_file

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"
