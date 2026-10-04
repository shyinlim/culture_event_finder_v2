FROM python:3.13-slim

COPY --from=ghcr.io/astral-sh/uv:0.12.5 /uv /uvx /bin/

WORKDIR /app

# venv 放 /opt/venv，在 bind mount (/app) 之外，host 的 macOS venv 蓋不到它
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    UV_PROJECT_ENVIRONMENT=/opt/venv \
    PATH="/opt/venv/bin:$PATH"

# build context 是 repo root，所以這裡的路徑相對 repo root
COPY pyproject.toml uv.lock .python-version ./

RUN uv sync --frozen

EXPOSE 8789

# 直接跑 venv 裡的 python（PATH 已含 /opt/venv/bin），runtime 不經過 uv：
# 不會重新 resolve、不會把 uv.lock 改寫回 host repo，也不需要可寫的 uv cache 目錄
CMD ["python", "backend/manage.py", "runserver", "0.0.0.0:8789"]
