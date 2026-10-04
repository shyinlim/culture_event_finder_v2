# Stage 1: Build React SPA
FROM node:22-slim AS frontend-builder

WORKDIR /app/frontend

COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

COPY frontend/ ./
RUN npm run build

# Stage 2: Django + Gunicorn + WhiteNoise
FROM python:3.13-slim

COPY --from=ghcr.io/astral-sh/uv:0.12.5 /uv /uvx /bin/

WORKDIR /app

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    UV_PROJECT_ENVIRONMENT=/opt/venv \
    PATH="/opt/venv/bin:$PATH" \
    PORT=8080

COPY pyproject.toml uv.lock .python-version ./

RUN uv sync --frozen --no-dev

COPY --from=frontend-builder /app/frontend/dist /app/frontend/dist
COPY backend /app/backend

RUN SECRET_KEY=build-only-not-used ALLOWED_HOSTS=build-only \
    python backend/manage.py collectstatic --noinput

EXPOSE 8080

CMD exec gunicorn --chdir backend config.wsgi:application --bind 0.0.0.0:${PORT:-8080} --workers 1 --threads 8 --worker-class gthread --timeout 60
