FROM python:3.13-slim

COPY --from=ghcr.io/astral-sh/uv:0.12.5 /uv /uvx /bin/

WORKDIR /app

# Place venv in /opt/venv outside bind mount /app so host venv does not overwrite it.
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    UV_PROJECT_ENVIRONMENT=/opt/venv \
    PATH="/opt/venv/bin:$PATH"

# Build context is repo root, paths are relative to repo root.
COPY pyproject.toml uv.lock .python-version ./

RUN uv sync --frozen

EXPOSE 8789

# Run python directly from /opt/venv without uv at runtime.
# Avoids re-resolving dependencies, updating uv.lock, or requiring a writable uv cache.
CMD ["python", "backend/manage.py", "runserver", "0.0.0.0:8789"]
