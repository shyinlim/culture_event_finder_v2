# Culture Event Finder Refactor：Implementation Plan v7

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** `docs/superpowers/specs/2026-10-04-culture-event-finder-design-v7.md`

> ⚠️ **本文件自足。執行時不需開啟舊 plan 或舊 spec。**
> `2026-10-02-...-plan-v6.md`、`2026-08-23-...-plan-v5.md`、`2026-08-22-...-plan-v4.md`、`2026-07-19-...-plan-v3.md`、
> `2026-07-18-...-plan-v2.md`、`2026-07-11-culture-event-finder-refactor.md`
> 全部標記 SUPERSEDED。本 repo 為全新 repo（`culture_event_finder_v2`），不包含舊 repo 的 git 歷史與 legacy 程式碼。

**Goal:** 把 Taiwan culture-event 的 Django/Jinja2 網站重構成 React (Vite + TS + Tailwind) SPA + Django JSON API，以單一 container 部署到 Render free web service，具備可擴展之 provider 架構（保留 Provider ABC，先實作台灣）、cache-aside 與 zh/en UI i18n。

**Architecture:** 後端分層 views (HTTP) → services (cache + 區間過濾/排序) → providers (外部資料源封裝)。前端是 Vite 靜態 build，由同一個 Django container 透過 WhiteNoise 服務。無 react-router、無 DB 依賴、無 CORS。dev 環境走 docker-compose 兩個 service。

**Tech Stack:** Django 5.2 LTS、uv (依賴管理)、toolkitsy (logging)、requests、pytest + pytest-django + responses；Vite + React + TypeScript + Tailwind CSS + Vitest；Docker multi-stage；Render free web service + GitHub Actions (CI & Scheduled Monitoring)。

**任務順序的設計理由：** Phase 1 先把目錄結構、settings、dev 環境、**以及前端 scaffold** 立好，後面每個 task 都直接在最終路徑上寫 code。makefile 與 compose 各只寫一次、`make test` 與 `make dev` 從 Phase 1 結束到收工全程可用。

---

## Global Constraints

以下是專案層級的要求，**每個 task 的要求都隱含包含本節**：

- **全新 repo 原則**：本 repo 是獨立全新專案（`culture_event_finder_v2`），**沒有舊程式碼要刪除**，不引入 v1 的舊 static assets、模板或 Poetry 殘留。
- **Python 3.13、Django 5.2 LTS。**
- **依賴管理單一來源是 uv。** `pyproject.toml` (PEP 621) + `uv.lock` 是 source of truth。不得留下 `requirements.txt`、`[build-system]` 或 `[tool.poetry]`。
- **所有部署檔案放 `deployment/`，root 不放。** dev：`deployment/dev/docker-compose.yml`、`deployment/dev/backend.Dockerfile`、`deployment/dev/frontend.Dockerfile`。prod：`deployment/prod/Dockerfile`、`deployment/prod/Dockerfile.dockerignore`。root 只留 `Makefile`、`pyproject.toml`、`uv.lock`、`.python-version`。
- **build context 一律是 repo root。** prod 一律 `docker build -f deployment/prod/Dockerfile .`；compose 的 `build.context` 寫 `../..`（相對 compose 檔所在的 `deployment/dev/`）。Dockerfile 內的 `COPY` 路徑相對 repo root。
- **dev port：backend 8789、frontend 8790，container 內外同號。** 不用 8000、5173。Vite proxy 目標是 `http://backend:8789`。prod 本機預設維持 `PORT=8080`（平台會注入自己的值）。
- **compose 檔頂層寫 `name: culture_event_finder_v2`**，否則 project name 會是目錄名 `dev`。
- **compose 指令一律經過 Makefile**：`HOST_UID=$$(id -u) HOST_GID=$$(id -g) docker compose -f deployment/dev/docker-compose.yml ...`。compose 讀 `${HOST_UID:-1000}:${HOST_GID:-1000}`，**不可以用 `UID` / `GID`**（沒 export，且 macOS `/bin/sh` 設為唯讀）。
- **`uv` 版本釘死為 `0.12.5`**，勿用 `:latest`。出現在三處（`deployment/dev/backend.Dockerfile`、`deployment/prod/Dockerfile` 的 `ghcr.io/astral-sh/uv:0.12.5`，以及 CI 的 `astral-sh/setup-uv@v10` 的 `version`），三處必須一致。
- **dev container 用 `uv sync --frozen`（不加 `--no-dev`，保留 pytest 等 dev deps）；prod Dockerfile 才加 `--no-dev`。**
- **backend container 的 venv 必須放在 bind mount 之外**：`ENV UV_PROJECT_ENVIRONMENT=/opt/venv`。venv 若落在 `/app/.venv`，host 的 macOS arm64 版本會覆蓋 container 的 linux 版本。
- **build 期必須同時注入 `SECRET_KEY` 與 `ALLOWED_HOSTS`。** `collectstatic`、`make test`、CI 的 `test-backend` 三處都會觸發 settings 的 fail-fast 守衛，而兩個變數都是 fail-fast。使用行內注入 `RUN SECRET_KEY=build-only-not-used ALLOWED_HOSTS=build-only python ...`，**不可以用 `ENV SECRET_KEY=`**，**不可以用 `DEBUG=True` 繞過**。
- **prod gunicorn 參數**：`--workers 1 --threads 8 --worker-class gthread --timeout 60`。單 process 保證 LocMemCache 單一性；threads 避免 15 秒上游請求卡死 process。
- **Dockerfile 的 `CMD` 必須使用 shell 形式**（或 `sh -c "exec ..."`），**嚴禁使用 JSON 陣列直接傳遞 `${PORT}`**（例如 `CMD ["gunicorn", ..., "${PORT}"]`）：exec 模式下 Docker 不會經由 shell 展開環境變數，`${PORT}` 會維持字串導致 port 解析失敗、啟動直接崩潰。
- **Render 免費方案限制與配額對策**：
  1. 閒置 15 分鐘 spin down，喚醒約需 1 分鐘（期間 Render 顯示原生載入頁）。
  2. 每月 750 free instance hours（單一服務不超額）。
  3. **每月 500 分鐘 build 時間**：Docker 多階段 build 單次約 3~5 分鐘。若在 master 開發，非程式碼變更（如 docs/README）不觸發部署，或於密集開發期先關閉 Auto-Deploy 改為手動部署，防 build 額度耗盡。
  4. 每月 5 GB 出站流量限制。
- **Render 網址與 `ALLOWED_HOSTS` 建立順序**：Render 的 subdomain 若被全域佔用會加隨機後綴。**必須先在 Render dashboard 建立 Web Service 查看真實分配到的 URL，再將真實 hostname 填入 Environment 的 `ALLOWED_HOSTS`**。
- **WhiteNoise 用 plain storage**（不設 `STATICFILES_STORAGE`）：自訂 `WHITENOISE_IMMUTABLE_FILE_TEST` 支援 Vite 的 base64url content-hash 檔名（`name-xxxxxxxx.js`），避免每分鐘重抓 JS。
- **cache TTL：12 小時（`43200` 秒）。** Cache key 格式：`events:{country}:{category}`。
- **月份過濾用區間重疊判斷**：`start <= end_of_month and end >= start_of_month`，支援跨月展覽。
- **地名比對前做 `臺` / `台` 正規化。**
- **台灣 locations 是 20 個前綴、涵蓋 22 個縣市**（新竹市/縣共用「新竹」，嘉義市/縣共用「嘉義」）。測試斷言數字寫 20，名稱為 `test_location_prefixes_cover_22_counties`。
- **參數嚴格驗證**：category 與 location 一律用字串比對 provider 白名單（不轉 int，所以 `²` 這類字元進不來）；月份用 `fullmatch` 比對 `(19|20)\d{2}-(0[1-9]|1[0-2])`。
- **API 合約以 Task 7 的 Interfaces 為準**：錯誤一律 `{"error": {"code", "message"}}`；欄位用 camelCase；`/api/v1/countries` 一次帶回 locations 與 categories，沒有其他選項 endpoint。
- **後端測試一律跑 `make test-backend`**（它帶 `DEBUG=True`）。裸跑 `uv run pytest` 會被 fail-fast 守衛擋下：`SECRET_KEY environment variable is required in production.`
- **上游回應必須確認是 `list`**：`if not isinstance(payload, list): raise UpstreamError(...)`。
- **`pytest.ini` 必須有 `python_files = test_*.py tests.py` 與 `addopts = --nomigrations`。**
- **`make test` 拆成 `test-backend` 與 `test-frontend`。** `test` 同時呼叫兩者。
- **前端外連必須 URL encode**：Google Maps 與 Google 搜尋外連 URL 必須對地點與活動名稱使用 `encodeURIComponent`，避免特殊符號（`&`、`#`）破壞連結。
- **前端 `api.ts` 結構化錯誤分類**：分出 `TransientError`（連線/喚醒中，可重試）、`UpstreamError`（文化部故障，可重試）、`ClientError`（400/404 參數錯誤，不提供盲目重試）。
- **前端視覺 source of truth 是 `docs/poc/20260719_155200_ui_design_v27.html`**。禁用粉紅/magenta；保留「🔥 熱賣中」badge。
- **Owner 已拍板定案的三大決策**：
  1. **Provider ABC 抽象骨架**：明確保留，為未來擴充預留，維持輕量 interface。
  2. **前端 20 項可測性與 a11y 規範**：全數列為 MVP 必備標準，不予拆分延後。
  3. **v1 舊站獨立**：v1 是 v1、v2 是 v2，兩者獨立，不侵入修改 v1 加 banner；穩定一週後依下線清單銷毀。
- **監控正向白名單斷言**：GitHub Actions 每 30 分鐘打真實 URL，`curl --max-time 120`，嚴格判定「HTTP status 200 且 response 為有效 JSON 且 events 長度大於 0 才算成功」，其餘一律視為失敗。

---

## Phase 0：規劃 ✅

- [x] **spec v7 定稿**：`docs/superpowers/specs/2026-10-04-culture-event-finder-design-v7.md`（v6 經 Review-Crew 審查，v7 只改部署檔位置與 dev port）
- [x] **POC HTML gate 通過**：`docs/poc/20260719_155200_ui_design_v27.html`
- [x] **三大決策裁決確認**：Provider ABC 保留、前端 20 項全做、v1/v2 彼此獨立。
- [x] **plan v7 定稿**（本文件）

---

## Phase 1：骨架先立好

### Task 1: uv 初始化與依賴配置 ✅ 已完成（commit `c2fa6fd`）

> 已完成。以 repo 現況為準，下面的步驟只留作紀錄。

**Files:**
- Create: `pyproject.toml`
- Create: `uv.lock`
- Create: `.python-version`

**Interfaces:**
- Produces: `uv run` / `uv sync` 工作流；依賴: django 5.2.x, requests, urllib3, toolkitsy, gunicorn, whitenoise；dev deps: pytest, pytest-django, pytest-cov, responses。

- [ ] **Step 1: 建立 `pyproject.toml` (PEP 621)**

```toml
[project]
name = "culture-event-finder-v2"
version = "0.1.0"
description = "Culture event search: Django JSON API + React SPA"
authors = [{ name = "shyin" }]
readme = "README.md"
requires-python = ">=3.13"
dependencies = [
    "django>=5.2,<5.3",
    "requests>=2.32",
    "urllib3>=2.0",
    "toolkitsy>=0.1.0",
    "gunicorn>=23.0",
    "whitenoise>=6.7",
]

[dependency-groups]
dev = [
    "pytest>=8.3",
    "pytest-django>=4.10",
    "pytest-cov>=6.0",
    "responses>=0.25",
]
```

- [ ] **Step 2: 建立 `.python-version` 並執行 `uv lock && uv sync`**

```bash
echo "3.13" > .python-version
uv lock && uv sync
```

Expected: `uv.lock` 產生，`.venv/` 虛擬環境建立完成。

- [ ] **Step 3: 機械驗證無殘留 build-system 或 poetry**

```bash
grep -q "build-system\\|tool.poetry" pyproject.toml && echo "FAIL: build-system found" || echo "OK: clean uv application"
```

Expected: `OK: clean uv application`。

- [ ] **Step 4: 驗證 toolkitsy 與 Django 可正常載入**

```bash
uv run python -c "import django; from toolkitsy.logger import logger, configure; configure(); logger.info('toolkitsy and django %s ok', django.__version__)"
```

Expected: 印出含 `toolkitsy and django 5.2... ok` 的 log。

- [ ] **Step 5: Commit**

```bash
git add pyproject.toml uv.lock .python-version
git commit -m "chore(infra): initialize uv dependency management with django 5.2 and toolkitsy"
```

---

### Task 2: 建立 `backend/` 目錄與 Django 骨架 ★ checkpoint ✅ 已完成（commit `b2616b9`）

> 已完成。**`backend/config/settings.py` 以 repo 現況為準**：repo 對空字串的 `SECRET_KEY=` / `ALLOWED_HOSTS=` 也會 raise，比下面 Step 3 的 snippet（只檢查 `not in os.environ`）嚴格。下面的步驟只留作紀錄。

**Files:**
- Create: `backend/manage.py`
- Create: `backend/config/__init__.py`
- Create: `backend/config/settings.py`
- Create: `backend/config/urls.py`
- Create: `backend/config/wsgi.py`
- Create: `backend/config/asgi.py`
- Create: `backend/health/__init__.py`
- Create: `backend/health/apps.py`
- Create: `backend/health/views.py`
- Create: `backend/health/urls.py`
- Create: `backend/health/tests.py`
- Create: `backend/pytest.ini`
- Modify: `.gitignore`（確保包含 `staticfiles/`, `.venv/`）

**Interfaces:**
- Produces: `GET /health` → `{"status": "ok"}`
- Fail-fast 守衛生效（非 dev 且無 SECRET_KEY / ALLOWED_HOSTS 即拋 ImproperlyConfigured）

- [ ] **Step 1: 建立目錄結構**

```bash
mkdir -p backend/config backend/health
touch backend/config/__init__.py backend/health/__init__.py
```

- [ ] **Step 2: 建立 `backend/manage.py`**

```python
#!/usr/bin/env python
import os
import sys

def main():
    os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
    try:
        from django.core.management import execute_from_command_line
    except ImportError as exc:
        raise ImportError(
            "Couldn't import Django. Are you sure it's installed and "
            "available on your PYTHONPATH environment variable? Did you "
            "forget to activate a virtual environment?"
        ) from exc
    execute_from_command_line(sys.argv)

if __name__ == "__main__":
    main()
```
賦予執行權限：`chmod +x backend/manage.py`。

- [ ] **Step 3: 建立 `backend/config/settings.py`（含 fail-fast 與 WhiteNoise）**

```python
import os
import re
from pathlib import Path
from django.core.exceptions import ImproperlyConfigured

BASE_DIR = Path(__file__).resolve().parent.parent

# 1. DEBUG 判定
DEBUG = os.environ.get("DEBUG", "False").lower() in ("true", "1", "yes")

# 2. SECRET_KEY fail-fast
if DEBUG:
    SECRET_KEY = os.environ.get("SECRET_KEY", "dev-insecure-secret-key-change-in-prod")
else:
    if "SECRET_KEY" not in os.environ:
        raise ImproperlyConfigured("SECRET_KEY environment variable is required in production.")
    SECRET_KEY = os.environ["SECRET_KEY"]

# 3. ALLOWED_HOSTS fail-fast
if DEBUG:
    allowed_hosts_env = os.environ.get("ALLOWED_HOSTS", "localhost,127.0.0.1,backend")
    ALLOWED_HOSTS = [h.strip() for h in allowed_hosts_env.split(",") if h.strip()]
else:
    if "ALLOWED_HOSTS" not in os.environ:
        raise ImproperlyConfigured("ALLOWED_HOSTS environment variable is required in production.")
    ALLOWED_HOSTS = [h.strip() for h in os.environ["ALLOWED_HOSTS"].split(",") if h.strip()]

INSTALLED_APPS = [
    "django.contrib.staticfiles",
    "health.apps.HealthConfig",
]

MIDDLEWARE = [
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

# 自訂 WhiteNoise immutable 測試，匹配 Vite 的 base64url content-hash 產物 (例如 index-DcJk2sLm.js)
VITE_HASHED_FILE_REGEX = re.compile(r"-[A-Za-z0-9_-]{8,}\.(js|css|png|jpg|jpeg|gif|svg|woff2?)$")

def is_immutable_file(path, url):
    return bool(VITE_HASHED_FILE_REGEX.search(url))

WHITENOISE_IMMUTABLE_FILE_TEST = is_immutable_file

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"
```

- [ ] **Step 4: 建立 `backend/config/urls.py`**

```python
from django.urls import path, include

urlpatterns = [
    path("health", include("health.urls")),
    path("health/", include("health.urls")),
]
```

- [ ] **Step 5: 建立 `backend/config/wsgi.py` 與 `asgi.py`**

```python
# backend/config/wsgi.py
import os
from django.core.wsgi import get_wsgi_application
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
application = get_wsgi_application()

# backend/config/asgi.py
import os
from django.core.asgi import get_asgi_application
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
application = get_asgi_application()
```

- [ ] **Step 6: 建立 health app**

```python
# backend/health/apps.py
from django.apps import AppConfig

class HealthConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "health"

# backend/health/views.py
from django.http import JsonResponse

def health_check(request):
    return JsonResponse({"status": "ok"})

# backend/health/urls.py
from django.urls import path
from health.views import health_check

urlpatterns = [
    path("", health_check, name="health-check"),
]
```

- [ ] **Step 7: 建立 `backend/health/tests.py`**

```python
from django.test import TestCase, Client

class HealthCheckTests(TestCase):
    def setUp(self):
        self.client = Client()

    def test_health_check_returns_200_json(self):
        response = self.client.get("/health")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"status": "ok"})

    def test_health_check_with_trailing_slash(self):
        response = self.client.get("/health/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"status": "ok"})
```

- [ ] **Step 8: 建立 `backend/pytest.ini`**

```ini
[pytest]
DJANGO_SETTINGS_MODULE = config.settings
python_files = test_*.py tests.py
addopts = --nomigrations -v
pythonpath = .
```

- [ ] **Step 9: 更新 `.gitignore`**

確保 `.gitignore` 包含：
```gitignore
.venv/
__pycache__/
*.py[cod]
*$py.class
staticfiles/
frontend/dist/
frontend/node_modules/
.coverage
htmlcov/
```

- [ ] **Step 10: 執行測試並驗證 fail-fast 守衛 ★ checkpoint**

```bash
# 測試後端 health（DEBUG=True，否則 fail-fast 守衛會擋下 pytest）
cd backend && DEBUG=True uv run pytest .

# 驗證 fail-fast 守衛：比對完整訊息，才分得出是哪一個變數觸發的
DEBUG=False SECRET_KEY= ALLOWED_HOSTS=localhost uv run python manage.py check 2>&1 | grep -q "SECRET_KEY environment variable is required" && echo "OK: SECRET_KEY fail-fast verified"
DEBUG=False SECRET_KEY=test-key ALLOWED_HOSTS= uv run python manage.py check 2>&1 | grep -q "ALLOWED_HOSTS environment variable is required" && echo "OK: ALLOWED_HOSTS fail-fast verified"
cd ..
```

Expected: pytest 跑完 2 tests 全部通過，兩次 check 皆印出 `OK: ... fail-fast verified`。

- [ ] **Step 11: Commit**

```bash
git add backend/ .gitignore
git commit -m "feat(backend): scaffold backend with fail-fast settings and health check"
```

---

### Task 3: dev 環境配置（`deployment/dev/` + `Makefile`，先只有 backend）

**Files:**
- Delete: `backend/Dockerfile.dev`、`docker-compose.dev.yml`（plan v6 版本留下的未 commit 檔案；不存在就跳過）
- Create: `deployment/dev/backend.Dockerfile`
- Create: `deployment/dev/docker-compose.yml`
- Create: `Makefile`

**Interfaces:**
- Consumes: Task 1 的 `pyproject.toml`、`uv.lock`、`.python-version`；Task 2 的 `backend/manage.py` 與 `GET /health` → `{"status": "ok"}`
- Produces:
  - compose project 名 `culture_event_finder_v2`，service 名 `backend`（Task 4 的 Vite proxy 用 Docker DNS `backend:8789` 連它）
  - Makefile 變數 `COMPOSE`，target：`dev`、`dev-reset`、`test`、`test-backend`、`test-frontend`（佔位）、`build-prod`、`run-prod`、`prune`
  - backend dev server：`http://localhost:8789`

- [ ] **Step 1: 清掉 plan v6 留下的未 commit 檔案**

```bash
rm -f backend/Dockerfile.dev docker-compose.dev.yml
git status --short
```

Expected: `git status` 不再列出這兩個檔。

- [ ] **Step 2: 建立 `deployment/dev/backend.Dockerfile`**

```dockerfile
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
```

- [ ] **Step 3: 建立 `deployment/dev/docker-compose.yml`（先含 backend，Task 4 加 frontend）**

```yaml
# 沒寫 name 的話 project name 會是目錄名 "dev"，容易跟其他專案撞名
name: culture_event_finder_v2

services:
  backend:
    build:
      # 相對路徑從這個檔所在的 deployment/dev/ 算，../.. 就是 repo root
      context: ../..
      dockerfile: deployment/dev/backend.Dockerfile
    # 用 host 的使用者身分跑，Linux host 上才寫得了 bind mount；值由 Makefile 帶入
    user: "${HOST_UID:-1000}:${HOST_GID:-1000}"
    volumes:
      - ../..:/app
    environment:
      - DEBUG=True
      - ALLOWED_HOSTS=localhost,127.0.0.1,backend
    ports:
      - "8789:8789"
```

- [ ] **Step 4: 建立 `Makefile`**

```makefile
.PHONY: dev dev-reset test test-backend test-frontend build-prod run-prod prune

# 所有 compose 指令都走這個變數，因為 compose 檔不在 root。
# HOST_UID/HOST_GID 讓 backend container 用 host 的使用者身分寫 bind mount。
# 不可以叫 UID/GID：它們沒有 export 給子程序，而且 macOS 的 /bin/sh 把 UID 設成唯讀。
COMPOSE = HOST_UID=$$(id -u) HOST_GID=$$(id -g) docker compose -f deployment/dev/docker-compose.yml

dev:
	$(COMPOSE) up --build

# 裝了新套件後跑這個：named volume 只在第一次建立時複製 image 內容，之後不會自己更新
dev-reset:
	$(COMPOSE) down -v
	$(COMPOSE) up --build

test-backend:
	cd backend && DEBUG=True uv run pytest .

test-frontend:
	@echo "Frontend test target - will be wired in Task 4"

test: test-backend test-frontend

# deployment/prod/Dockerfile 在 Task 12 才建立，在那之前這兩個 target 會失敗，屬預期
build-prod:
	docker build -f deployment/prod/Dockerfile -t culture-event-finder-prod .
	docker image prune -f

run-prod: build-prod
	docker run --rm -p 8080:8080 -e SECRET_KEY=local-prod-test-key -e ALLOWED_HOSTS=localhost,127.0.0.1 culture-event-finder-prod

# 清除 dangling images 釋放磁碟空間
prune:
	docker image prune -f
```

Makefile 的 recipe 行開頭必須是 Tab，不能是空白。

- [ ] **Step 5: 確認 compose 路徑解析正確**

```bash
make -n dev
HOST_UID=$(id -u) HOST_GID=$(id -g) docker compose -f deployment/dev/docker-compose.yml config | grep -E "name:|context:|dockerfile:|source:|published:|user:"
```

Expected:
- `make -n dev` 印出 `HOST_UID=$(id -u) HOST_GID=$(id -g) docker compose -f deployment/dev/docker-compose.yml up --build`
- `name: culture_event_finder_v2`
- `context:` 與 bind mount 的 `source:` 都是 repo root 的絕對路徑，不是 `.../deployment/dev`
- `dockerfile: deployment/dev/backend.Dockerfile`、`published: "8789"`、`user:` 是你的 `id -u`:`id -g`

- [ ] **Step 6: 測試 `make test-backend`**

```bash
make test-backend
```

Expected: pytest 執行並全部 PASS。

- [ ] **Step 7: 起 dev container 並打 `/health`（local 驗收）**

終端機 A：

```bash
make dev
```

終端機 B（等 A 出現 `Starting development server at http://0.0.0.0:8789/`）：

```bash
curl -s http://localhost:8789/health; echo
docker ps --format '{{.Names}}' | grep culture_event_finder_v2
```

Expected:
- `{"status": "ok"}`
- container 名稱是 `culture_event_finder_v2-backend-1`

回到終端機 A 按 Ctrl+C 停掉。

- [ ] **Step 8: Commit**

```bash
git add deployment/dev/backend.Dockerfile deployment/dev/docker-compose.yml Makefile
git commit -m "feat(dev): add backend dev container under deployment/dev and Makefile"
```

---

### Task 4: 前端 scaffold (Vite + React + TS + Tailwind + Vitest) ★ checkpoint

**Files:**
- Create: `frontend/package.json`、`frontend/package-lock.json`（由 `npm install` 產生）、`frontend/tsconfig.json`、`frontend/vite.config.ts`、`frontend/index.html`
- Create: `frontend/src/App.tsx`、`frontend/src/main.tsx`、`frontend/src/index.css`
- Create: `frontend/src/smoke.test.ts`
- Create: `deployment/dev/frontend.Dockerfile`
- Modify: `deployment/dev/docker-compose.yml`（加入 frontend service 與 named volume）
- Modify: `Makefile`（接上 `test-frontend`，加 `install-host`）

**Interfaces:**
- Consumes: Task 3 的 compose service `backend`（Docker DNS `backend:8789`）與 Makefile 變數 `COMPOSE`
- Produces:
  - 前端 dev server：`http://localhost:8790`，`/api` 與 `/health` proxy 到 `http://backend:8789`
  - named volume `frontend_node_modules`（實際名稱 `culture_event_finder_v2_frontend_node_modules`）
  - `make test` 同時跑前後端單元測試；Vitest 的 DOM 環境是 `happy-dom`

- [ ] **Step 1: 建立 `frontend/` 的設定檔與原始碼**

建立 `frontend/package.json`：
```json
{
  "name": "culture-event-finder-frontend",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview",
    "test": "vitest run"
  },
  "dependencies": {
    "react": "^18.3.1",
    "react-dom": "^18.3.1"
  },
  "devDependencies": {
    "@tailwindcss/vite": "^4.0.0",
    "@types/react": "^18.3.12",
    "@types/react-dom": "^18.3.1",
    "@vitejs/plugin-react": "^4.3.4",
    "happy-dom": "^20.0.0",
    "tailwindcss": "^4.0.0",
    "typescript": "^5.6.3",
    "vite": "^6.0.0",
    "vitest": "^3.2.0"
  }
}
```

建立 `frontend/tsconfig.json`：
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "useDefineForClassFields": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": false,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true
  },
  "include": ["src"]
}
```

建立 `frontend/vite.config.ts`：
```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss()],
  base: mode === 'production' ? '/static/' : '/',
  server: {
    // 0.0.0.0：host 的瀏覽器才連得進 container 內的 Vite
    host: '0.0.0.0',
    port: 8790,
    // port 被佔用時直接報錯，不要默默換成 8791
    strictPort: true,
    // 不設 changeOrigin：保留 Host 為 localhost:8790，Django 去掉 port 後落在 ALLOWED_HOSTS 內。
    // 加了 changeOrigin: true 的話 Host 會變成 backend，靠 compose 的 ALLOWED_HOSTS 含 backend 才不會 400。
    proxy: {
      '/api': { target: 'http://backend:8789' },
      '/health': { target: 'http://backend:8789' },
    },
  },
  test: {
    environment: 'happy-dom',
    globals: true,
  },
}));
```

建立 `frontend/index.html`：
```html
<!DOCTYPE html>
<html lang="zh-Hant" data-theme="dark">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Culture Event Finder</title>
    <script>
      (function() {
        const theme = localStorage.getItem('theme') || (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
        document.documentElement.setAttribute('data-theme', theme);
      })();
    </script>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

建立 `frontend/public/favicon.svg`（POC 的 ticket icon）。`public/` 的檔案在 prod 會出現在 `/static/` 底下，Task 14 的 CI 用它驗證 base path：
```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#B57004" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9a2 2 0 0 1 0 4v2a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-2a2 2 0 0 1 0-4V7a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2z"/><path d="M12 5v14" stroke-dasharray="2 3"/></svg>
```

建立 `frontend/src/index.css`：
```css
@import "tailwindcss";

:root {
  color-scheme: dark light;
}
```

建立 `frontend/src/App.tsx`：
```tsx
export function App() {
  return (
    <div className="min-h-screen bg-slate-900 text-white flex items-center justify-center">
      <h1 className="text-3xl font-bold">Culture Event Finder v2</h1>
    </div>
  );
}
```

建立 `frontend/src/main.tsx`：
```tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
```

建立 `frontend/src/smoke.test.ts`：
```typescript
import { describe, it, expect } from 'vitest';

describe('Frontend Scaffold Smoke Test', () => {
  it('runs in a DOM environment', () => {
    // happy-dom 沒裝或沒設定時 document 不存在，這行會失敗
    expect(typeof document).toBe('object');
  });
});
```

- [ ] **Step 2: host 安裝依賴，產生 `package-lock.json` 並跑測試**

```bash
cd frontend && npm install && npm test && npm run build && cd ..
ls frontend/package-lock.json
```

Expected: `npm test` 1 個測試 PASS、`npm run build` 產出 `frontend/dist/`、`package-lock.json` 存在。
這一步產生的 `package-lock.json` 是下一步 Dockerfile `npm ci` 的前提，要一起 commit。

- [ ] **Step 3: 建立 `deployment/dev/frontend.Dockerfile`**

```dockerfile
FROM node:22-slim

WORKDIR /app/frontend

# node image 內建 uid 1000 的 node 使用者；先把目錄交給它再切過去，
# node_modules 才會屬於 node，Vite 寫 node_modules/.vite 快取時不會 permission denied
RUN chown node:node /app/frontend
USER node

# 先只 COPY 依賴清單：原始碼改了不會讓 npm ci 這層 cache 失效
COPY --chown=node:node frontend/package.json frontend/package-lock.json ./
RUN npm ci

# 原始碼不 COPY，執行時由 compose bind mount 進來
EXPOSE 8790

CMD ["npm", "run", "dev"]
```

- [ ] **Step 4: 更新 `deployment/dev/docker-compose.yml`（完整內容）**

```yaml
# 沒寫 name 的話 project name 會是目錄名 "dev"，容易跟其他專案撞名
name: culture_event_finder_v2

services:
  backend:
    build:
      # 相對路徑從這個檔所在的 deployment/dev/ 算，../.. 就是 repo root
      context: ../..
      dockerfile: deployment/dev/backend.Dockerfile
    # 用 host 的使用者身分跑，Linux host 上才寫得了 bind mount；值由 Makefile 帶入
    user: "${HOST_UID:-1000}:${HOST_GID:-1000}"
    volumes:
      - ../..:/app
    environment:
      - DEBUG=True
      - ALLOWED_HOSTS=localhost,127.0.0.1,backend
    ports:
      - "8789:8789"

  frontend:
    build:
      context: ../..
      dockerfile: deployment/dev/frontend.Dockerfile
    volumes:
      - ../../frontend:/app/frontend
      # named volume 蓋住 node_modules，host 的 macOS node_modules 不會蓋掉 container 的 linux 版
      - frontend_node_modules:/app/frontend/node_modules
    environment:
      # macOS/Windows 的 docker 檔案事件不可靠，不開 polling 的話 HMR 不會觸發
      - CHOKIDAR_USEPOLLING=true
      - CHOKIDAR_INTERVAL=1000
    ports:
      - "8790:8790"
    depends_on:
      - backend

volumes:
  frontend_node_modules:
```

- [ ] **Step 5: 更新 `Makefile`（完整內容）**

```makefile
.PHONY: dev dev-reset install-host test test-backend test-frontend build-prod run-prod prune

# 所有 compose 指令都走這個變數，因為 compose 檔不在 root。
# HOST_UID/HOST_GID 讓 backend container 用 host 的使用者身分寫 bind mount。
# 不可以叫 UID/GID：它們沒有 export 給子程序，而且 macOS 的 /bin/sh 把 UID 設成唯讀。
COMPOSE = HOST_UID=$$(id -u) HOST_GID=$$(id -g) docker compose -f deployment/dev/docker-compose.yml

dev:
	$(COMPOSE) up --build

# 裝了新套件後跑這個：named volume 只在第一次建立時複製 image 內容，之後不會自己更新
dev-reset:
	$(COMPOSE) down -v
	$(COMPOSE) up --build

# node_modules 要裝兩份：container 那份 (named volume) 負責執行，
# host 這份只給編輯器的 TS server / eslint / import 跳轉讀。兩份吃同一個 package-lock.json。
install-host:
	cd frontend && npm ci

test-backend:
	cd backend && DEBUG=True uv run pytest .

test-frontend:
	cd frontend && npm test

test: test-backend test-frontend

# deployment/prod/Dockerfile 在 Task 12 才建立，在那之前這兩個 target 會失敗，屬預期
build-prod:
	docker build -f deployment/prod/Dockerfile -t culture-event-finder-prod .
	docker image prune -f

run-prod: build-prod
	docker run --rm -p 8080:8080 -e SECRET_KEY=local-prod-test-key -e ALLOWED_HOSTS=localhost,127.0.0.1 culture-event-finder-prod

# 清除 dangling images 釋放磁碟空間
prune:
	docker image prune -f
```

- [ ] **Step 6: `make test` 全測 ★ checkpoint**

```bash
make test
```

Expected: 後端 pytest 與前端 vitest 都 PASS。

- [ ] **Step 7: 起兩個 container，瀏覽器看畫面 ★ checkpoint**

終端機 A：

```bash
make dev
```

終端機 B（等 A 出現 Vite 的 `Local: http://localhost:8790/`）：

```bash
curl -s http://localhost:8790/health; echo
docker volume ls --format '{{.Name}}' | grep culture_event_finder_v2
```

Expected:
- `{"status": "ok"}`：這個 request 打的是 Vite，經 proxy 轉到 backend，證明 proxy 與 `ALLOWED_HOSTS` 都對
- volume 名稱是 `culture_event_finder_v2_frontend_node_modules`

再用瀏覽器開 `http://localhost:8790`，看到「Culture Event Finder v2」。
改 `frontend/src/App.tsx` 的標題文字存檔，1 到 2 秒內瀏覽器自動更新（HMR 有效）。
改回原文字後，回到終端機 A 按 Ctrl+C 停掉。

- [ ] **Step 8: Commit**

```bash
git add frontend/ deployment/dev/frontend.Dockerfile deployment/dev/docker-compose.yml Makefile
git commit -m "feat(frontend): scaffold vite react ts tailwind vitest with dev container on 8790"
```

---

## Phase 2：後端

### Task 5: Provider layer (base.py + taiwan.py + `PROVIDERS` dict)

**Files:**
- Create: `backend/events/__init__.py`（空檔）
- Create: `backend/events/providers/__init__.py`（`PROVIDERS` dict）
- Create: `backend/events/providers/base.py`
- Create: `backend/events/providers/taiwan.py`
- Create: `backend/events/tests/__init__.py`（空檔）
- Create: `backend/events/tests/test_providers.py`

`events` 沒有 model、沒有 template，**不用 `apps.py`，也不用加進 `INSTALLED_APPS`**。pytest 照樣收得到 `events/tests/`。

**Interfaces:**
- Produces:
  - `Event`（frozen dataclass）：`id: str`、`title: str`、`start_time: str`（MoC 原格式 `YYYY/MM/DD HH:MM:SS`）、`end_time: str | None`、`location: str`（地址）、`location_name: str`（場館名）、`on_sales: bool`、`price: str`
  - `UpstreamError(Exception)`
  - `BaseProvider`：類別屬性 `code: str`、`name: dict[str, str]`、`locations: list[dict]`、`categories: list[dict]`；抽象方法 `fetch_events(category: str) -> list[Event]`
  - 選項格式：`{"value": "6", "zh": "展覽", "en": "Exhibition"}`（locations 的 value 是地名前綴，例如 `"臺北"`）
  - `PROVIDERS: dict[str, BaseProvider] = {"tw": TaiwanProvider()}`，從 `events.providers` import

- [ ] **Step 1: 建立 `backend/events/providers/base.py`**

```python
from abc import ABC, abstractmethod
from dataclasses import dataclass


class UpstreamError(Exception):
    """外部資料源失敗：連不上、timeout、回應不是預期格式。view 會轉成 502。"""


@dataclass(frozen=True)
class Event:
    id: str
    title: str
    start_time: str          # MoC 原格式 "2026/07/12 19:30:00"
    end_time: str | None
    location: str            # 地址，例如 "臺北市中正區中山南路21-1號"
    location_name: str       # 場館名，例如 "國家音樂廳"
    on_sales: bool
    price: str               # 自由文字，可能是 "500"、"0"、"洽詢主辦單位"


class BaseProvider(ABC):
    """一個國家（資料源）一個 provider。加國家時新增一個子類別，並登記到 PROVIDERS。"""

    code: str                      # "tw"
    name: dict[str, str]           # {"zh": "台灣", "en": "Taiwan"}
    locations: list[dict]          # [{"value": "臺北", "zh": "臺北", "en": "Taipei"}, ...]
    categories: list[dict]         # [{"value": "6", "zh": "展覽", "en": "Exhibition"}, ...]

    @abstractmethod
    def fetch_events(self, category: str) -> list[Event]:
        """抓某個類別的全部活動。失敗一律 raise UpstreamError。"""
```

- [ ] **Step 2: 寫 provider 的失敗測試 `backend/events/tests/test_providers.py`**

```python
import requests
import responses
from django.test import SimpleTestCase

from events.providers.base import UpstreamError
from events.providers.taiwan import MOC_API_URL, TaiwanProvider


def moc_item(uid="A1", shows=None):
    """造一筆 MoC 格式的活動，欄位名稱照真實 API。"""
    return {
        "UID": uid,
        "title": " 夏夜交響 ",
        "showInfo": shows if shows is not None else [{
            "time": "2026/07/12 19:30:00",
            "endTime": "2026/07/14 21:00:00",
            "location": "臺北市中正區中山南路21-1號",
            "locationName": "國家音樂廳",
            "onSales": "Y",
            "price": "800",
        }],
    }


class TaiwanProviderTests(SimpleTestCase):
    def setUp(self):
        self.provider = TaiwanProvider()

    def test_location_prefixes_cover_22_counties(self):
        # 新竹市/縣共用「新竹」、嘉義市/縣共用「嘉義」，所以 20 個前綴涵蓋 22 個縣市
        values = [loc["value"] for loc in self.provider.locations]
        self.assertEqual(len(values), 20)
        for must_have in ("宜蘭", "連江", "新竹", "嘉義"):
            self.assertIn(must_have, values)

    @responses.activate
    def test_one_event_per_show(self):
        second_show = {
            "time": "2026/08/01 14:00:00", "endTime": "", "location": "高雄市鹽埕區",
            "locationName": "駁二", "onSales": "N", "price": "",
        }
        first_show = moc_item()["showInfo"][0]
        responses.add(responses.GET, MOC_API_URL, json=[moc_item(shows=[first_show, second_show])])

        events = self.provider.fetch_events("1")

        # 一個活動兩場（不同城市），要變成兩個 Event，否則只看第一場會漏掉高雄
        self.assertEqual([e.id for e in events], ["A1-0", "A1-1"])
        self.assertEqual(events[0].title, "夏夜交響")
        self.assertEqual(events[0].location_name, "國家音樂廳")
        self.assertTrue(events[0].on_sales)
        self.assertFalse(events[1].on_sales)
        self.assertIsNone(events[1].end_time)

    @responses.activate
    def test_empty_list_is_not_an_error(self):
        responses.add(responses.GET, MOC_API_URL, json=[])
        self.assertEqual(self.provider.fetch_events("6"), [])

    @responses.activate
    def test_non_list_payload_raises(self):
        responses.add(responses.GET, MOC_API_URL, json={"data": []})
        with self.assertRaises(UpstreamError):
            self.provider.fetch_events("6")

    @responses.activate
    def test_non_json_raises(self):
        responses.add(responses.GET, MOC_API_URL, body="<html>maintenance</html>")
        with self.assertRaises(UpstreamError):
            self.provider.fetch_events("6")

    @responses.activate
    def test_http_500_raises(self):
        responses.add(responses.GET, MOC_API_URL, status=500)
        with self.assertRaises(UpstreamError):
            self.provider.fetch_events("6")

    @responses.activate
    def test_timeout_raises(self):
        responses.add(responses.GET, MOC_API_URL, body=requests.exceptions.ConnectTimeout())
        with self.assertRaises(UpstreamError):
            self.provider.fetch_events("6")

    @responses.activate
    def test_renamed_field_is_format_drift(self):
        # MoC 改欄位名時 HTTP 仍是 200，這是唯一會亮的訊號
        responses.add(responses.GET, MOC_API_URL, json=[{"UID": "A1", "name": "改名了"}])
        with self.assertRaises(UpstreamError):
            self.provider.fetch_events("6")

    @responses.activate
    def test_bad_time_format_is_format_drift(self):
        show = dict(moc_item()["showInfo"][0], time="2026-07-12")
        responses.add(responses.GET, MOC_API_URL, json=[moc_item(shows=[show])])
        with self.assertRaises(UpstreamError):
            self.provider.fetch_events("6")
```

- [ ] **Step 3: 跑測試確認失敗**

```bash
make test-backend
```

Expected: FAIL，`ModuleNotFoundError: No module named 'events.providers.taiwan'`。

- [ ] **Step 4: 建立 `backend/events/providers/taiwan.py`**

```python
from datetime import datetime

import requests
import urllib3
from toolkitsy.logger import logger

from events.providers.base import BaseProvider, Event, UpstreamError

# cloud.culture.tw 的憑證缺 Subject Key Identifier，Python 3.13 會拒連，只好 verify=False。
# 這是暫時解，而且 disable_warnings 是整個 process 生效：MoC 哪天修好憑證，不會有任何東西通知你。
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

MOC_API_URL = "https://cloud.culture.tw/frontsite/trans/SearchShowAction.do"
MOC_TIME_FORMAT = "%Y/%m/%d %H:%M:%S"

# 20 個前綴涵蓋 22 個縣市：新竹市/縣共用「新竹」、嘉義市/縣共用「嘉義」
LOCATIONS = [
    {"value": "臺北", "zh": "臺北", "en": "Taipei"},
    {"value": "新北", "zh": "新北", "en": "New Taipei"},
    {"value": "基隆", "zh": "基隆", "en": "Keelung"},
    {"value": "桃園", "zh": "桃園", "en": "Taoyuan"},
    {"value": "新竹", "zh": "新竹", "en": "Hsinchu"},
    {"value": "苗栗", "zh": "苗栗", "en": "Miaoli"},
    {"value": "臺中", "zh": "臺中", "en": "Taichung"},
    {"value": "彰化", "zh": "彰化", "en": "Changhua"},
    {"value": "南投", "zh": "南投", "en": "Nantou"},
    {"value": "雲林", "zh": "雲林", "en": "Yunlin"},
    {"value": "嘉義", "zh": "嘉義", "en": "Chiayi"},
    {"value": "臺南", "zh": "臺南", "en": "Tainan"},
    {"value": "高雄", "zh": "高雄", "en": "Kaohsiung"},
    {"value": "屏東", "zh": "屏東", "en": "Pingtung"},
    {"value": "宜蘭", "zh": "宜蘭", "en": "Yilan"},
    {"value": "花蓮", "zh": "花蓮", "en": "Hualien"},
    {"value": "臺東", "zh": "臺東", "en": "Taitung"},
    {"value": "澎湖", "zh": "澎湖", "en": "Penghu"},
    {"value": "金門", "zh": "金門", "en": "Kinmen"},
    {"value": "連江", "zh": "連江", "en": "Lienchiang"},
]

# 來源：v1 main_project/culture/data.py 的 12 個類別。
# 第一個是前端的預設類別，所以展覽放第一。17 實測是演唱會（不是市集）。
CATEGORIES = [
    {"value": "6", "zh": "展覽", "en": "Exhibition"},
    {"value": "1", "zh": "音樂", "en": "Music"},
    {"value": "2", "zh": "戲劇", "en": "Theater"},
    {"value": "3", "zh": "舞蹈", "en": "Dance"},
    {"value": "4", "zh": "親子", "en": "Family"},
    {"value": "5", "zh": "獨立音樂", "en": "Indie Music"},
    {"value": "7", "zh": "講座", "en": "Lecture"},
    {"value": "8", "zh": "電影", "en": "Movie"},
    {"value": "11", "zh": "綜藝", "en": "Variety Show"},
    {"value": "17", "zh": "演唱會", "en": "Concert"},
    {"value": "19", "zh": "研習課程", "en": "Workshop"},
    {"value": "200", "zh": "閱讀", "en": "Reading"},
]


def parse_events(payload: list) -> list[Event]:
    """把 MoC 的 JSON 轉成 Event。

    一個活動有幾場 showInfo 就產生幾個 Event，因為每一場的城市與時間可能不同。
    欄位缺漏或時間格式不對會直接拋 KeyError / ValueError 等，由呼叫端當成格式漂移處理。
    """
    events = []
    for item in payload:
        title = item["title"].strip()
        for index, show in enumerate(item["showInfo"]):
            end_time = show.get("endTime") or None
            # 先驗時間格式，壞掉的資料在這裡就擋下，services 的日期計算才能放心用
            datetime.strptime(show["time"], MOC_TIME_FORMAT)
            if end_time:
                datetime.strptime(end_time, MOC_TIME_FORMAT)
            events.append(Event(
                id=f"{item['UID']}-{index}",
                title=title,
                start_time=show["time"],
                end_time=end_time,
                location=show.get("location") or "",
                location_name=show.get("locationName") or "",
                on_sales=show.get("onSales") == "Y",
                price=show.get("price") or "",
            ))
    return events


class TaiwanProvider(BaseProvider):
    code = "tw"
    name = {"zh": "台灣", "en": "Taiwan"}
    locations = LOCATIONS
    categories = CATEGORIES

    def fetch_events(self, category: str) -> list[Event]:
        try:
            response = requests.get(
                MOC_API_URL,
                params={"method": "doFindTypeJ", "category": category},
                verify=False,
                timeout=15,
            )
            response.raise_for_status()
            payload = response.json()
        except (requests.RequestException, ValueError) as exc:
            # 連線失敗、timeout、HTTP 4xx/5xx、回應不是 JSON
            logger.error("MoC request failed category=%s: %r", category, exc)
            raise UpstreamError(f"MoC request failed: {exc}") from exc

        # response.json() 只保證是合法 JSON，不保證是 list（維護頁可能回 {"message": ...}）
        if not isinstance(payload, list):
            logger.error("MoC payload is %s, expected list category=%s", type(payload).__name__, category)
            raise UpstreamError("MoC payload is not a list")

        try:
            events = parse_events(payload)
        except (KeyError, TypeError, AttributeError, ValueError) as exc:
            # 格式漂移：先留 log 再拋，順序不可以顛倒，不然這個唯一的訊號一行紀錄都不會留下
            logger.error("MoC format drift category=%s: %r", category, exc)
            raise UpstreamError("MoC payload format changed") from exc

        if payload and not events:
            logger.error("MoC format drift category=%s: raw=%d parsed=0", category, len(payload))
            raise UpstreamError("MoC payload parsed to zero events")
        return events
```

- [ ] **Step 5: 建立 `backend/events/providers/__init__.py`**

```python
from events.providers.base import BaseProvider
from events.providers.taiwan import TaiwanProvider

# 國家代碼 → provider。加國家就在這裡加一行。不要再包 factory 或 get_provider()。
PROVIDERS: dict[str, BaseProvider] = {
    "tw": TaiwanProvider(),
}
```

- [ ] **Step 6: 跑測試確認通過**

```bash
make test-backend
```

Expected: health 2 個 + provider 9 個全部 PASS。

- [ ] **Step 7: Commit**

```bash
git add backend/events/
git commit -m "feat(backend): add provider layer with one Event per MoC show and format drift guard"
```

---

### Task 6: Services layer（白名單驗證 + cache-aside + 區間重疊過濾）

**Files:**
- Create: `backend/events/services.py`
- Create: `backend/events/tests/test_services.py`

**Interfaces:**
- Consumes: Task 5 的 `BaseProvider`、`Event`、`UpstreamError`、`PROVIDERS`、`MOC_API_URL`
- Produces:
  - `class BadRequest(Exception)`：參數不合法，view 轉成 400
  - `search_events(provider: BaseProvider, category: str, location: str, month: str) -> dict`，回傳 `{"events": list[Event], "meta": {"rawCount": int, "matchedCount": int, "cacheAge": int | None}}`；`cacheAge` 為 `None` 代表這次是 cache miss
  - `overlaps_month(event: Event, year: int, month: int) -> bool`
  - `normalize_place(text: str) -> str`

- [ ] **Step 1: 寫失敗測試 `backend/events/tests/test_services.py`**

```python
import responses
from django.core.cache import cache
from django.test import SimpleTestCase

from events.providers import PROVIDERS
from events.providers.base import Event, UpstreamError
from events.providers.taiwan import MOC_API_URL
from events.services import BadRequest, overlaps_month, search_events

TW = PROVIDERS["tw"]


def make_event(start, end):
    return Event(id="e1", title="t", start_time=start, end_time=end,
                 location="臺北市", location_name="", on_sales=False, price="")


class OverlapTests(SimpleTestCase):
    def test_year_long_exhibition_is_found_in_september(self):
        # 展覽 88% 跨月，只比對開始月份的話這類活動九月查不到
        event = make_event("2026/01/01 09:00:00", "2026/12/31 18:00:00")
        self.assertTrue(overlaps_month(event, 2026, 9))
        self.assertFalse(overlaps_month(event, 2025, 12))

    def test_missing_end_time_uses_start_time(self):
        event = make_event("2026/07/31 19:00:00", None)
        self.assertTrue(overlaps_month(event, 2026, 7))
        self.assertFalse(overlaps_month(event, 2026, 8))


class SearchEventsTests(SimpleTestCase):
    def setUp(self):
        cache.clear()

    def moc_show(self, location, time="2026/07/12 19:30:00"):
        return {"time": time, "endTime": "", "location": location,
                "locationName": "", "onSales": "N", "price": "0"}

    @responses.activate
    def test_end_to_end_from_moc_json_to_filtered_result(self):
        # 不 mock provider：從 MoC 原始字串一路走到 month=2026-07 的結果（spec §8）
        responses.add(responses.GET, MOC_API_URL, json=[
            {"UID": "a", "title": "台北場", "showInfo": [self.moc_show("台北市中正區")]},
            {"UID": "b", "title": "高雄場", "showInfo": [self.moc_show("高雄市鹽埕區")]},
            {"UID": "c", "title": "八月場", "showInfo": [self.moc_show("臺北市信義區", "2026/08/02 10:00:00")]},
        ])

        # 書籤裡的「台北」要能用，資料裡的「台北市」也要被「臺北」找到
        first = search_events(TW, "6", "台北", "2026-07")
        self.assertEqual([e.title for e in first["events"]], ["台北場"])
        self.assertEqual(first["meta"], {"rawCount": 3, "matchedCount": 1, "cacheAge": None})

        second = search_events(TW, "6", "臺北", "2026-07")
        self.assertEqual(len(responses.calls), 1)          # 第二次走 cache，不再打上游
        self.assertIsNotNone(second["meta"]["cacheAge"])

    @responses.activate
    def test_upstream_failure_is_cached_for_60_seconds(self):
        responses.add(responses.GET, MOC_API_URL, status=500)
        with self.assertRaises(UpstreamError):
            search_events(TW, "6", "臺北", "2026-07")
        with self.assertRaises(UpstreamError):
            search_events(TW, "6", "臺北", "2026-07")
        # 失敗期間不可以每個 request 都重打一次 15 秒的上游
        self.assertEqual(len(responses.calls), 1)

    def test_invalid_params_raise_bad_request(self):
        cases = [
            ("999999", "臺北", "2026-07"),   # 白名單外的類別
            ("²", "臺北", "2026-07"),        # isdigit() 會放行的上標數字
            ("", "臺北", "2026-07"),         # 缺參數
            ("6", "東京", "2026-07"),        # 白名單外的地區
            ("6", "臺北", "0000-01"),        # strptime 會炸的年份
            ("6", "臺北", "2026-13"),
        ]
        for category, location, month in cases:
            with self.subTest(category=category, location=location, month=month):
                with self.assertRaises(BadRequest):
                    search_events(TW, category, location, month)
```

- [ ] **Step 2: 跑測試確認失敗**

```bash
make test-backend
```

Expected: FAIL，`ModuleNotFoundError: No module named 'events.services'`。

- [ ] **Step 3: 建立 `backend/events/services.py`**

```python
import calendar
import re
import time
from datetime import date, datetime

from django.core.cache import cache
from toolkitsy.logger import logger

from events.providers.base import BaseProvider, Event, UpstreamError

MONTH_PATTERN = re.compile(r"(19|20)\d{2}-(0[1-9]|1[0-2])")
FAILURE_TTL_SECONDS = 60          # 上游失敗後 60 秒內直接回 502，不再重打
UPSTREAM_FAILED = "upstream_failed"


class BadRequest(Exception):
    """查詢參數不合法。view 轉成 400。"""


def normalize_place(text: str) -> str:
    """「台」統一成「臺」。白名單比對與地點過濾都要用這一個函式，不然 location=台北 會 400。"""
    return text.replace("台", "臺")


def _day(moc_time: str) -> date:
    # MoC 格式 "2026/07/12 19:30:00"，provider 已經驗過格式，這裡只取日期
    return datetime.strptime(moc_time.split(" ")[0], "%Y/%m/%d").date()


def overlaps_month(event: Event, year: int, month: int) -> bool:
    """活動區間 [開始, 結束] 和查詢月 [月初, 月底] 有交集就算命中。"""
    start = _day(event.start_time)
    end = _day(event.end_time) if event.end_time else start
    first_day = date(year, month, 1)
    last_day = date(year, month, calendar.monthrange(year, month)[1])
    return start <= last_day and end >= first_day


def _validate(provider: BaseProvider, category: str, location: str, month: str) -> str:
    """參數對照 provider 白名單；回傳正規化後的地名。

    用字串比對白名單、不轉 int，所以 "²" 這類 isdigit() 會放行的字元也進不來。
    """
    if category not in {c["value"] for c in provider.categories}:
        raise BadRequest(f"unsupported category: {category!r}")
    place = normalize_place(location)
    if place not in {loc["value"] for loc in provider.locations}:
        raise BadRequest(f"unsupported location: {location!r}")
    if not MONTH_PATTERN.fullmatch(month):
        raise BadRequest(f"month must be YYYY-MM: {month!r}")
    return place


def _cached_events(provider: BaseProvider, category: str) -> tuple[list[Event], int | None]:
    """cache-aside。回傳 (events, cacheAge 秒數；這次是 miss 就回 None)。"""
    key = f"events:{provider.code}:{category}"
    cached = cache.get(key)
    if cached == UPSTREAM_FAILED:
        logger.info("cache NEGATIVE key=%s", key)
        raise UpstreamError("upstream failed within the last 60 seconds")
    if cached is not None:
        events, stored_at = cached
        logger.info("cache HIT key=%s", key)
        return events, int(time.time() - stored_at)

    logger.info("cache MISS key=%s", key)
    try:
        events = provider.fetch_events(category)
    except UpstreamError:
        cache.set(key, UPSTREAM_FAILED, FAILURE_TTL_SECONDS)
        raise
    cache.set(key, (events, time.time()))   # TTL 用 settings CACHES 的 TIMEOUT（12 小時）
    return events, None


def search_events(provider: BaseProvider, category: str, location: str, month: str) -> dict:
    place = _validate(provider, category, location, month)
    events, cache_age = _cached_events(provider, category)
    year, mon = int(month[:4]), int(month[5:])

    matched = [
        e for e in events
        if place in normalize_place(e.location) and overlaps_month(e, year, mon)
    ]
    matched.sort(key=lambda e: e.start_time)   # "YYYY/MM/DD HH:MM:SS" 字串排序就是時間排序

    return {
        "events": matched,
        "meta": {"rawCount": len(events), "matchedCount": len(matched), "cacheAge": cache_age},
    }
```

- [ ] **Step 4: 跑測試確認通過**

```bash
make test-backend
```

Expected: 全部 PASS。

- [ ] **Step 5: Commit**

```bash
git add backend/events/services.py backend/events/tests/test_services.py
git commit -m "feat(backend): add services with whitelist validation, negative caching, and month overlap"
```

---

### Task 7: API endpoints + correlation id ★ checkpoint

**Files:**
- Create: `backend/events/views.py`
- Create: `backend/events/urls.py`
- Create: `backend/events/middleware.py`
- Modify: `backend/config/urls.py`
- Modify: `backend/config/settings.py`（`configure()` 與 middleware）
- Create: `backend/events/tests/test_views.py`

**Interfaces:**
- Consumes: Task 6 的 `search_events`、`BadRequest`；Task 5 的 `PROVIDERS`、`UpstreamError`
- Produces（前端 Task 8 照這份合約寫）：
  - `GET /api/v1/countries` → `[{"code": "tw", "name": {"zh", "en"}, "locations": [選項], "categories": [選項]}]`，選項是 `{"value", "zh", "en"}`
  - `GET /api/v1/{country}/events?category=&location=&month=YYYY-MM` → `{"events": [{"id", "title", "startTime", "endTime", "location", "locationName", "onSales", "price"}], "meta": {"rawCount", "matchedCount", "cacheAge"}}`
  - 錯誤一律 `{"error": {"code": "bad_request" | "not_found" | "upstream_error", "message": "..."}}`，狀態碼 400 / 404 / 502
  - 每個回應帶 `X-Request-ID` header

- [ ] **Step 1: 寫失敗測試 `backend/events/tests/test_views.py`**

```python
from unittest.mock import patch

from django.core.cache import cache
from django.test import SimpleTestCase

from events.providers.base import Event, UpstreamError


class EventApiTests(SimpleTestCase):
    def setUp(self):
        cache.clear()

    def test_countries_carries_dropdown_options(self):
        res = self.client.get("/api/v1/countries")
        self.assertEqual(res.status_code, 200)
        tw = res.json()[0]
        self.assertEqual(tw["code"], "tw")
        self.assertEqual(len(tw["locations"]), 20)
        self.assertEqual(tw["categories"][0], {"value": "6", "zh": "展覽", "en": "Exhibition"})

    def test_unknown_country_is_404_json(self):
        res = self.client.get("/api/v1/jp/events?category=6&location=臺北&month=2026-07")
        self.assertEqual(res.status_code, 404)
        self.assertEqual(res.json()["error"]["code"], "not_found")

    def test_bad_params_are_400_json_not_500_html(self):
        for query in ("category=6", "category=²&location=臺北&month=2026-07",
                      "category=6&location=臺北&month=0000-01"):
            with self.subTest(query=query):
                res = self.client.get(f"/api/v1/tw/events?{query}")
                self.assertEqual(res.status_code, 400)
                self.assertEqual(res.json()["error"]["code"], "bad_request")

    # patch 的是 view 模組裡的名字：views.py 用 from ... import search_events，名字已綁在 events.views
    @patch("events.views.search_events", side_effect=UpstreamError("MoC down"))
    def test_upstream_error_is_502(self, _):
        res = self.client.get("/api/v1/tw/events?category=6&location=臺北&month=2026-07")
        self.assertEqual(res.status_code, 502)
        self.assertEqual(res.json()["error"]["code"], "upstream_error")

    @patch("events.views.search_events")
    def test_success_uses_camel_case_contract(self, mock_search):
        mock_search.return_value = {
            "events": [Event("A1-0", "夏夜交響", "2026/07/12 19:30:00", None,
                             "臺北市中正區", "國家音樂廳", True, "800")],
            "meta": {"rawCount": 5, "matchedCount": 1, "cacheAge": None},
        }
        res = self.client.get("/api/v1/tw/events?category=6&location=臺北&month=2026-07")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["events"][0], {
            "id": "A1-0", "title": "夏夜交響", "startTime": "2026/07/12 19:30:00", "endTime": None,
            "location": "臺北市中正區", "locationName": "國家音樂廳", "onSales": True, "price": "800",
        })

    def test_every_response_has_request_id(self):
        res = self.client.get("/api/v1/countries", HTTP_X_REQUEST_ID="abc123")
        self.assertEqual(res["X-Request-ID"], "abc123")
        self.assertTrue(self.client.get("/health")["X-Request-ID"])
```

- [ ] **Step 2: 跑測試確認失敗**

```bash
make test-backend
```

Expected: FAIL，`/api/v1/countries` 回 404。

- [ ] **Step 3: 建立 `backend/events/views.py`**

```python
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
        {"code": p.code, "name": p.name, "locations": p.locations, "categories": p.categories}
        for p in PROVIDERS.values()
    ]
    return JsonResponse(data, safe=False)


@require_GET
def events(request, country):
    # 404 在 view 判斷；不要用 except KeyError 包住整個 service 呼叫，
    # 不然 service 內部任何 KeyError 都會變成假的「不支援這個國家」
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
    return JsonResponse({
        "events": [_event_to_json(e) for e in result["events"]],
        "meta": result["meta"],
    })
```

- [ ] **Step 4: 建立 `backend/events/middleware.py`**

toolkitsy 的 `set_correlation_id` 用 `contextvars` 存值（已於 2026-10-04 用 `inspect.getsource` 確認），
在 gunicorn `--threads 8` 下每個 thread 各自一份，不會錯掛。

```python
import uuid

from toolkitsy.logger import set_correlation_id


class CorrelationIdMiddleware:
    """每個 request 一個 id：寫進 log，也放進回應 header，朋友回報問題時可以拿去 Render Logs 搜（只保留 7 天）。"""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        request_id = request.headers.get("X-Request-ID") or uuid.uuid4().hex[:12]
        set_correlation_id(request_id)
        response = self.get_response(request)
        response["X-Request-ID"] = request_id
        return response
```

- [ ] **Step 5: 接上 routing 與 settings**

`backend/events/urls.py`：
```python
from django.urls import path

from events import views

urlpatterns = [
    path("countries", views.countries),
    path("<str:country>/events", views.events),
]
```

`backend/config/urls.py`：
```python
from django.urls import include, path

urlpatterns = [
    path("health", include("health.urls")),
    path("health/", include("health.urls")),
    path("api/v1/", include("events.urls")),
]
```

`backend/config/settings.py`：在檔案最上方的 import 區加
```python
from toolkitsy.logger import configure

configure()   # toolkitsy logger：console only
```
並把 `MIDDLEWARE` 的第一項設為 `"events.middleware.CorrelationIdMiddleware"`（放第一個，後面所有 middleware 的 log 都帶得到 id）。

- [ ] **Step 6: 跑全部後端測試**

```bash
make test-backend
```

Expected: 全部 PASS。

- [ ] **Step 7: 打真實 MoC ★ checkpoint**

```bash
cd backend
# port 8789 與 dev container 同號，先確認 make dev 沒在跑
DEBUG=True uv run python manage.py runserver 127.0.0.1:8789 &
SERVER_PID=$!
sleep 2
# 空陣列算沒過（spec §8.1），所以斷言 events 筆數 > 0，不是只找 "events" 字樣
curl -s "http://127.0.0.1:8789/api/v1/tw/events?category=6&location=%E8%87%BA%E5%8C%97&month=$(date +%Y-%m)" \
  | uv run python -c "import json,sys; d=json.load(sys.stdin); n=len(d['events']); print('events:', n, 'meta:', d['meta']); assert n > 0" \
  && echo "OK: live MoC query works"
kill $SERVER_PID
cd ..
```

Expected: 印出 `events: <大於 0>`、`meta` 的 `cacheAge` 是 `None`，以及 `OK: live MoC query works`。
events 為 0 時，先換類別或月份確認上游真的有資料，再判斷是不是過濾邏輯壞了。

- [ ] **Step 8: 量 12 個類別的筆數與大小，寫回 spec §10**

```bash
for c in 6 1 2 3 4 5 7 8 11 17 19 200; do
  curl -sk --max-time 30 "https://cloud.culture.tw/frontsite/trans/SearchShowAction.do?method=doFindTypeJ&category=$c" -o /tmp/moc_$c.json
  printf "category=%-4s bytes=%-9s " "$c" "$(wc -c < /tmp/moc_$c.json)"
  python3 -c "import json; d=json.load(open('/tmp/moc_$c.json')); print('events=', len(d), 'shows=', sum(len(e['showInfo']) for e in d))"
done
```

Expected: 12 行都印得出筆數。把結果貼進 spec v7 §10「單 category 的資料量未量測」那一條。
任何一類解析失敗，代表那一類的 payload 形狀不同，要先查清楚再進 Phase 3。
單一類別超過幾 MB 的話，在 `CACHES` 的 `OPTIONS` 把 `MAX_ENTRIES` 改成 20。

- [ ] **Step 9: Commit**

```bash
git add backend/events/ backend/config/urls.py backend/config/settings.py
git commit -m "feat(backend): add countries and events API with error contract and request id"
```

---

## Phase 3：前端

前端檔案結構（spec §2）：

```
frontend/src/
├── api.ts            # 所有 fetch 呼叫 + 錯誤分類
├── types.ts          # 與後端合約對應的型別
├── i18n.tsx          # 語系 context + 純函式
├── theme.ts          # 主題 hook
├── design.css        # 從 POC v27 抽出的毛玻璃 design system
├── locales/          # zh.json / en.json
├── utils/format.ts   # 有分支的純函式，全部配 Vitest
└── components/       # 每個元件一個檔
```

### Task 8: 型別、API client、格式工具（TDD）

**Files:**
- Create: `frontend/src/types.ts`
- Create: `frontend/src/utils/format.ts`、`frontend/src/utils/format.test.ts`
- Create: `frontend/src/api.ts`、`frontend/src/api.test.ts`

**Interfaces:**
- Consumes: Task 7 的 API 合約（`/api/v1/countries`、`/api/v1/{country}/events`、錯誤格式）
- Produces:
  - 型別 `EventItem`、`LabeledOption`、`Country`、`QueryMeta`、`SearchForm`
  - `fetchCountries(signal?) -> Promise<Country[]>`、`searchEvents(form: SearchForm, signal?) -> Promise<{ events: EventItem[]; meta: QueryMeta }>`
  - 錯誤類別 `TransientError`、`UpstreamError`、`ClientError`，以及 `errorKind(err) -> 'transient' | 'upstream' | 'client'`
  - `formatDateRange(start, end)`、`formatPrice(price, lang)`、`buildGoogleMapUrl(location, locationName)`、`buildGoogleSearchUrl(title)`、`currentYearMonth(now)`、`toMonthParam(year, month)`、`defaultForm(country, now)`、`findLabel(options, value)`

- [ ] **Step 1: 建立 `frontend/src/types.ts`**

```typescript
// 與後端 /api/v1 合約一一對應（spec §3.1）

export interface EventItem {
  id: string;
  title: string;
  startTime: string;          // "2026/07/12 19:30:00"
  endTime: string | null;
  location: string;           // 地址
  locationName: string;       // 場館名
  onSales: boolean;
  price: string;              // 自由文字："500"、"0"、"洽詢主辦單位"
}

export interface LabeledOption {
  value: string | number;     // 比對前一律 String()，後端改型別也不會讓 chip 靜默消失
  zh: string;
  en: string;
}

export interface Country {
  code: string;
  name: { zh: string; en: string };
  locations: LabeledOption[];
  categories: LabeledOption[];
}

export interface QueryMeta {
  rawCount: number;
  matchedCount: number;
  cacheAge: number | null;    // null 代表這次是 cache miss
}

export interface SearchForm {
  country: string;
  location: string;
  category: string;
  year: string;               // "2026"
  month: string;              // "07"
}
```

- [ ] **Step 2: 寫 `frontend/src/utils/format.test.ts`（先寫測試）**

```typescript
import { describe, expect, it } from 'vitest';
import {
  buildGoogleMapUrl, buildGoogleSearchUrl, currentYearMonth, defaultForm,
  findLabel, formatDateRange, formatPrice, toMonthParam,
} from './format';
import type { Country } from '../types';

const tw: Country = {
  code: 'tw',
  name: { zh: '台灣', en: 'Taiwan' },
  locations: [{ value: '臺北', zh: '臺北', en: 'Taipei' }, { value: '高雄', zh: '高雄', en: 'Kaohsiung' }],
  categories: [{ value: '6', zh: '展覽', en: 'Exhibition' }, { value: 1, zh: '音樂', en: 'Music' }],
};

describe('formatDateRange', () => {
  it('shows start only when there is no end time', () => {
    expect(formatDateRange('2026/07/12 19:30:00', null)).toBe('2026/07/12 19:30');
  });
  it('shows a time range on the same day', () => {
    expect(formatDateRange('2026/07/22 19:30:00', '2026/07/22 21:30:00')).toBe('07/22 19:30–21:30');
  });
  it('drops the year inside one month', () => {
    expect(formatDateRange('2026/07/12 19:30:00', '2026/07/14 21:00:00')).toBe('07/12 19:30 – 07/14');
  });
  it('shows full dates across months', () => {
    expect(formatDateRange('2026/01/01 09:00:00', '2026/12/31 18:00:00')).toBe('2026/01/01 – 2026/12/31');
  });
});

describe('formatPrice', () => {
  it('only treats "0" as free', () => {
    expect(formatPrice('0', 'zh')).toBe('免費');
    expect(formatPrice('0', 'en')).toBe('Free');
    expect(formatPrice('', 'zh')).toBe('—');
  });
  it('prefixes $ only for pure numbers', () => {
    expect(formatPrice('800', 'zh')).toBe('$800');
    expect(formatPrice('洽詢主辦單位', 'zh')).toBe('洽詢主辦單位');
    expect(formatPrice('全票100元', 'zh')).toBe('全票100元');
  });
});

describe('external links', () => {
  it('encodes & and # so the link does not break', () => {
    expect(buildGoogleMapUrl('臺北市#1 & 2號', '')).toBe(
      'https://www.google.com/maps/search/?api=1&query=%E8%87%BA%E5%8C%97%E5%B8%82%231%20%26%202%E8%99%9F');
    expect(buildGoogleSearchUrl('A&B')).toBe('https://www.google.com/search?q=A%26B');
  });
  it('falls back to the venue name when the address is empty', () => {
    expect(buildGoogleMapUrl('', '國家音樂廳')).toContain(encodeURIComponent('國家音樂廳'));
  });
});

describe('search form helpers', () => {
  it('uses local time, not UTC, for the default month', () => {
    // 台灣時間 7/1 00:30 用 toISOString() 會變成 6/30，這是每月 1 號凌晨才出現的 bug
    expect(currentYearMonth(new Date(2026, 6, 1, 0, 30))).toEqual({ year: '2026', month: '07' });
  });
  it('builds the API month param', () => {
    expect(toMonthParam('2026', '07')).toBe('2026-07');
  });
  it('resets location and category to the first options of the country', () => {
    expect(defaultForm(tw, new Date(2026, 8, 15))).toEqual({
      country: 'tw', location: '臺北', category: '6', year: '2026', month: '09',
    });
  });
  it('finds labels even when the value type differs', () => {
    expect(findLabel(tw.categories, '1')).toEqual({ value: 1, zh: '音樂', en: 'Music' });
    expect(findLabel(tw.categories, '999')).toBeUndefined();
  });
});
```

- [ ] **Step 3: 跑測試確認失敗**

```bash
cd frontend && npm test; cd ..
```

Expected: FAIL，`Failed to resolve import "./format"`。

- [ ] **Step 4: 建立 `frontend/src/utils/format.ts`**

```typescript
import type { Country, LabeledOption, SearchForm } from '../types';

// MoC 時間格式 "2026/07/12 19:30:00"：前 10 字是日期，接著 5 字是時:分
function splitTime(moc: string): { day: string; hm: string } {
  const [day, time = ''] = moc.split(' ');
  return { day, hm: time.slice(0, 5) };
}

export function formatDateRange(start: string, end: string | null): string {
  const s = splitTime(start);
  if (!end) return `${s.day} ${s.hm}`.trim();
  const e = splitTime(end);
  if (s.day === e.day) return `${s.day.slice(5)} ${s.hm}–${e.hm}`;                 // 07/22 19:30–21:30
  if (s.day.slice(0, 7) === e.day.slice(0, 7)) return `${s.day.slice(5)} ${s.hm} – ${e.day.slice(5)}`; // 07/12 19:30 – 07/14
  return `${s.day} – ${e.day}`;                                                     // 2026/01/01 – 2026/12/31
}

// 票價是自由文字：只有 "0" 算免費、只有純數字加 $，其餘原樣顯示
export function formatPrice(price: string, lang: 'zh' | 'en'): string {
  const text = price.trim();
  if (text === '') return '—';
  if (text === '0') return lang === 'en' ? 'Free' : '免費';
  if (/^\d+$/.test(text)) return `$${text}`;
  return text;
}

export function buildGoogleMapUrl(location: string, locationName: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(location || locationName)}`;
}

export function buildGoogleSearchUrl(title: string): string {
  return `https://www.google.com/search?q=${encodeURIComponent(title)}`;
}

// 一律用本地時區；toISOString() 是 UTC，台灣每月 1 號 00:00–08:00 會抓成上個月
export function currentYearMonth(now: Date): { year: string; month: string } {
  return { year: String(now.getFullYear()), month: String(now.getMonth() + 1).padStart(2, '0') };
}

export function toMonthParam(year: string, month: string): string {
  return `${year}-${month}`;
}

// 預設條件與「切國家」「重設」共用：地區與類別都回到該國的第一個選項
export function defaultForm(country: Country, now: Date): SearchForm {
  return {
    country: country.code,
    location: String(country.locations[0].value),
    category: String(country.categories[0].value),
    ...currentYearMonth(now),
  };
}

export function findLabel(options: LabeledOption[], value: string): LabeledOption | undefined {
  return options.find((o) => String(o.value) === String(value));
}
```

- [ ] **Step 5: 寫 `frontend/src/api.test.ts`（先寫測試）**

```typescript
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClientError, TransientError, UpstreamError, fetchCountries, searchEvents } from './api';

function mockFetch(body: string, status: number) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body, { status })));
}

const form = { country: 'tw', location: '臺北', category: '6', year: '2026', month: '07' };

describe('api error classification', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('returns parsed JSON on 200', async () => {
    mockFetch('[{"code":"tw"}]', 200);
    await expect(fetchCountries()).resolves.toEqual([{ code: 'tw' }]);
  });

  it('builds the events URL with encoded params', async () => {
    mockFetch('{"events":[],"meta":{}}', 200);
    await searchEvents(form);
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe(
      '/api/v1/tw/events?category=6&location=%E8%87%BA%E5%8C%97&month=2026-07');
  });

  it('treats an HTML page (Render waking up) as transient, never as a MoC failure', async () => {
    mockFetch('<html>waking up</html>', 200);
    await expect(fetchCountries()).rejects.toBeInstanceOf(TransientError);
    mockFetch('<html>bad gateway</html>', 502);
    await expect(fetchCountries()).rejects.toBeInstanceOf(TransientError);
  });

  it('treats 503 as transient', async () => {
    mockFetch('{"error":{"code":"x","message":"y"}}', 503);
    await expect(fetchCountries()).rejects.toBeInstanceOf(TransientError);
  });

  it('only a 502 with upstream_error JSON is an upstream error', async () => {
    mockFetch('{"error":{"code":"upstream_error","message":"MoC down"}}', 502);
    await expect(searchEvents(form)).rejects.toBeInstanceOf(UpstreamError);
  });

  it('400 and 404 are client errors', async () => {
    mockFetch('{"error":{"code":"bad_request","message":"bad"}}', 400);
    await expect(searchEvents(form)).rejects.toBeInstanceOf(ClientError);
    mockFetch('{"error":{"code":"not_found","message":"nope"}}', 404);
    await expect(searchEvents(form)).rejects.toBeInstanceOf(ClientError);
  });

  it('network failure is transient', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await expect(fetchCountries()).rejects.toBeInstanceOf(TransientError);
  });

  it('lets AbortError through untouched', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new DOMException('aborted', 'AbortError')));
    await expect(fetchCountries()).rejects.toHaveProperty('name', 'AbortError');
  });
});
```

- [ ] **Step 6: 跑測試確認失敗**

```bash
cd frontend && npm test; cd ..
```

Expected: `format.test.ts` PASS，`api.test.ts` FAIL（`Failed to resolve import "./api"`）。

- [ ] **Step 7: 建立 `frontend/src/api.ts`**

```typescript
import type { Country, EventItem, QueryMeta, SearchForm } from './types';
import { toMonthParam } from './utils/format';

// 三種錯誤決定畫面：可重試（連線/喚醒中）、文化部故障（可重試）、參數錯誤（不給重試鈕）
export class TransientError extends Error { name = 'TransientError'; }
export class UpstreamError extends Error { name = 'UpstreamError'; }
export class ClientError extends Error { name = 'ClientError'; }

export type ErrorKind = 'transient' | 'upstream' | 'client';

export function errorKind(err: unknown): ErrorKind {
  if (err instanceof UpstreamError) return 'upstream';
  if (err instanceof ClientError) return 'client';
  return 'transient';
}

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { signal });
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;   // 被新的搜尋取消，不是錯誤
    throw new TransientError('network error');
  }

  let body: any;
  try {
    body = await res.json();
  } catch {
    // 不是 JSON：Render 喚醒中的 HTML 頁、平台的錯誤頁。絕不可以顯示成「文化部故障」
    throw new TransientError(`non-JSON response (${res.status})`);
  }

  if (res.ok) return body as T;
  if (res.status === 502 && body?.error?.code === 'upstream_error') throw new UpstreamError(body.error.message);
  if (res.status === 400 || res.status === 404) throw new ClientError(body?.error?.message ?? String(res.status));
  throw new TransientError(`HTTP ${res.status}`);
}

export function fetchCountries(signal?: AbortSignal): Promise<Country[]> {
  return getJson<Country[]>('/api/v1/countries', signal);
}

export function searchEvents(
  form: SearchForm,
  signal?: AbortSignal,
): Promise<{ events: EventItem[]; meta: QueryMeta }> {
  const params = new URLSearchParams({
    category: form.category,
    location: form.location,
    month: toMonthParam(form.year, form.month),
  });
  return getJson(`/api/v1/${form.country}/events?${params}`, signal);
}
```

- [ ] **Step 8: 跑測試確認通過**

```bash
make test-frontend
```

Expected: 全部 PASS。

- [ ] **Step 9: Commit**

```bash
git add frontend/src/types.ts frontend/src/utils/ frontend/src/api.ts frontend/src/api.test.ts
git commit -m "feat(frontend): add api client with error classification and format utils"
```

---

### Task 9: i18n 與主題 ★ checkpoint

**Files:**
- Create: `frontend/src/locales/zh.json`、`frontend/src/locales/en.json`
- Create: `frontend/src/i18n.tsx`、`frontend/src/i18n.test.tsx`
- Create: `frontend/src/theme.ts`
- Create: `frontend/src/components/LanguageSwitch.tsx`

**Interfaces:**
- Produces:
  - 純函式 `translate(lang, key, params?)`、`pickLabel(item, lang)`、`initialLang()`
  - `I18nProvider`、`useI18n() -> { lang, setLang, t, label }`，`label(item)` 是綁好目前語言的 `pickLabel`
  - `useTheme() -> { theme, toggleTheme }`，`localStorage` key 是 `theme`（與 `index.html` 的 inline script 同一個 key）
  - `LanguageSwitch`（可見文字 `EN` / `中` 就是 accessible name，不另掛 `aria-label`）

- [ ] **Step 1: 建立語系檔**

`frontend/src/locales/zh.json`：
```json
{
  "app_title": "Culture Event Finder",
  "nav_search": "搜尋",
  "nav_about": "關於",
  "theme_toggle": "切換深淺色主題",
  "coming_soon": "尚未開放",
  "location": "地區",
  "category": "類別",
  "year": "年份",
  "month": "月份",
  "search": "搜尋",
  "reset": "重設",
  "quick_categories": "快捷類別",
  "idle_title": "選好條件，按搜尋",
  "idle_desc": "預設是本月、臺北的展覽。也可以直接點下面的類別。",
  "loading_short": "搜尋活動中…",
  "loading_slow": "第一次查詢比較慢，正在向文化部要資料",
  "empty_title": "找不到符合條件的活動",
  "empty_desc": "換個地區、類別或月份再試一次，或按「重設」回到預設條件。",
  "error_transient_title": "連線逾時或服務喚醒中",
  "error_transient_desc": "請稍候幾秒再試一次。",
  "error_upstream_title": "文化部資料來源暫時無法使用",
  "error_upstream_desc": "這不是你的網路問題，請稍後再試。",
  "error_client_title": "查詢條件無效",
  "error_client_desc": "請重新選擇地區、類別與月份。",
  "retry": "重新整理",
  "result_count": "{{place}} · {{category}} · {{ym}} 共 {{count}} 筆",
  "on_sales": "🔥 熱賣中",
  "google_search": "Google 搜尋",
  "about_title": "關於 Culture Event Finder",
  "about_desc": "整合台灣文化部公開資料的活動搜尋工具。以 country provider 架構設計，未來可擴充其他國家的公開資料源。",
  "about_author": "作者"
}
```

`frontend/src/locales/en.json`：
```json
{
  "app_title": "Culture Event Finder",
  "nav_search": "Search",
  "nav_about": "About",
  "theme_toggle": "Toggle light and dark theme",
  "coming_soon": "Coming soon",
  "location": "Region",
  "category": "Category",
  "year": "Year",
  "month": "Month",
  "search": "Search",
  "reset": "Reset",
  "quick_categories": "Quick categories",
  "idle_title": "Pick your filters and search",
  "idle_desc": "Defaults to exhibitions in Taipei this month. Or tap a category below.",
  "loading_short": "Searching events…",
  "loading_slow": "The first search is slower, fetching data from the Ministry of Culture",
  "empty_title": "No matching events",
  "empty_desc": "Try another region, category or month, or press Reset to go back to the defaults.",
  "error_transient_title": "Connection timed out or the service is waking up",
  "error_transient_desc": "Please wait a few seconds and try again.",
  "error_upstream_title": "The Ministry of Culture data source is unavailable",
  "error_upstream_desc": "This is not your network. Please try again later.",
  "error_client_title": "Invalid search",
  "error_client_desc": "Please choose region, category and month again.",
  "retry": "Reload",
  "result_count": "{{place}} · {{category}} · {{ym}}: {{count}} events",
  "on_sales": "🔥 On sale",
  "google_search": "Google search",
  "about_title": "About Culture Event Finder",
  "about_desc": "An event finder built on Taiwan Ministry of Culture open data. The country provider design leaves room for other countries' data sources.",
  "about_author": "Author"
}
```

- [ ] **Step 2: 寫 `frontend/src/i18n.test.tsx`（先寫測試，測的是真正的 i18n.tsx）**

```tsx
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import { I18nProvider, pickLabel, translate, useI18n } from './i18n';

// 讓 React 知道這是測試環境，act() 才會等 effect 跑完
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

describe('i18n', () => {
  it('falls back to the key itself when a key is missing', () => {
    expect(translate('en', 'no_such_key')).toBe('no_such_key');
  });

  it('fills {{params}}', () => {
    expect(translate('zh', 'result_count', { place: '臺北', category: '音樂', ym: '2026/07', count: 12 }))
      .toBe('臺北 · 音樂 · 2026/07 共 12 筆');
  });

  it('pickLabel returns English in en', () => {
    expect(pickLabel({ zh: '台灣', en: 'Taiwan' }, 'en')).toBe('Taiwan');
  });

  it('switching language updates <html lang> and remembers it', async () => {
    const ref: { current: ReturnType<typeof useI18n> | null } = { current: null };
    function Probe() {
      ref.current = useI18n();
      return null;
    }
    const root = createRoot(document.createElement('div'));
    await act(async () => root.render(<I18nProvider><Probe /></I18nProvider>));

    await act(async () => ref.current!.setLang('en'));
    expect(document.documentElement.lang).toBe('en');
    expect(localStorage.getItem('lang')).toBe('en');

    await act(async () => ref.current!.setLang('zh'));
    expect(document.documentElement.lang).toBe('zh-Hant');
    await act(async () => root.unmount());   // unmount 也要包 act，不然會印 not wrapped in act 警告
  });
});
```

- [ ] **Step 3: 跑測試確認失敗**

```bash
make test-frontend
```

Expected: FAIL，`Failed to resolve import "./i18n"`。

- [ ] **Step 4: 建立 `frontend/src/i18n.tsx`**

```tsx
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import en from './locales/en.json';
import zh from './locales/zh.json';

export type Lang = 'zh' | 'en';

const DICTS: Record<Lang, Record<string, string>> = { zh, en };

// 純函式放在元件外面，Vitest 可以直接測
export function translate(lang: Lang, key: string, params?: Record<string, string | number>): string {
  let text = DICTS[lang][key] ?? key;     // 缺 key 時回傳 key 本身，畫面上一眼看得出缺哪個
  for (const [name, value] of Object.entries(params ?? {})) {
    text = text.replaceAll(`{{${name}}}`, String(value));
  }
  return text;
}

export function pickLabel(item: { zh: string; en: string }, lang: Lang): string {
  return item[lang] || item.zh;
}

// 跟主題一樣要持久化：先看 localStorage，沒有才看瀏覽器語言
export function initialLang(): Lang {
  const saved = localStorage.getItem('lang');
  if (saved === 'zh' || saved === 'en') return saved;
  return navigator.language.toLowerCase().startsWith('zh') ? 'zh' : 'en';
}

interface I18nValue {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: (key: string, params?: Record<string, string | number>) => string;
  label: (item: { zh: string; en: string }) => string;
}

const I18nContext = createContext<I18nValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLang] = useState<Lang>(initialLang);

  useEffect(() => {
    document.documentElement.lang = lang === 'zh' ? 'zh-Hant' : 'en';
    localStorage.setItem('lang', lang);
  }, [lang]);

  const value: I18nValue = {
    lang,
    setLang,
    t: (key, params) => translate(lang, key, params),
    label: (item) => pickLabel(item, lang),
  };
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used inside <I18nProvider>');
  return ctx;
}
```

`tsconfig.json` 的 `lib` 是 ES2022，`String.prototype.replaceAll` 可以用。

- [ ] **Step 5: 建立 `frontend/src/theme.ts`**

```typescript
import { useEffect, useState } from 'react';

export type Theme = 'dark' | 'light';

// key 要跟 index.html 的 inline script 一樣，那段 script 在 React 載入前先設好 data-theme，避免閃一下
function initialTheme(): Theme {
  const saved = localStorage.getItem('theme');
  if (saved === 'dark' || saved === 'light') return saved;
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(initialTheme);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
  }, [theme]);

  return { theme, toggleTheme: () => setTheme((t) => (t === 'dark' ? 'light' : 'dark')) };
}
```

- [ ] **Step 6: 建立 `frontend/src/components/LanguageSwitch.tsx`**

```tsx
import { useI18n } from '../i18n';

// 看得到的字（EN / 中）本身就是 accessible name，不要另掛 aria-label（WCAG 2.5.3 Label in Name）
export function LanguageSwitch({ size }: { size: 'h-11 w-11' | 'h-9 w-9' }) {
  const { lang, setLang } = useI18n();
  return (
    <button
      type="button"
      onClick={() => setLang(lang === 'zh' ? 'en' : 'zh')}
      className={`btn-secondary ${size} rounded-full flex items-center justify-center text-sm font-semibold`}
    >
      {lang === 'zh' ? 'EN' : '中'}
    </button>
  );
}
```

- [ ] **Step 7: 跑測試確認通過 ★ checkpoint**

```bash
make test-frontend
```

Expected: 全部 PASS（format、api、i18n 三個檔）。

- [ ] **Step 8: Commit**

```bash
git add frontend/src/locales/ frontend/src/i18n.tsx frontend/src/i18n.test.tsx frontend/src/theme.ts frontend/src/components/LanguageSwitch.tsx
git commit -m "feat(frontend): add persisted i18n and theme with tests against the real provider"
```

---

### Task 10a: Design system、背景場景、Icon、四種狀態畫面 ★ checkpoint

**Files:**
- Create: `frontend/src/design.css`（從 POC 抽出 + 補強）
- Modify: `frontend/src/index.css`
- Create: `frontend/src/components/Scene.tsx`
- Create: `frontend/src/components/Icon.tsx`
- Create: `frontend/src/components/StatePanels.tsx`
- Modify: `frontend/src/App.tsx`（暫時的預覽頁，Task 11 會整個換掉）

**Interfaces:**
- Consumes: Task 9 的 `useI18n`
- Produces:
  - CSS class：`.glass`、`.search-capsule`、`.search-field`、`.search-label`、`.search-select`、`.btn-primary`、`.btn-secondary`、`.chip.active`、`.rail-btn.active`、`.card-hover`、`.card-img-svg`、`.icon`
  - `<Scene />`：背景（漸層牆、曲線 SVG、雙色燈光、光暈），毛玻璃 blur 的素材
  - `<Icon name size? />`，`name` 是 `'search' | 'info' | 'moon' | 'sun' | 'calendar' | 'pin' | 'ticket' | 'refresh' | 'music' | 'tent' | 'masks' | 'frame'`
  - `IdleState`、`LoadingSkeleton`、`EmptyState({ onReset })`、`ErrorMessage({ kind, onRetry? })`；四個容器各有 `data-testid="state-idle|state-loading|state-empty|state-error"`

- [ ] **Step 1: 從 POC 抽出 CSS 到 `frontend/src/design.css`**

POC 是唯一的視覺 source of truth，CSS 整段照抄，不手打：

```bash
python3 - <<'EOF'
import pathlib, re
html = pathlib.Path("docs/poc/20260719_155200_ui_design_v27.html").read_text()
css = re.search(r"<style>(.*?)</style>", html, re.S).group(1)
pathlib.Path("frontend/src/design.css").write_text(css.strip() + "\n")
EOF
grep -c "\.glass" frontend/src/design.css
```

Expected: 數字大於 0。

再把 spec §4.3 要求的補強接在檔尾：

```bash
cat >> frontend/src/design.css <<'EOF'

/* ---- 以下不是 POC 原文：spec §4.3 的 a11y 補強與 §10 的低配備降級 ---- */

/* 鍵盤 Tab 時看得到焦點 */
:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

/* appearance:none 拿掉了原生下拉箭頭，補一個 chevron，否則四個欄位看起來像純文字 */
.search-field.has-select::after {
  content: "";
  position: absolute;
  right: 1.25rem;
  bottom: 1.1rem;
  width: 7px;
  height: 7px;
  border-right: 2px solid var(--text-faint);
  border-bottom: 2px solid var(--text-faint);
  transform: rotate(45deg);
  pointer-events: none;
}

/* 低階手機掉幀或白屏時的降級：把下面整段取消註解即可（拿掉 blur、面板改成不透明）
.glass, [data-theme="light"] .glass, .card-hover { backdrop-filter: none; -webkit-backdrop-filter: none; }
:root, [data-theme="dark"] { --panel: rgba(15, 18, 28, 0.92); }
[data-theme="light"] { --panel: rgba(255, 255, 255, 0.92); }
*/
EOF
```

- [ ] **Step 2: 更新 `frontend/src/index.css`**

```css
@import "tailwindcss";
@import "./design.css";
```

- [ ] **Step 3: 建立 `frontend/src/components/Scene.tsx`（POC 第 246–276 行的背景）**

```tsx
// 毛玻璃要有東西可以模糊：漸層牆 + 曲線線稿 + 雙色燈光 + 兩顆跨面板光暈（POC v27）
export function Scene() {
  return (
    <div className="scene" aria-hidden="true">
      <div className="wall" />
      <svg className="absolute inset-0 w-full h-full opacity-[0.22] pointer-events-none" viewBox="0 0 1440 900" fill="none" preserveAspectRatio="xMidYMid slice">
        <path d="M-100 850 C300 680 600 800 1000 480 C1300 200 1500 380 1600 -80" stroke="url(#bg-grad-1)" strokeWidth="4.5" strokeLinecap="round" />
        <path d="M150 950 C450 580 750 850 1150 380" stroke="url(#bg-grad-2)" strokeWidth="2.5" strokeDasharray="10 10" />
        <circle cx="85%" cy="15%" r="280" stroke="url(#bg-grad-3)" strokeWidth="1.8" />
        <circle cx="85%" cy="15%" r="180" stroke="url(#bg-grad-3)" strokeWidth="1.2" />
        <circle cx="20%" cy="80%" r="350" stroke="url(#bg-grad-1)" strokeWidth="1.8" />
        <circle cx="20%" cy="80%" r="220" stroke="url(#bg-grad-1)" strokeWidth="1.2" strokeDasharray="6 6" />
        <path d="M500 -50 C700 200 600 400 900 600" stroke="url(#bg-grad-2)" strokeWidth="1.5" />
        <defs>
          <linearGradient id="bg-grad-1" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.8" />
            <stop offset="100%" stopColor="#B57004" stopOpacity="0.1" />
          </linearGradient>
          <linearGradient id="bg-grad-2" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#B57004" stopOpacity="0.6" />
            <stop offset="100%" stopColor="#3b82f6" stopOpacity="0.1" />
          </linearGradient>
          <linearGradient id="bg-grad-3" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#B57004" stopOpacity="0.4" />
            <stop offset="100%" stopColor="#06b6d4" stopOpacity="0.1" />
          </linearGradient>
        </defs>
      </svg>
      <div className="lamp-light" />
      <div className="blob blob-bronze" />
      <div className="blob blob-cyan" />
      <div className="floor-shadow" />
    </div>
  );
}
```

- [ ] **Step 4: 建立 `frontend/src/components/Icon.tsx`（POC 第 280–292 行，只抄會用到的 12 個）**

```tsx
import type { ReactNode } from 'react';

export type IconName =
  | 'search' | 'info' | 'moon' | 'sun' | 'calendar' | 'pin' | 'ticket' | 'refresh'
  | 'music' | 'tent' | 'masks' | 'frame';

const SHAPES: Record<IconName, ReactNode> = {
  search: <><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></>,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v5" /><path d="M12 8h.01" /></>,
  moon: <path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5z" />,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>,
  calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M8 3v4M16 3v4M3 10h18" /></>,
  pin: <><path d="M12 22s7-7.4 7-12.6A7 7 0 0 0 5 9.4C5 14.6 12 22 12 22z" /><circle cx="12" cy="9.5" r="2.3" /></>,
  ticket: <><path d="M3 9a2 2 0 0 1 0 4v2a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-2a2 2 0 0 1 0-4V7a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2z" /><path d="M12 5v14" strokeDasharray="2 3" /></>,
  refresh: <><path d="M21 12a9 9 0 1 1-3-6.7" /><path d="M21 3v6h-6" /></>,
  music: <><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></>,
  tent: <><path d="M19 20L12 4 5 20" /><path d="M12 15L9 20h6z" /></>,
  masks: <><path d="M4 10c0-4 4-8 8-8s8 4 8 8c0 5-4 10-8 10-4 0-8-5-8-10z" /><path d="M9 9h.01M15 9h.01M12 14c-1 0-2 .5-2 1h4c0-.5-1-1-2-1z" /></>,
  frame: <><rect x="3" y="3" width="18" height="18" rx="2" ry="2" /><path d="M3 9h18M9 21V9" /></>,
};

// 純裝飾：按鈕的文字或 aria-label 才是給螢幕閱讀器的名字
export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return (
    <svg className="icon" style={{ width: size, height: size }} viewBox="0 0 24 24" aria-hidden="true">
      {SHAPES[name]}
    </svg>
  );
}
```

- [ ] **Step 5: 建立 `frontend/src/components/StatePanels.tsx`**

```tsx
import { useEffect, useState } from 'react';
import type { ErrorKind } from '../api';
import { useI18n } from '../i18n';
import { Icon } from './Icon';

const PANEL = 'text-center py-24 px-4 bg-[var(--surface-2)] rounded-3xl border border-[var(--panel-border-dim)] border-dashed mt-4';

// idle 不可以是一片空白：使用者要看得出「還沒搜」和「查無結果」不一樣
export function IdleState() {
  const { t } = useI18n();
  return (
    <div data-testid="state-idle" className={PANEL}>
      <p className="text-[var(--text)] font-bold text-lg mb-2">{t('idle_title')}</p>
      <p className="text-[var(--text-muted)] text-sm max-w-sm mx-auto">{t('idle_desc')}</p>
    </div>
  );
}

// 超過 8 秒換文案：cache miss 加上游 timeout 最壞 15 秒，要讓使用者知道站沒死
export function LoadingSkeleton() {
  const { t } = useI18n();
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setSlow(true), 8000);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div data-testid="state-loading">
      <p role="status" className="text-sm text-[var(--text-muted)] mb-4">{t(slow ? 'loading_slow' : 'loading_short')}</p>
      <div aria-busy="true" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
        {[0, 1, 2].map((i) => (
          <div key={i} className="rounded-3xl bg-[var(--surface-2)] border border-[var(--panel-border-dim)] p-6 animate-pulse space-y-4">
            <div className="h-32 bg-[var(--skel)] rounded-2xl -m-6 mb-4" />
            <div className="h-5 bg-[var(--skel)] rounded w-3/4" />
            <div className="h-4 bg-[var(--skel)] rounded w-1/2" />
            <div className="h-4 bg-[var(--skel)] rounded w-2/3" />
            <div className="border-t border-[var(--panel-border-dim)] pt-4 mt-4">
              <div className="h-4 bg-[var(--skel)] rounded w-1/3" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// 文案叫使用者按「重設」，這顆鈕就必須真的存在
export function EmptyState({ onReset }: { onReset: () => void }) {
  const { t } = useI18n();
  return (
    <div data-testid="state-empty" role="status" className={PANEL}>
      <svg className="mx-auto mb-5" style={{ width: 80, height: 80 }} viewBox="0 0 100 100" fill="none" stroke="var(--text-faint)" strokeWidth="1.5" aria-hidden="true">
        <circle cx="44" cy="44" r="26" />
        <path d="M63 63 L84 84" strokeLinecap="round" />
        <path d="M44 10 V2 M44 86 v-8" strokeDasharray="2 4" />
        <path d="M8 44 H16 M72 44 h8" strokeDasharray="2 4" />
      </svg>
      <p className="text-[var(--text)] font-bold text-lg mb-2">{t('empty_title')}</p>
      <p className="text-[var(--text-muted)] text-sm max-w-sm mx-auto mb-6">{t('empty_desc')}</p>
      <button type="button" onClick={onReset} className="btn-secondary px-6 py-2.5 text-sm font-bold">
        {t('reset')}
      </button>
    </div>
  );
}

// client 錯誤（400/404）重試也不會好，所以呼叫端不傳 onRetry
export function ErrorMessage({ kind, onRetry }: { kind: ErrorKind; onRetry?: () => void }) {
  const { t } = useI18n();
  return (
    <div data-testid="state-error" role="alert" className={PANEL}>
      <svg className="mx-auto mb-5" style={{ width: 80, height: 80 }} viewBox="0 0 100 100" fill="none" stroke="var(--accent)" strokeWidth="1.5" aria-hidden="true">
        <path d="M50 12 L92 84 L8 84 Z" strokeLinejoin="round" />
        <path d="M50 38 V60" strokeLinecap="round" />
        <circle cx="50" cy="72" r="2" fill="var(--accent)" />
      </svg>
      <p className="text-[var(--text)] font-bold text-lg mb-2">{t(`error_${kind}_title`)}</p>
      <p className="text-[var(--text-muted)] text-sm mb-6">{t(`error_${kind}_desc`)}</p>
      {onRetry && (
        <button type="button" onClick={onRetry} className="btn-secondary px-6 py-2.5 text-sm font-bold inline-flex items-center gap-2">
          <Icon name="refresh" />{t('retry')}
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 6: 暫時把 `frontend/src/App.tsx` 換成預覽頁，開瀏覽器看四種狀態 ★ checkpoint**

```tsx
import { I18nProvider } from './i18n';
import { Scene } from './components/Scene';
import { EmptyState, ErrorMessage, IdleState, LoadingSkeleton } from './components/StatePanels';

// 預覽用，Task 11 會整個換掉
export function App() {
  return (
    <I18nProvider>
      <Scene />
      <main className="glass rounded-[40px] p-6 sm:p-10 max-w-5xl mx-auto my-6 text-[var(--text)] space-y-6">
        <IdleState />
        <LoadingSkeleton />
        <EmptyState onReset={() => {}} />
        <ErrorMessage kind="upstream" onRetry={() => {}} />
        <ErrorMessage kind="client" />
      </main>
    </I18nProvider>
  );
}
```

```bash
make test-frontend && (cd frontend && npm run build)
make dev
```

Expected: 測試與 build 都通過。瀏覽器開 `http://localhost:8790`：
1. 背景看得到曲線線稿與銅色、青色光暈，面板是透亮的毛玻璃。
2. 五個區塊都看得到；loading 那塊 8 秒後文字換成「第一次查詢比較慢…」。
3. 在 DevTools console 執行 `document.documentElement.dataset.theme='light'`，淺色主題也是透亮的毛玻璃，不是只換顏色。

看完 Ctrl+C 停掉 `make dev`。

- [ ] **Step 7: Commit**

```bash
git add frontend/src/design.css frontend/src/index.css frontend/src/components/ frontend/src/App.tsx
git commit -m "feat(frontend): add POC v27 design system, scene, icons, and four state panels"
```

---

### Task 10b: EventCard 與 EventList ★ checkpoint

**Files:**
- Create: `frontend/src/components/EventCard.tsx`
- Create: `frontend/src/components/EventList.tsx`
- Modify: `frontend/src/App.tsx`（預覽頁加上假資料卡片）

**Interfaces:**
- Consumes: Task 8 的 `EventItem`、`formatDateRange`、`formatPrice`、`buildGoogleMapUrl`、`buildGoogleSearchUrl`；Task 10a 的 `Icon`
- Produces: `<EventList events={EventItem[]} />`，結果 grid 有 `data-testid="results-grid"` 與 `role="status"`

- [ ] **Step 1: 建立 `frontend/src/components/EventCard.tsx`**

```tsx
import type { EventItem } from '../types';
import { useI18n } from '../i18n';
import { buildGoogleMapUrl, buildGoogleSearchUrl, formatDateRange, formatPrice } from '../utils/format';
import { Icon } from './Icon';

// 三組 banner 輪流用（POC v27 的三張卡）
const BANNERS = [
  {
    background: 'linear-gradient(135deg,#c2410c,#d97706)',
    shapes: <><circle cx="248" cy="20" r="38" /><circle cx="248" cy="20" r="24" strokeDasharray="3 5" /><path d="M30 92 L58 44 L86 92 Z" /><path d="M140 20 V44 M128 32 H152" strokeWidth="1.6" /></>,
  },
  {
    background: 'linear-gradient(135deg,#1e3a8a,#3b82f6)',
    shapes: <><rect x="220" y="18" width="52" height="52" transform="rotate(16 246 44)" /><path d="M20 30 A46 46 0 0 1 66 76" strokeDasharray="3 5" /><path d="M120 84 C150 40 200 96 244 60" strokeDasharray="1 7" strokeLinecap="round" /></>,
  },
  {
    background: 'linear-gradient(135deg,#0d9488,#115e59)',
    shapes: <><path d="M252 14 C255 34 262 41 282 44 C262 47 255 54 252 74 C249 54 242 47 222 44 C242 41 249 34 252 14 Z" /><circle cx="52" cy="76" r="30" /><circle cx="52" cy="76" r="18" strokeDasharray="3 5" /><path d="M140 26 L166 70 L114 70 Z" /></>,
  },
];

export function EventCard({ event, index }: { event: EventItem; index: number }) {
  const { lang, t } = useI18n();
  const banner = BANNERS[index % BANNERS.length];

  return (
    <article className="card-hover group rounded-3xl overflow-hidden bg-[var(--surface-2)] border border-[var(--panel-border-dim)] transition-all duration-300">
      <div className="h-32 relative flex items-end p-4 overflow-hidden" style={{ background: banner.background }}>
        <svg className="card-img-svg absolute inset-0 w-full h-full" viewBox="0 0 300 128" fill="none" stroke="rgba(255,255,255,.2)" strokeWidth="1.2" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
          {banner.shapes}
        </svg>
        {/* 只有 MoC 標示售票中（onSales = Y）才顯示，不是每張卡都熱賣 */}
        {event.onSales && (
          <span className="relative text-xs font-semibold bg-black/50 backdrop-blur-md text-white px-3 py-1.5 rounded-full shadow-sm">
            {t('on_sales')}
          </span>
        )}
      </div>
      <div className="p-6">
        <h3 className="font-bold text-lg leading-snug mb-3 text-[var(--text)] group-hover:text-[var(--link)] transition-colors">
          {event.title}
        </h3>
        <p className="text-sm text-[var(--text-muted)] mb-2 flex items-center gap-2">
          <Icon name="calendar" size={16} />{formatDateRange(event.startTime, event.endTime)}
        </p>
        <a
          href={buildGoogleMapUrl(event.location, event.locationName)}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm hover:underline flex items-start gap-2 mb-5"
          style={{ color: 'var(--link)' }}
        >
          <Icon name="pin" size={16} />
          <span className="leading-relaxed">{event.locationName ? `${event.locationName}・${event.location}` : event.location}</span>
        </a>
        <div className="flex items-center justify-between border-t border-[var(--panel-border-dim)] pt-4 mt-2 gap-3">
          <p className="text-sm font-bold text-[var(--text)]">{formatPrice(event.price, lang)}</p>
          <a
            href={buildGoogleSearchUrl(event.title)}
            target="_blank"
            rel="noopener noreferrer"
            className="shrink-0 text-xs font-bold px-3 py-1.5 rounded-full bg-[var(--surface-2)] text-[var(--text)] hover:bg-white/10 transition"
          >
            {t('google_search')}
          </a>
        </div>
      </div>
    </article>
  );
}
```

- [ ] **Step 2: 建立 `frontend/src/components/EventList.tsx`**

```tsx
import type { EventItem } from '../types';
import { EventCard } from './EventCard';

// role="status"：結果出來時螢幕閱讀器會播報，不然按了搜尋像沒反應
export function EventList({ events }: { events: EventItem[] }) {
  return (
    <div data-testid="results-grid" role="status" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
      {events.map((event, index) => <EventCard key={event.id} event={event} index={index} />)}
    </div>
  );
}
```

- [ ] **Step 3: 預覽頁加上三張假資料卡片，開瀏覽器看 ★ checkpoint**

在 Task 10a 的預覽 `App.tsx` 加 import 與一個 `<EventList>`（放在 `<IdleState />` 前面）：

```tsx
import { EventList } from './components/EventList';
import type { EventItem } from './types';

const SAMPLE: EventItem[] = [
  { id: 'a', title: '臺北當代藝術館：光影展', startTime: '2026/01/01 10:00:00', endTime: '2026/12/31 18:00:00', location: '臺北市大同區長安西路39號', locationName: '臺北當代藝術館', onSales: true, price: '300' },
  { id: 'b', title: '國家音樂廳：夏夜交響', startTime: '2026/07/22 19:30:00', endTime: '2026/07/22 21:30:00', location: '臺北市中正區中山南路21-1號', locationName: '國家音樂廳', onSales: false, price: '洽詢主辦單位' },
  { id: 'c', title: '松山文創園區：手作市集 & 工作坊 #3', startTime: '2026/07/25 10:00:00', endTime: null, location: '臺北市信義區光復南路133號', locationName: '', onSales: false, price: '0' },
];
// JSX 內：<EventList events={SAMPLE} />
```

```bash
make test-frontend && (cd frontend && npm run build)
make dev
```

Expected: 瀏覽器 `http://localhost:8790`：
1. 只有第一張卡有「🔥 熱賣中」。
2. 時間分別是 `2026/01/01 – 2026/12/31`、`07/22 19:30–21:30`、`2026/07/25 10:00`。
3. 票價分別是 `$300`、`洽詢主辦單位`、`免費`。
4. 點第三張的 Google 搜尋，新分頁的搜尋字是完整的「松山文創園區：手作市集 & 工作坊 #3」，沒有被 `&` 或 `#` 截斷。
5. 縮到手機寬度是單欄，桌機三欄；hover 卡片時 banner 的線條慢慢放大。

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/EventCard.tsx frontend/src/components/EventList.tsx frontend/src/App.tsx
git commit -m "feat(frontend): add EventCard with on-sale badge and date ranges, and EventList"
```

---

### Task 10c: 國家選擇器、搜尋膠囊、類別 chips ★ checkpoint

**Files:**
- Create: `frontend/src/components/CountryPicker.tsx`
- Create: `frontend/src/components/SearchForm.tsx`
- Create: `frontend/src/components/CategoryChips.tsx`
- Modify: `frontend/src/App.tsx`（預覽頁加上這三個元件）

**Interfaces:**
- Consumes: Task 8 的 `Country`、`SearchForm`、`LabeledOption`；Task 10a 的 `Icon`
- Produces:
  - `<CountryPicker countries active onPick(code) />`：日本、韓國是「尚未開放」chip（`aria-disabled`，不用 `disabled`）
  - `<SearchForm form country ready loading onChange(patch) onSearch onReset />`：搜尋鈕 `data-testid="search-button"`；`ready=false`（國家清單還沒載完）時送出鈕 disabled
  - `<CategoryChips options selected onPick(value) />`：容器 `data-testid="category-chips"`，chip 點了直接觸發搜尋

- [ ] **Step 1: 建立 `frontend/src/components/CountryPicker.tsx`**

```tsx
import type { Country } from '../types';
import { useI18n } from '../i18n';

// 還沒有 provider 的國家：純視覺降權，不寫「即將推出」字樣（spec §4）
const COMING_SOON = [
  { code: 'JP', name: { zh: '日本', en: 'Japan' } },
  { code: 'KR', name: { zh: '韓國', en: 'Korea' } },
];

export function CountryPicker({ countries, active, onPick }: {
  countries: Country[];
  active: string;
  onPick: (code: string) => void;
}) {
  const { label, t } = useI18n();
  return (
    <div className="flex items-center gap-2 self-start md:self-auto bg-[var(--surface-2)] p-1.5 rounded-full border border-[var(--panel-border-dim)] shadow-sm">
      {countries.map((c) => (
        <button
          key={c.code}
          type="button"
          aria-pressed={c.code === active}
          onClick={() => onPick(c.code)}
          className={`shrink-0 flex items-center gap-2 px-4 py-1.5 text-sm rounded-full ${c.code === active ? 'btn-primary shadow' : 'btn-secondary'}`}
        >
          <span className="h-5 w-5 rounded-full bg-white/20 flex items-center justify-center text-[10px] font-bold">{c.code.toUpperCase()}</span>
          {label(c.name)}
        </button>
      ))}
      {COMING_SOON.map((c) => (
        // aria-disabled 而不是 disabled：disabled 的按鈕鍵盤 focus 不到，螢幕閱讀器也聽不到「尚未開放」
        <button
          key={c.code}
          type="button"
          aria-disabled="true"
          title={t('coming_soon')}
          aria-label={`${label(c.name)}（${t('coming_soon')}）`}
          onClick={(e) => e.preventDefault()}
          className="shrink-0 flex items-center gap-2 px-3 py-1.5 rounded-full text-sm text-[var(--text-muted)] cursor-not-allowed opacity-60"
        >
          <span className="h-5 w-5 rounded-full bg-[var(--panel-border-dim)] flex items-center justify-center text-[10px] font-bold">{c.code}</span>
          {label(c.name)}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: 建立 `frontend/src/components/SearchForm.tsx`**

```tsx
import type { Country, LabeledOption, SearchForm as Form } from '../types';
import { useI18n } from '../i18n';
import { Icon } from './Icon';

const MONTHS = Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, '0'));

function Field({ id, title, value, options, onChange }: {
  id: string;
  title: string;
  value: string;
  options: { value: string; text: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <div className="search-field has-select">
      <label htmlFor={id} className="search-label">{title}</label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)} className="search-select pr-6">
        {options.map((o) => <option key={o.value} value={o.value} className="text-black">{o.text}</option>)}
      </select>
    </div>
  );
}

// <select> 年 + 月，不用 <input type="month">：桌面 Firefox / Safari 不支援，會退化成純文字框
export function SearchForm({ form, country, ready, loading, onChange, onSearch, onReset }: {
  form: Form;
  country: Country;
  ready: boolean;
  loading: boolean;
  onChange: (patch: Partial<Form>) => void;
  onSearch: () => void;
  onReset: () => void;
}) {
  const { t, label } = useI18n();
  const toOptions = (list: LabeledOption[]) => list.map((o) => ({ value: String(o.value), text: label(o) }));
  const thisYear = new Date().getFullYear();
  const years = [thisYear, thisYear + 1].map((y) => ({ value: String(y), text: String(y) }));

  return (
    <form
      onSubmit={(e) => { e.preventDefault(); onSearch(); }}
      className="search-capsule mb-4 flex-col sm:flex-row rounded-3xl sm:rounded-full"
    >
      <Field id="f-location" title={t('location')} value={form.location} options={toOptions(country.locations)} onChange={(v) => onChange({ location: v })} />
      <Field id="f-category" title={t('category')} value={form.category} options={toOptions(country.categories)} onChange={(v) => onChange({ category: v })} />
      <Field id="f-year" title={t('year')} value={form.year} options={years} onChange={(v) => onChange({ year: v })} />
      <Field id="f-month" title={t('month')} value={form.month} options={MONTHS.map((m) => ({ value: m, text: m }))} onChange={(v) => onChange({ month: v })} />
      <div className="p-3 sm:p-2 flex items-center justify-center gap-2">
        <button type="button" onClick={onReset} className="btn-secondary h-12 px-4 text-sm">{t('reset')}</button>
        {/* 國家清單載完前不能送出，不然會打出 /api/v1//events */}
        <button
          type="submit"
          data-testid="search-button"
          disabled={!ready || loading}
          aria-label={t('search')}
          className="btn-primary w-full sm:w-12 h-12 rounded-2xl sm:rounded-full flex items-center justify-center text-sm gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Icon name="search" />
          <span className="sm:hidden font-semibold">{t('search')}</span>
        </button>
      </div>
    </form>
  );
}
```

- [ ] **Step 3: 建立 `frontend/src/components/CategoryChips.tsx`**

```tsx
import type { LabeledOption } from '../types';
import { useI18n } from '../i18n';
import { Icon, type IconName } from './Icon';

// 四個快捷 chip，對齊 POC 的四個 icon。MoC 沒有「市集」類別，帳篷 icon 配演唱會（17）
const SHORTCUTS: { value: string; icon: IconName }[] = [
  { value: '6', icon: 'frame' },    // 展覽
  { value: '2', icon: 'masks' },    // 戲劇
  { value: '1', icon: 'music' },    // 音樂
  { value: '17', icon: 'tent' },    // 演唱會
];

export function CategoryChips({ options, selected, onPick }: {
  options: LabeledOption[];
  selected: string;
  onPick: (value: string) => void;
}) {
  const { t, label } = useI18n();
  return (
    <div data-testid="category-chips" role="group" aria-label={t('quick_categories')} className="flex flex-wrap gap-2.5 mb-8">
      {SHORTCUTS.map(({ value, icon }) => {
        // 兩邊都轉字串再比，後端把 value 改成數字也不會整排消失
        const option = options.find((o) => String(o.value) === value);
        if (!option) return null;
        const isActive = String(selected) === value;
        return (
          <button
            key={value}
            type="button"
            aria-pressed={isActive}
            onClick={() => onPick(value)}
            className={`chip flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-medium ${isActive ? 'btn-primary active' : 'btn-secondary'}`}
          >
            <Icon name={icon} size={14} />{label(option)}
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 4: 預覽頁接上真的 `/api/v1/countries`，開瀏覽器看 ★ checkpoint**

把預覽 `App.tsx` 換成下面這版（Task 11 會再整個換掉）：

```tsx
import { useEffect, useState } from 'react';
import { fetchCountries } from './api';
import { CategoryChips } from './components/CategoryChips';
import { CountryPicker } from './components/CountryPicker';
import { Scene } from './components/Scene';
import { SearchForm } from './components/SearchForm';
import { I18nProvider } from './i18n';
import type { Country, SearchForm as Form } from './types';
import { defaultForm } from './utils/format';

function Preview() {
  const [countries, setCountries] = useState<Country[]>([]);
  const [form, setForm] = useState<Form | null>(null);
  useEffect(() => {
    fetchCountries().then((list) => { setCountries(list); setForm(defaultForm(list[0], new Date())); });
  }, []);
  if (!form) return <p>loading countries…</p>;
  const country = countries[0];
  return (
    <main className="glass rounded-[40px] p-6 sm:p-10 max-w-5xl mx-auto my-6 text-[var(--text)]">
      <CountryPicker countries={countries} active={form.country} onPick={() => {}} />
      <pre className="text-xs my-4">{JSON.stringify(form)}</pre>
      <SearchForm form={form} country={country} ready loading={false}
        onChange={(p) => setForm({ ...form, ...p })} onSearch={() => console.log('search', form)} onReset={() => setForm(defaultForm(country, new Date()))} />
      <CategoryChips options={country.categories} selected={form.category} onPick={(v) => setForm({ ...form, category: v })} />
    </main>
  );
}

export function App() {
  return <I18nProvider><Scene /><Preview /></I18nProvider>;
}
```

```bash
make test-frontend && (cd frontend && npm run build)
make dev
```

Expected: 瀏覽器 `http://localhost:8790`：
1. 地區下拉有 20 個選項（含宜蘭、連江），類別 12 個，預設「臺北 / 展覽 / 今年 / 本月」。
2. 四個欄位右側都有 chevron 箭頭。
3. 四個 chip（展覽、戲劇、音樂、演唱會）各有 icon；點一個，它變成銅色 active，上方 JSON 的 `category` 跟著變。
4. 按 Tab 能逐一聚焦到每個欄位與按鈕，看得到銅色外框；日本、韓國也能被 focus 到，滑鼠移上去顯示「尚未開放」。
5. 按「重設」四個欄位回到預設值。

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/CountryPicker.tsx frontend/src/components/SearchForm.tsx frontend/src/components/CategoryChips.tsx frontend/src/App.tsx
git commit -m "feat(frontend): add country picker, search capsule with reset, and category chips"
```

---

### Task 11: App 組裝 + About 頁（全流程手動 E2E）★ checkpoint

**Files:**
- Create: `frontend/src/components/About.tsx`
- Modify: `frontend/src/App.tsx`（正式版，取代預覽頁）

**Interfaces:**
- Consumes: Task 8–10c 的全部元件、`fetchCountries`、`searchEvents`、`errorKind`、`useTheme`
- Produces: 完整 SPA。狀態機如下：

```
            載入 countries
                 │
      ┌──── 失敗 ┴ 成功 ────┐
      ▼                     ▼
 loadError            status = idle
 (重試 → 重載 countries)     │ 按搜尋 / 點 chip / 重設
                            ▼
                     status = loading ──(新搜尋先 abort 舊的)
                ┌───────────┼────────────┐
                ▼           ▼            ▼
             results      empty        error
                                  (重試 → 用同一組條件重搜)
```

- [ ] **Step 1: 建立 `frontend/src/components/About.tsx`（v1 tech stack 表的內容）**

```tsx
import { useI18n } from '../i18n';

const STACK = [
  ['Django 5.2 LTS', 'Backend'],
  ['uv', 'Python dependencies'],
  ['toolkitsy', 'Logging'],
  ['React + TypeScript', 'Frontend'],
  ['Vite', 'Frontend build tool'],
  ['Tailwind CSS', 'Styling'],
  ['pytest', 'Backend tests'],
  ['Vitest', 'Frontend tests'],
  ['Render', 'Hosting'],
];

export function About() {
  const { t } = useI18n();
  return (
    <section className="glass rounded-[40px] p-6 sm:p-10 shadow-2xl">
      <h2 className="text-2xl font-bold mb-5 text-[var(--text)]">{t('about_title')}</h2>
      <p className="text-base text-[var(--text-muted)] leading-relaxed mb-8 max-w-2xl">{t('about_desc')}</p>
      <h3 className="font-bold text-lg mb-4 text-[var(--text)]">Tech Stack</h3>
      <div className="rounded-3xl overflow-hidden mb-8 border border-[var(--panel-border-dim)] divide-y divide-[var(--panel-border-dim)] max-w-2xl">
        {STACK.map(([name, role], i) => (
          <div key={name} className={`flex p-4 text-sm ${i % 2 === 0 ? 'bg-[var(--surface-2)]' : ''}`}>
            <span className="w-48 font-bold text-[var(--text)]">{name}</span>
            <span className="text-[var(--text-muted)]">{role}</span>
          </div>
        ))}
      </div>
      <p className="text-sm font-semibold text-[var(--text-muted)] pt-4 border-t border-[var(--panel-border-dim)]">
        {t('about_author')}：
        <a href="https://github.com/shyinlim/culture_event_finder_v2" target="_blank" rel="noopener noreferrer" className="hover:underline" style={{ color: 'var(--link)' }}>
          GitHub
        </a>
      </p>
    </section>
  );
}
```

- [ ] **Step 2: 正式版 `frontend/src/App.tsx`**

```tsx
import { useCallback, useEffect, useRef, useState } from 'react';
import { errorKind, fetchCountries, searchEvents, type ErrorKind } from './api';
import { About } from './components/About';
import { CategoryChips } from './components/CategoryChips';
import { CountryPicker } from './components/CountryPicker';
import { EventList } from './components/EventList';
import { Icon } from './components/Icon';
import { LanguageSwitch } from './components/LanguageSwitch';
import { Scene } from './components/Scene';
import { SearchForm } from './components/SearchForm';
import { EmptyState, ErrorMessage, IdleState, LoadingSkeleton } from './components/StatePanels';
import { I18nProvider, useI18n } from './i18n';
import { useTheme } from './theme';
import type { Country, EventItem, SearchForm as Form } from './types';
import { defaultForm, findLabel } from './utils/format';

type View = 'search' | 'about';
type Status = 'idle' | 'loading' | 'results' | 'empty' | 'error';

function MainApp() {
  const { t, label } = useI18n();
  const { theme, toggleTheme } = useTheme();

  const [view, setView] = useState<View>('search');
  const [countries, setCountries] = useState<Country[]>([]);
  const [loadError, setLoadError] = useState<ErrorKind | null>(null);   // 錯誤來源 1：countries
  const [form, setForm] = useState<Form | null>(null);
  const [status, setStatus] = useState<Status>('idle');
  const [searchError, setSearchError] = useState<ErrorKind>('transient'); // 錯誤來源 2：搜尋
  const [events, setEvents] = useState<EventItem[]>([]);
  const [searched, setSearched] = useState<Form | null>(null);           // 結果對應的條件（計數列與重試用）
  const searchCtrl = useRef<AbortController | null>(null);

  const country = countries.find((c) => c.code === form?.country);

  // ---- 載入國家清單（下拉選單的資料來源）----
  const loadCountries = useCallback((signal?: AbortSignal) => {
    setLoadError(null);
    fetchCountries(signal)
      .then((list) => {
        setCountries(list);
        setForm(defaultForm(list[0], new Date()));
      })
      .catch((err) => {
        if (err.name !== 'AbortError') setLoadError(errorKind(err));
      });
  }, []);

  useEffect(() => {
    const ctrl = new AbortController();
    loadCountries(ctrl.signal);
    return () => ctrl.abort();
  }, [loadCountries]);

  // ---- 搜尋：每次開一個新的 AbortController，先取消上一個，避免慢的舊結果蓋掉新的 ----
  const runSearch = (query: Form) => {
    searchCtrl.current?.abort();
    const ctrl = new AbortController();
    searchCtrl.current = ctrl;
    setStatus('loading');
    searchEvents(query, ctrl.signal)
      .then((res) => {
        setEvents(res.events);
        setSearched(query);
        setStatus(res.events.length > 0 ? 'results' : 'empty');
      })
      .catch((err) => {
        if (err.name === 'AbortError') return;   // 被新的搜尋取消，不寫 state
        setSearched(query);
        setSearchError(errorKind(err));
        setStatus('error');
      });
  };

  const pickCategory = (value: string) => {
    if (!form) return;
    const next = { ...form, category: value };
    setForm(next);
    runSearch(next);   // 快捷 chip 一點就搜，只改 state 會讓人以為篩選壞了
  };

  const pickCountry = (code: string) => {
    const next = countries.find((c) => c.code === code);
    if (next) setForm(defaultForm(next, new Date()));   // 換國家時地區與類別重設
  };

  const reset = () => {
    if (!country) return;
    const next = defaultForm(country, new Date());
    setForm(next);
    runSearch(next);
  };

  // ---- 畫面切換進 history，手機返回鍵才不會直接離站 ----
  const navigate = (next: View) => {
    if (next === view) return;
    window.history.pushState({ view: next }, '');
    setView(next);
  };

  useEffect(() => {
    const onPop = (e: PopStateEvent) => setView(e.state?.view === 'about' ? 'about' : 'search');
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  // ---- 結果計數列：條件寫出來，使用者才知道看的是哪個類別，不會誤以為是全部 ----
  const summary = searched && country
    ? t('result_count', {
        place: label(findLabel(country.locations, searched.location) ?? { zh: searched.location, en: searched.location }),
        category: label(findLabel(country.categories, searched.category) ?? { zh: searched.category, en: searched.category }),
        ym: `${searched.year}/${searched.month}`,
        count: events.length,
      })
    : '';

  const navButton = (target: View, icon: 'search' | 'info', size: string) => (
    <button
      type="button"
      onClick={() => navigate(target)}
      aria-label={t(target === 'search' ? 'nav_search' : 'nav_about')}
      aria-current={view === target ? 'page' : undefined}
      className={`rail-btn ${view === target ? 'active' : ''} ${size} rounded-full flex items-center justify-center transition hover:bg-[var(--surface-2)]`}
    >
      <Icon name={icon} />
    </button>
  );

  const themeButton = (size: string) => (
    <button type="button" onClick={toggleTheme} aria-label={t('theme_toggle')}
      className={`${size} rounded-full flex items-center justify-center hover:bg-[var(--surface-2)]`}>
      <Icon name={theme === 'dark' ? 'moon' : 'sun'} />
    </button>
  );

  return (
    <div className="max-w-7xl mx-auto px-4 py-6 flex gap-4 text-[var(--text)]">
      {/* 桌機：左側毛玻璃 icon rail */}
      <aside className="glass hidden sm:flex flex-col items-center gap-3 rounded-full px-2.5 py-5 h-fit sticky top-6">
        {navButton('search', 'search', 'h-11 w-11')}
        {navButton('about', 'info', 'h-11 w-11')}
        <div className="w-6 h-px bg-[var(--panel-border-dim)] my-2" />
        {themeButton('h-11 w-11')}
        <LanguageSwitch size="h-11 w-11" />
      </aside>

      <div className="flex-1 min-w-0">
        {/* 手機：頂部毛玻璃 bar，必須含語言切換 */}
        <nav className="glass sm:hidden flex items-center justify-end gap-2 rounded-3xl px-4 py-3 mb-5">
          {navButton('search', 'search', 'h-9 w-9')}
          {navButton('about', 'info', 'h-9 w-9')}
          {themeButton('h-9 w-9')}
          <LanguageSwitch size="h-9 w-9" />
        </nav>

        {/* 唯一的 h1，放在 view 判斷之外：搜尋頁與 About 頁都有 */}
        <h1 className="font-bold text-xl sm:text-2xl flex items-center gap-3 tracking-tight mb-5">
          <span className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-[var(--surface-2)] border border-[var(--panel-border-dim)]">
            <Icon name="ticket" />
          </span>
          {t('app_title')}
        </h1>

        {view === 'about' ? <About /> : (
          <main className="glass rounded-[40px] p-6 sm:p-10 shadow-2xl">
            {loadError && <ErrorMessage kind={loadError} onRetry={() => loadCountries()} />}

            {!loadError && !form && <LoadingSkeleton />}

            {form && country && (
              <>
                <div className="flex justify-end mb-6">
                  <CountryPicker countries={countries} active={form.country} onPick={pickCountry} />
                </div>
                <SearchForm
                  form={form}
                  country={country}
                  ready
                  loading={status === 'loading'}
                  onChange={(patch) => setForm({ ...form, ...patch })}
                  onSearch={() => runSearch(form)}
                  onReset={reset}
                />
                <CategoryChips options={country.categories} selected={form.category} onPick={pickCategory} />

                {status === 'idle' && <IdleState />}
                {status === 'loading' && <LoadingSkeleton />}
                {status === 'empty' && <EmptyState onReset={reset} />}
                {status === 'error' && (
                  <ErrorMessage
                    kind={searchError}
                    onRetry={searchError === 'client' || !searched ? undefined : () => runSearch(searched)}
                  />
                )}
                {status === 'results' && (
                  <>
                    <p className="text-sm text-[var(--text-muted)] mb-4">{summary}</p>
                    <EventList events={events} />
                  </>
                )}
              </>
            )}
          </main>
        )}
      </div>
    </div>
  );
}

export function App() {
  return (
    <I18nProvider>
      <Scene />
      <MainApp />
    </I18nProvider>
  );
}
```

- [ ] **Step 3: 測試與 build**

```bash
make test && (cd frontend && npm run build)
```

Expected: 後端 pytest、前端 vitest 全部 PASS；`tsc && vite build` 沒有錯誤（`noUnusedLocals` 開著，沒用到的 import 會在這裡被抓到）。

- [ ] **Step 4: 全流程手動 E2E ★ checkpoint**

```bash
make dev
```

瀏覽器開 `http://localhost:8790`，每一項都要親眼看到：

1. 進站看到 idle 畫面（不是空白），預設條件是臺北 / 展覽 / 本月。
2. 按搜尋：先出現 skeleton，接著出現卡片，上方計數列寫「臺北 · 展覽 · 2026/10 共 N 筆」。
3. 連點兩個 chip（例如先「音樂」再馬上「展覽」）：最後畫面是展覽的結果，而且「展覽」chip 是亮的。
4. 選一個確定沒活動的月份（例如明年 12 月、類別「閱讀」）：出現空結果畫面；按裡面的「重設」回到預設條件並重新搜尋。
5. 錯誤畫面：另開終端機跑 `docker compose -f deployment/dev/docker-compose.yml stop backend`，再按搜尋，看到「連線逾時或服務喚醒中」加重試鈕。跑 `make dev` 重新起 backend 後按重試，結果回來。
6. 切 EN：所有文案變英文，`<html lang="en">`；重新整理頁面仍然是英文。
7. 切淺色主題，重新整理仍然是淺色，而且載入時不會先閃一下深色。
8. 點 About，再按瀏覽器返回鍵，回到搜尋頁，沒有離開網站。
9. 縮到手機寬度（375px）：左側 rail 消失，頂部 bar 有搜尋、關於、主題、語言四顆按鈕。
10. 只用鍵盤 Tab：每個可點的東西都看得到焦點外框。

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/About.tsx frontend/src/App.tsx
git commit -m "feat(frontend): assemble SPA with state machine, history, theme, and about page"
```

---

## Phase 4：prod image 與文件

### Task 12: 多階段 Dockerfile + SPA Catch-all Routing + 本機 Smoke Test ★ checkpoint

**Files:**
- Create: `deployment/prod/Dockerfile`
- Create: `deployment/prod/Dockerfile.dockerignore`
- Modify: `backend/config/urls.py`（加入 SPA catch-all 路由）

**Interfaces:**
- Consumes: Task 4 的 `frontend/package-lock.json` 與 `npm run build` 產出的 `frontend/dist/`；Task 3 的 `make build-prod`、`make run-prod`
- Produces:
  - prod image：`docker build -f deployment/prod/Dockerfile .`（context 是 repo root）
  - Single multi-stage Dockerfile (Node 22 slim -> Python 3.13 slim)
  - WhiteNoise 靜態託管 + Gunicorn 單一程序多執行緒
  - `CMD exec gunicorn ...`（shell 形式展開 `${PORT}`）

- [ ] **Step 1: 在 `backend/config/urls.py` 加 SPA catch-all**

一行 `TemplateView` 就夠，不用為了它開一個 app。

```python
from django.urls import include, path, re_path
from django.views.generic import TemplateView

urlpatterns = [
    path("health", include("health.urls")),
    path("health/", include("health.urls")),
    path("api/v1/", include("events.urls")),
    # SPA catch-all：非 api/、static/、health 的路徑都回 index.html，打錯網址才不會看到 Django 的裸 404 純文字頁。
    # index.html 來自 settings TEMPLATES 的 DIRS（frontend/dist），所以只在 build 過前端之後才有效
    re_path(r"^(?!api/|static/|health).*$", TemplateView.as_view(template_name="index.html")),
]
```

- [ ] **Step 2: 建立 `deployment/prod/Dockerfile.dockerignore`**

這個檔名是 Docker 的慣例：`<Dockerfile 檔名>.dockerignore` 放在 Dockerfile 旁邊，
build 時優先於 repo root 的 `.dockerignore`。沒有它的話，`.venv` 與 `node_modules`
每次都會被整包送進 build context。

```
.git
.github
.idea
.venv
docs
deployment/dev
frontend/node_modules
frontend/dist
staticfiles
**/__pycache__
**/.pytest_cache
.DS_Store
```

- [ ] **Step 3: 建立 `deployment/prod/Dockerfile`**

```dockerfile
# build context 是 repo root：docker build -f deployment/prod/Dockerfile .
# 所以下面所有 COPY 的來源路徑都相對 repo root

# Stage 1: Build Frontend
FROM node:22-slim AS frontend-builder

WORKDIR /app/frontend

COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

COPY frontend/ ./
RUN npm run build

# Stage 2: Production Python Container
FROM python:3.13-slim

COPY --from=ghcr.io/astral-sh/uv:0.12.5 /uv /uvx /bin/

WORKDIR /app

# venv 在 /app/.venv，放進 PATH 後 runtime 直接跑 python / gunicorn，不經過 uv
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PATH="/app/.venv/bin:$PATH"

# 建立 non-root user
RUN groupadd -r appuser && useradd -r -g appuser appuser

COPY pyproject.toml uv.lock .python-version ./

# 安裝正式依賴 (--no-dev)
RUN uv sync --frozen --no-dev

# 複製後端程式碼與前端 build 產物
COPY backend/ ./backend/
COPY --from=frontend-builder /app/frontend/dist ./frontend/dist/

# 執行 collectstatic (行內注入 build-only 假值通過 fail-fast 守衛，不可以改成 ENV)
RUN SECRET_KEY=build-only-not-used ALLOWED_HOSTS=build-only \
    python backend/manage.py collectstatic --noinput

# runtime 只讀檔，不需要 chown（chown -R 會把整個 venv 再複製成一層，image 平白變大）
USER appuser

EXPOSE 8080

# 注意：必須使用 shell 形式 exec，確保 ${PORT} 在 Render/Cloud Run runtime 能被正確展開！
# 平台會注入 PORT（Render 10000、Cloud Run 8080）；本機沒注入時用 8080
CMD exec gunicorn --chdir backend config.wsgi:application --bind 0.0.0.0:${PORT:-8080} --workers 1 --threads 8 --worker-class gthread --timeout 60
```

- [ ] **Step 4: 確認 Dockerfile 沒有 `ARG`**

```bash
grep -n "^ARG" deployment/prod/Dockerfile || echo "OK: no ARG"
```

Expected: 印出 `OK: no ARG`。Render 會把 dashboard 的環境變數轉成 build arg，有 `ARG SECRET_KEY` 的話真 key 會進 image layer。

- [ ] **Step 5: 本機 smoke test 驗證 container 完整運作 ★ checkpoint**

```bash
docker build -f deployment/prod/Dockerfile -t culture-event-finder-prod .

# 啟動 container
docker run -d --name smoke-test -p 8080:8080 \
  -e SECRET_KEY=smoke-test-secret-key-must-be-long-enough \
  -e ALLOWED_HOSTS=localhost,127.0.0.1 \
  culture-event-finder-prod

sleep 3

# 驗收各路徑
curl -s http://127.0.0.1:8080/health | grep -q '"status": "ok"' && echo "OK: /health 200"
curl -s http://127.0.0.1:8080/ | grep -q "Culture Event Finder" && echo "OK: / SPA index 200"
curl -s http://127.0.0.1:8080/api/v1/countries | grep -q '"tw"' && echo "OK: /api/v1/countries 200"
curl -sf http://127.0.0.1:8080/static/favicon.svg > /dev/null && echo "OK: public/ asset under /static/"
curl -s http://127.0.0.1:8080/no/such/page | grep -q "Culture Event Finder" && echo "OK: SPA catch-all"

docker stop smoke-test && docker rm smoke-test
```

Expected: 5 個 curl 全數印出 `OK: ...`。任何一個沒印，先跑 `docker logs smoke-test` 再停 container。

- [ ] **Step 6: 用 Makefile 再跑一次，確認 target 接得上**

```bash
make run-prod
```

另一個終端機：`curl -s http://127.0.0.1:8080/health; echo`，Expected `{"status": "ok"}`。回原終端機 Ctrl+C。

- [ ] **Step 7: Commit**

```bash
git add deployment/prod/Dockerfile deployment/prod/Dockerfile.dockerignore backend/config/urls.py
git commit -m "feat(deploy): add multi-stage prod Dockerfile under deployment/prod and SPA catch-all routing"
```

---

### Task 13: README 文件定稿

**Files:**
- Modify: `README.md`

**Interfaces:**
- 環境變數對照表（§11）、Render 平台設定表、配額與限制說明、本地開發指令、Rollback 流程。

- [ ] **Step 1: 撰寫 `README.md`**

包含：
1. 專案介紹與架構圖（Django + Vite React SPA in single container）。
2. 本機開發：`make dev`、`make dev-reset`、`make install-host`、`make test`、`make run-prod`。
   寫明 dev 網址：前端 `http://localhost:8790`、後端 `http://localhost:8789`；
   compose 檔在 `deployment/dev/`，**直接打 `docker compose up` 會找不到檔案，一律用 `make`**。
   寫明部署檔都在 `deployment/`（dev 與 prod 各一個子目錄），build context 是 repo root。
3. Render 設定表：照抄 spec §6.1 那張表（含 Dockerfile Path 填 `deployment/prod/Dockerfile`），以及建服務的順序：先建服務拿到真實網址，再填 `ALLOWED_HOSTS`。
4. Render 免費層配額注意事項（每月 750 小時、500 分鐘 build、5 GB 流量，以及 15 分鐘休眠喚醒）。
5. 環境變數表：照抄 spec §11 整張表（`SECRET_KEY`、`ALLOWED_HOSTS`、`DEBUG`、`PORT`、`UV_PROJECT_ENVIRONMENT`、`HOST_UID` / `HOST_GID`），並寫明 `DJANGO_ENV` 不存在。
6. Rollback：Render dashboard 的 Rollback 會**自動關掉 Auto-Deploy**，修好後要回 Settings 設回「After CI Checks Pass」，不然之後 push 都不會部署。
7. 事後診斷：`curl` 搜尋 API 看 `meta` 的三個數字（`rawCount` 0 是上游沒資料、`matchedCount` 0 而 `rawCount` 大是過濾壞了、`cacheAge` null 是 cache miss）；`X-Request-ID` 可以拿去 Render Logs 搜，**只保留 7 天**。
8. 「這幾樣東西不會自己告訴你」：
   a. 監控 workflow 在 public repo 60 天沒活動會被 GitHub 自動停用，每兩個月看一次 Actions 頁面。
   b. `verify=False` 是暫時解，MoC 修好憑證不會有人通知，狀態未被監控。
   c. `rollback` 之後 Auto-Deploy 是關的。
9. 加國家不是只加一個 provider 檔：列出 spec §10 那四個卡點（前端 `COMING_SOON`、地址 substring 比對、`fetch_events(category)` 的簽名、i18n 只有 zh/en）。

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: finalize README with deployment tables, environment variables, and dev guide"
```

---

## Phase 5：上 Render

### Task 14: GitHub Actions CI Pipeline

**Files:**
- Create: `.github/workflows/ci.yml`

**Interfaces:**
- CI 包含 `test-backend`, `test-frontend`, `build-smoke`。

- [ ] **Step 1: 建立 `.github/workflows/ci.yml`**

```yaml
name: CI

on:
  push:
    branches: [master]
  pull_request:
    branches: [master]

jobs:
  test-backend:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: astral-sh/setup-uv@v10
        with:
          version: "0.12.5"   # 與兩個 Dockerfile 的 uv 版本一致
      # uv 會照 .python-version 自己裝 Python；測試入口跟本機一樣是 make
      - run: make test-backend

  test-frontend:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: cd frontend && npm ci
      # tsc 與 vite build 由 build-smoke 的 docker build 負責，這裡只跑單元測試
      - run: make test-frontend

  build-smoke:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Build prod image
        run: docker build -f deployment/prod/Dockerfile -t smoke-test-image .
      - name: Start container
        run: |
          docker run -d --name smoke-app -p 8080:8080 \
            -e SECRET_KEY=ci-smoke-key \
            -e ALLOWED_HOSTS=localhost,127.0.0.1 \
            smoke-test-image
      - name: Smoke test
        # 不打真實 MoC：上游一有狀況 pipeline 就紅燈；contract 由 test-backend 的 responses mock 負責
        run: |
          curl -sf --retry 10 --retry-connrefused --retry-delay 1 http://127.0.0.1:8080/health
          curl -sf http://127.0.0.1:8080/ | grep -q "Culture Event Finder"
          curl -sf http://127.0.0.1:8080/api/v1/countries | grep -q '"tw"'
          # public/ 的資產在 prod 是 /static/ 底下；JSX 寫死 /favicon.svg 的話 dev 正常、prod 404
          curl -sf http://127.0.0.1:8080/static/favicon.svg > /dev/null
          # 不存在的路徑要回 SPA 的 index.html（200），不是 500
          curl -sf http://127.0.0.1:8080/no/such/page | grep -q "Culture Event Finder"
      - name: Container logs on failure
        if: failure()
        run: docker logs smoke-app
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: add GitHub Actions CI pipeline with backend, frontend, and container smoke test"
```

---

### Task 15: Render Web Service 部署與驗證 ★ checkpoint

**Files:**
- Documented in: `README.md` & manual dashboard execution

**Interfaces:**
- 建立 Render Web Service
- 確認分配網址後配置 `ALLOWED_HOSTS` 與 `SECRET_KEY`
- 驗收線上服務

- [ ] **Step 1: Owner 在 Render Dashboard 建立 Web Service**
  1. 連接 GitHub repo `culture_event_finder_v2`。
  2. Runtime 選擇 **Docker**；**Dockerfile Path 填 `deployment/prod/Dockerfile`**，Docker Build Context Directory 留空（留空就是 repo root）。漏填 Dockerfile Path 的話 Render 找 `./Dockerfile`，build 直接失敗。
  3. Instance Type 選擇 **Free**，Region 選擇 **Singapore**。
  4. Health Check Path 填寫 `/health`。
  5. **查看系統分配之真實網域名稱**（例如 `culture-event-finder-v2-xxxx.onrender.com`）。

- [ ] **Step 2: 設定環境變數**
  - `SECRET_KEY`：填入以 `python -c "from django.core.management.utils import get_random_secret_key; print(get_random_secret_key())"` 產生的高強度隨機字串。
  - `ALLOWED_HOSTS`：填入 Step 1 取得的真實網域（例如 `culture-event-finder-v2-xxxx.onrender.com`）。

- [ ] **Step 3: 觸發首次部署並以 curl 驗收 ★ checkpoint**

```bash
# 替換為實際分配到的 URL
PROD_URL="https://<真實服務名>.onrender.com"

curl -s "$PROD_URL/health" | grep -q '"status": "ok"' && echo "OK: prod health check"
# 空陣列算沒過（spec §8.1）：斷言 events 筆數 > 0，月份用當月
curl -sf "$PROD_URL/api/v1/tw/events?category=6&location=%E8%87%BA%E5%8C%97&month=$(date +%Y-%m)" \
  | jq -e '.events | length > 0' && echo "OK: prod live query"
```

Expected: 兩項驗證皆通過。

---

### Task 16: GitHub Actions 定時監控與下線清單 ★ checkpoint

**Files:**
- Create: `.github/workflows/monitor.yml`

**Interfaces:**
- 嚴格正向白名單斷言（HTTP 200 + 有效 JSON + events > 0），一行 `curl | jq -e`
- 每 30 分鐘執行一次（`17,47 * * * *`），`curl --max-time 120`
- v1 關閉下線清單執行

- [ ] **Step 1: 建立 `.github/workflows/monitor.yml` (嚴格正向白名單斷言)**

把 `PROD_URL` 換成 Task 15 取得的真實網址。網址本來就是公開的，不用放 secret。

```yaml
name: Production Health Monitor

on:
  schedule:
    - cron: '17,47 * * * *'   # 每 30 分鐘，避開整點的排程延遲
  workflow_dispatch:

env:
  PROD_URL: https://<真實服務名>.onrender.com

jobs:
  health-check:
    runs-on: ubuntu-latest
    steps:
      # 正向白名單：HTTP 200 且是 JSON 且 events 筆數 > 0 才算成功，其餘一律失敗。
      # curl -f 讓 4xx/5xx 失敗；Render 喚醒頁或配額暫停頁是 HTML，jq 解析失敗也是失敗。
      # --max-time 120：服務幾乎每次都睡著，喚醒約 1 分鐘加上游最多 15 秒
      - run: |
          curl -sSf --max-time 120 "$PROD_URL/api/v1/tw/events?category=6&location=%E8%87%BA%E5%8C%97&month=$(date +%Y-%m)" \
            | jq -e '.events | length > 0'
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/monitor.yml
git commit -m "ci: add scheduled production monitoring workflow with strict positive assertion"
```

- [ ] **Step 3: Phase 5 上線穩定一週後之 v1 下線執行清單 ★ checkpoint**
  1. 停用 v1 repo 中的 GitHub scheduled workflows。
  2. 撤銷 Fly.io 的 Deploy Token。
  3. 確認 SQLite volume 資料無留存需求後，執行 `fly apps destroy taiwan-culture-event-info`。
  4. 確認 Fly.io dashboard 的 Billing 頁面無任何收費資源。
  5. v1 README 首行加註「已由 culture_event_finder_v2 取代」並附新網址。

---

---

進度追蹤只記在 `docs/roadmaps/2026-10-04-roadmap-v7.md`，本文件不另放對照表。
