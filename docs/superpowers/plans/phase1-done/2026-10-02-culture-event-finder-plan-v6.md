# Culture Event Finder Refactor：Implementation Plan v6

> ⛔ **SUPERSEDED**：由 `2026-10-04-culture-event-finder-plan-v7.md` 取代（部署檔移到 `deployment/`、dev port 改 8789/8790）。本 plan 的 Task 3、4、12 路徑已失效，不要執行。

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** `docs/superpowers/specs/2026-10-02-culture-event-finder-design-v6.md`

> ⚠️ **本文件自足。執行時不需開啟舊 plan 或舊 spec。**
> `2026-08-23-...-plan-v5.md`、`2026-08-22-...-plan-v4.md`、`2026-07-19-...-plan-v3.md`、
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
- **`uv` binary 版本釘死為 `ghcr.io/astral-sh/uv:0.12.5`**，勿用 `:latest`。出現在兩處（`backend/Dockerfile.dev`、root `Dockerfile`），兩處必須一致。
- **dev container 用 `uv sync --frozen`（不加 `--no-dev`，保留 pytest 等 dev deps）；prod Dockerfile 才加 `--no-dev`。**
- **backend container 的 venv 必須放在 bind mount 之外**：`ENV UV_PROJECT_ENVIRONMENT=/opt/venv`。venv 若落在 `/web/.venv`，host 的 macOS arm64 版本會覆蓋 container 的 linux 版本。
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
- **參數嚴格驗證**：category 需 `category.isascii() and category.isdigit()`；月份 regex 為 `(19|20)\d{2}-(0[1-9]|1[0-2])`。
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

- [x] **spec v6 定稿並通過 Review-Crew 審查修訂**：`docs/superpowers/specs/2026-10-02-culture-event-finder-design-v6.md`
- [x] **POC HTML gate 通過**：`docs/poc/20260719_155200_ui_design_v27.html`
- [x] **三大決策裁決確認**：Provider ABC 保留、前端 20 項全做、v1/v2 彼此獨立。
- [x] **plan v6 定稿**（本文件）

---

## Phase 1：骨架先立好

### Task 1: uv 初始化與依賴配置

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

### Task 2: 建立 `backend/` 目錄與 Django 骨架 ★ checkpoint

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
# 測試後端 health
cd backend && uv run pytest .

# 驗證 fail-fast 守衛 (無 SECRET_KEY / ALLOWED_HOSTS 時必須 crash)
DEBUG=False SECRET_KEY= uv run python manage.py check 2>&1 | grep -q "ImproperlyConfigured" && echo "OK: SECRET_KEY fail-fast verified"
DEBUG=False SECRET_KEY=test-key ALLOWED_HOSTS= uv run python manage.py check 2>&1 | grep -q "ImproperlyConfigured" && echo "OK: ALLOWED_HOSTS fail-fast verified"
cd ..
```

Expected: pytest 跑完 2 tests 全部通過，兩次 check 皆印出 `OK: ... fail-fast verified`。

- [ ] **Step 11: Commit**

```bash
git add backend/ .gitignore
git commit -m "feat(backend): scaffold backend with fail-fast settings and health check"
```

---

### Task 3: dev 環境配置 (`Dockerfile.dev`, `docker-compose.dev.yml`, `Makefile`)

**Files:**
- Create: `backend/Dockerfile.dev`
- Create: `docker-compose.dev.yml`
- Create: `Makefile`

**Interfaces:**
- Produces: `make dev`、`make test-backend` 工作流

- [ ] **Step 1: 建立 `backend/Dockerfile.dev`**

```dockerfile
FROM python:3.13-slim

COPY --from=ghcr.io/astral-sh/uv:0.12.5 /uv /uvx /bin/

WORKDIR /app

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    UV_PROJECT_ENVIRONMENT=/opt/venv \
    PATH="/opt/venv/bin:$PATH"

COPY pyproject.toml uv.lock .python-version ./

RUN uv sync --frozen

EXPOSE 8000

CMD ["uv", "run", "--frozen", "--no-sync", "python", "backend/manage.py", "runserver", "0.0.0.0:8000"]
```

- [ ] **Step 2: 建立 `docker-compose.dev.yml`（先含 backend service，待 T4 加 frontend）**

```yaml
services:
  backend:
    build:
      context: .
      dockerfile: backend/Dockerfile.dev
    volumes:
      - .:/app
    environment:
      - DEBUG=True
      - ALLOWED_HOSTS=localhost,127.0.0.1,backend
      - PORT=8000
    ports:
      - "8000:8000"
```

- [ ] **Step 3: 建立 `Makefile`**

```makefile
.PHONY: dev test test-backend test-frontend build-prod run-prod

dev:
	docker compose -f docker-compose.dev.yml up --build

test-backend:
	cd backend && DEBUG=True uv run pytest .

test-frontend:
	@echo "Frontend test target - will be wired in Task 4"

test: test-backend test-frontend

build-prod:
	docker build -t culture-event-finder-prod .

run-prod:
	docker run -p 8080:8080 -e SECRET_KEY=local-prod-test-key -e ALLOWED_HOSTS=localhost,127.0.0.1 culture-event-finder-prod
```

- [ ] **Step 4: 測試 `make test-backend`**

```bash
make test-backend
```

Expected: pytest 執行並全部 PASS。

- [ ] **Step 5: Commit**

```bash
git add backend/Dockerfile.dev docker-compose.dev.yml Makefile
git commit -m "feat(dev): setup backend Dockerfile.dev, compose, and Makefile"
```

---

### Task 4: 前端 scaffold (Vite + React + TS + Tailwind + Vitest) ★ checkpoint

**Files:**
- Create: `frontend/` package.json, vite.config.ts, tsconfig.json, vitest.config.ts, index.html
- Create: `frontend/src/App.tsx`, `frontend/src/main.tsx`, `frontend/src/index.css`
- Create: `frontend/src/smoke.test.ts`
- Create: `frontend/Dockerfile.dev`
- Modify: `docker-compose.dev.yml`（加入 frontend service 與 reverse proxy/cors 支援）
- Modify: `Makefile`（完善 `test-frontend`）

**Interfaces:**
- Produces: 前端開發伺服器（port 5173），`make test` 同步執行前後端單元測試。

- [ ] **Step 1: 初始化 `frontend/` 目錄與配置檔案**

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
    "tailwindcss": "^4.0.0",
    "typescript": "^5.6.3",
    "vite": "^6.0.0",
    "vitest": "^2.1.8"
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
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://backend:8000',
        changeOrigin: true,
      },
      '/health': {
        target: 'http://backend:8000',
        changeOrigin: true,
      },
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

建立 `frontend/src/index.css`：
```css
@import "tailwindcss";

:root {
  color-scheme: dark light;
}
```

建立 `frontend/src/App.tsx` 與 `frontend/src/main.tsx`：
```tsx
// frontend/src/App.tsx
import React from 'react';

export function App() {
  return (
    <div className="min-h-screen bg-slate-900 text-white flex items-center justify-center">
      <h1 className="text-3xl font-bold">Culture Event Finder v2</h1>
    </div>
  );
}

// frontend/src/main.tsx
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
  it('basic assertion passes', () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 2: 建立 `frontend/Dockerfile.dev`**

```dockerfile
FROM node:22-slim

WORKDIR /app/frontend

COPY frontend/package.json ./

RUN npm install

EXPOSE 5173

CMD ["npm", "run", "dev"]
```

- [ ] **Step 3: 更新 `docker-compose.dev.yml`**

```yaml
services:
  backend:
    build:
      context: .
      dockerfile: backend/Dockerfile.dev
    volumes:
      - .:/app
    environment:
      - DEBUG=True
      - ALLOWED_HOSTS=localhost,127.0.0.1,backend
      - PORT=8000
    ports:
      - "8000:8000"

  frontend:
    build:
      context: .
      dockerfile: frontend/Dockerfile.dev
    volumes:
      - ./frontend:/app/frontend
      - /app/frontend/node_modules
    ports:
      - "5173:5173"
    environment:
      - VITE_API_PROXY=http://backend:8000
    depends_on:
      - backend
```

- [ ] **Step 4: 更新 `Makefile`**

```makefile
.PHONY: dev test test-backend test-frontend build-prod run-prod

dev:
	docker compose -f docker-compose.dev.yml up --build

test-backend:
	cd backend && DEBUG=True uv run pytest .

test-frontend:
	cd frontend && npm test

test: test-backend test-frontend

build-prod:
	docker build -t culture-event-finder-prod .

run-prod:
	docker run -p 8080:8080 -e SECRET_KEY=local-prod-test-key -e ALLOWED_HOSTS=localhost,127.0.0.1 culture-event-finder-prod
```

- [ ] **Step 5: 本機安裝 node_modules 並跑測試 ★ checkpoint**

```bash
cd frontend && npm install && npm test && npm run build
cd ..
make test
```

Expected: 前端 `npm test` 與 `npm run build` 通過，根目錄 `make test` 同時通過後端 pytest 與前端 vitest！

- [ ] **Step 6: Commit**

```bash
git add frontend/ docker-compose.dev.yml Makefile
git commit -m "feat(frontend): scaffold react vite ts tailwind vitest frontend"
```

---

## Phase 2：後端

### Task 5: Provider layer (base.py + taiwan.py + registry)

**Files:**
- Create: `backend/events/__init__.py`
- Create: `backend/events/apps.py`
- Create: `backend/events/models.py` (空白或僅宣告不需要 DB)
- Create: `backend/events/providers/__init__.py`
- Create: `backend/events/providers/base.py`
- Create: `backend/events/providers/taiwan.py`
- Create: `backend/events/providers/registry.py`
- Create: `backend/events/tests/__init__.py`
- Create: `backend/events/tests/test_providers.py`
- Modify: `backend/config/settings.py`（加入 `events.apps.EventsConfig`）

**Interfaces:**
- `Provider` ABC：`fetch_events(category: str) -> list[Event]`、`locations: list[dict]`、`categories: list[dict]`、`metadata: dict`。
- `TaiwanProvider`：封裝 MoC API、SSL workaround、20 個前綴涵蓋 22 縣市、list 驗證。

- [ ] **Step 1: 建立 `backend/events/apps.py` 與登錄 settings**

```python
# backend/events/apps.py
from django.apps import AppConfig

class EventsConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "events"
```

在 `backend/config/settings.py` 的 `INSTALLED_APPS` 加上 `"events.apps.EventsConfig"`。

- [ ] **Step 2: 建立 `backend/events/providers/base.py` (保留 ABC 架構)**

```python
from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Optional

class UpstreamError(Exception):
    """Raised when an external event data provider fails or returns invalid data."""
    pass

@dataclass(frozen=True)
class Event:
    id: str
    title: str
    category: str
    location: str
    address: str
    start_time: str  # ISO format string or YYYY-MM-DD HH:MM:SS
    end_time: Optional[str]
    price: str
    description: str
    source_url: str
    image_url: Optional[str] = None

class BaseProvider(ABC):
    @property
    @abstractmethod
    def country_code(self) -> str:
        """Two-letter country code in lowercase, e.g., 'tw'."""
        pass

    @property
    @abstractmethod
    def country_name(self) -> dict[str, str]:
        """Localized country name, e.g., {'zh': '台灣', 'en': 'Taiwan'}."""
        pass

    @property
    @abstractmethod
    def categories(self) -> list[dict]:
        """List of available category mappings: [{'id': '6', 'zh': '展覽', 'en': 'Exhibition'}, ...]"""
        pass

    @property
    @abstractmethod
    def locations(self) -> list[dict]:
        """List of location prefixes."""
        pass

    @abstractmethod
    def fetch_events(self, category: str) -> list[Event]:
        """Fetch raw events for a category from upstream source."""
        pass
```

- [ ] **Step 3: 建立 `backend/events/providers/taiwan.py`**

```python
import urllib3
import requests
from toolkitsy.logger import logger
from events.providers.base import BaseProvider, Event, UpstreamError

# 關閉針對 MoC 政府憑證缺 Subject Key Identifier 的 InsecureRequestWarning
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

MOC_API_URL = "https://cloud.culture.tw/frontsite/trans/SearchShowAction.do"

# 20 個地點前綴，涵蓋台灣全部 22 個縣市 (新竹共用、嘉義共用)
TAIWAN_LOCATIONS = [
    {"id": "臺北", "zh": "臺北", "en": "Taipei"},
    {"id": "新北", "zh": "新北", "en": "New Taipei"},
    {"id": "桃園", "zh": "桃園", "en": "Taoyuan"},
    {"id": "臺中", "zh": "臺中", "en": "Taichung"},
    {"id": "臺南", "zh": "臺南", "en": "Tainan"},
    {"id": "高雄", "zh": "高雄", "en": "Kaohsiung"},
    {"id": "基隆", "zh": "基隆", "en": "Keelung"},
    {"id": "新竹", "zh": "新竹", "en": "Hsinchu"},
    {"id": "苗栗", "zh": "苗栗", "en": "Miaoli"},
    {"id": "彰化", "zh": "彰化", "en": "Changhua"},
    {"id": "南投", "zh": "南投", "en": "Nantou"},
    {"id": "雲林", "zh": "雲林", "en": "Yunlin"},
    {"id": "嘉義", "zh": "嘉義", "en": "Chiayi"},
    {"id": "屏東", "zh": "屏東", "en": "Pingtung"},
    {"id": "宜蘭", "zh": "宜蘭", "en": "Yilan"},
    {"id": "花蓮", "zh": "花蓮", "en": "Hualien"},
    {"id": "臺東", "zh": "臺東", "en": "Taitung"},
    {"id": "澎湖", "zh": "澎湖", "en": "Penghu"},
    {"id": "金門", "zh": "金門", "en": "Kinmen"},
    {"id": "連江", "zh": "連江", "en": "Lienchiang"},
]

TAIWAN_CATEGORIES = [
    {"id": "1", "zh": "音樂", "en": "Music"},
    {"id": "2", "zh": "戲劇", "en": "Theater"},
    {"id": "3", "zh": "舞蹈", "en": "Dance"},
    {"id": "4", "zh": "親子", "en": "Family"},
    {"id": "5", "zh": "獨立音樂", "en": "Indie Music"},
    {"id": "6", "zh": "展覽", "en": "Exhibition"},
    {"id": "7", "zh": "講座", "en": "Lecture"},
    {"id": "8", "zh": "電影", "en": "Movie"},
    {"id": "11", "zh": "綜藝", "en": "Variety"},
    {"id": "13", "zh": "競賽", "en": "Competition"},
    {"id": "14", "zh": "徵選", "en": "Audition"},
    {"id": "15", "zh": "其他", "en": "Other"},
    {"id": "17", "zh": "市集", "en": "Market"},
    {"id": "19", "zh": "研習課程", "en": "Workshop"},
]

class TaiwanProvider(BaseProvider):
    country_code = "tw"
    country_name = {"zh": "台灣", "en": "Taiwan"}
    categories = TAIWAN_CATEGORIES
    locations = TAIWAN_LOCATIONS

    def fetch_events(self, category: str) -> list[Event]:
        params = {"method": "doFindTypeJ", "category": category}
        try:
            response = requests.get(MOC_API_URL, params=params, verify=False, timeout=15)
            response.raise_for_status()
            payload = response.json()
        except requests.exceptions.RequestException as exc:
            logger.error("TaiwanProvider HTTP request failed: %s", exc)
            raise UpstreamError(f"MoC API request failed: {exc}") from exc
        except ValueError as exc:
            logger.error("TaiwanProvider JSON parse failed: %s", exc)
            raise UpstreamError("MoC API returned invalid JSON") from exc

        if not isinstance(payload, list):
            logger.error("TaiwanProvider expected list payload, got %s", type(payload))
            raise UpstreamError("MoC API payload format error: expected list")

        events = []
        for item in payload:
            try:
                event_id = str(item.get("UID", ""))
                title = str(item.get("title", "")).strip()
                if not event_id or not title:
                    continue

                show_info_list = item.get("showInfo", [])
                first_show = show_info_list[0] if isinstance(show_info_list, list) and show_info_list else {}

                location_name = str(first_show.get("locationName", "")).strip()
                address = str(first_show.get("location", "")).strip()
                start_time = str(first_show.get("time", "")).strip()
                end_time = str(first_show.get("endTime", "")).strip() or None
                price = str(first_show.get("price", "")).strip()

                desc = str(item.get("descriptionFilterHtml", "")).strip()
                source_url = str(item.get("sourceWebPromote", "")).strip() or MOC_API_URL
                image_url = str(item.get("imageUrl", "")).strip() or None

                events.append(Event(
                    id=event_id,
                    title=title,
                    category=category,
                    location=location_name or address or "未提供地點",
                    address=address,
                    start_time=start_time,
                    end_time=end_time,
                    price=price,
                    description=desc,
                    source_url=source_url,
                    image_url=image_url,
                ))
            except (AttributeError, TypeError) as exc:
                logger.warning("Error parsing single event item: %s", exc)
                continue

        return events
```

- [ ] **Step 4: 建立 `backend/events/providers/registry.py`**

```python
from events.providers.base import BaseProvider
from events.providers.taiwan import TaiwanProvider

PROVIDERS: dict[str, BaseProvider] = {
    "tw": TaiwanProvider(),
}

def get_provider(country_code: str) -> BaseProvider | None:
    return PROVIDERS.get(country_code.lower())
```

- [ ] **Step 5: 建立 `backend/events/tests/test_providers.py`**

```python
import responses
from django.test import TestCase
from events.providers.taiwan import TaiwanProvider, MOC_API_URL
from events.providers.base import UpstreamError

class TaiwanProviderTests(TestCase):
    def setUp(self):
        self.provider = TaiwanProvider()

    def test_location_prefixes_cover_22_counties(self):
        # 斷言長度為 20 (新竹、嘉義共用)
        self.assertEqual(len(self.provider.locations), 20)
        location_ids = {loc["id"] for loc in self.provider.locations}
        self.assertIn("宜蘭", location_ids)
        self.assertIn("連江", location_ids)
        self.assertIn("新竹", location_ids)

    @responses.activate
    def test_fetch_events_success(self):
        mock_payload = [
            {
                "UID": "evt1",
                "title": "測試展覽",
                "showInfo": [{"time": "2026/07/01 10:00:00", "endTime": "2026/07/15 18:00:00", "location": "台北市信義區", "locationName": "松菸", "price": "免費"}],
                "descriptionFilterHtml": "展覽介紹",
                "sourceWebPromote": "https://example.com"
            }
        ]
        responses.add(responses.GET, MOC_API_URL, json=mock_payload, status=200)

        events = self.provider.fetch_events("6")
        self.assertEqual(len(events), 1)
        self.assertEqual(events[0].id, "evt1")
        self.assertEqual(events[0].title, "測試展覽")
        self.assertEqual(events[0].price, "免費")

    @responses.activate
    def test_fetch_events_non_list_payload_raises_upstream_error(self):
        responses.add(responses.GET, MOC_API_URL, json={"data": []}, status=200)
        with self.assertRaises(UpstreamError):
            self.provider.fetch_events("6")

    @responses.activate
    def test_fetch_events_upstream_500_raises_upstream_error(self):
        responses.add(responses.GET, MOC_API_URL, status=500)
        with self.assertRaises(UpstreamError):
            self.provider.fetch_events("6")
```

- [ ] **Step 6: 跑測試並驗證**

```bash
cd backend && uv run pytest events/tests/test_providers.py && cd ..
```

Expected: 全部 PASS。

- [ ] **Step 7: Commit**

```bash
git add backend/events/
git commit -m "feat(backend): implement provider layer with BaseProvider ABC and TaiwanProvider"
```

---

### Task 6: Services layer (cache-aside + 區間重疊過濾 + 排序)

**Files:**
- Create: `backend/events/services.py`
- Create: `backend/events/tests/test_services.py`

**Interfaces:**
- `search_events(country: str, category: str, location: str, month: str) -> dict`
- 包含 12h TTL LocMemCache、區間重疊比對、異體字正規化、白名單驗證、`meta: {rawCount, matchedCount, cacheAge}`。

- [ ] **Step 1: 建立 `backend/events/services.py`**

```python
import re
import time
from datetime import datetime, date
import calendar
from django.core.cache import cache
from toolkitsy.logger import logger
from events.providers.registry import get_provider
from events.providers.base import Event, UpstreamError

MONTH_REGEX = re.compile(r"^(19|20)\d{2}-(0[1-9]|1[0-2])$")

def normalize_text(text: str) -> str:
    """把 '台' 統一正規化為 '臺'"""
    return text.replace("台", "臺")

def parse_iso_or_slash_date(dt_str: str) -> date | None:
    if not dt_str:
        return None
    cleaned = dt_str.strip().split()[0].replace("-", "/")
    try:
        return datetime.strptime(cleaned, "%Y/%m/%d").date()
    except ValueError:
        return None

def is_event_active_in_month(event: Event, target_year: int, target_month: int) -> bool:
    start_d = parse_iso_or_slash_date(event.start_time)
    if not start_d:
        return False

    end_d = parse_iso_or_slash_date(event.end_time) or start_d

    # 當月的第一天與最後一天
    first_day = date(target_year, target_month, 1)
    last_day_num = calendar.monthrange(target_year, target_month)[1]
    last_day = date(target_year, target_month, last_day_num)

    # 區間重疊判斷: event_start <= month_end and event_end >= month_start
    return start_d <= last_day and end_d >= first_day

def validate_search_params(provider, category: str, location: str, month: str):
    if not (category.isascii() and category.isdigit()):
        raise ValueError("Invalid category parameter: must be ASCII digits.")

    valid_cat_ids = {c["id"] for c in provider.categories}
    if category not in valid_cat_ids:
        raise ValueError(f"Category '{category}' is not supported.")

    if not MONTH_REGEX.match(month):
        raise ValueError("Invalid month format: must be YYYY-MM (e.g. 2026-07).")

    norm_loc = normalize_text(location)
    valid_loc_ids = {loc["id"] for loc in provider.locations}
    if norm_loc not in valid_loc_ids:
        raise ValueError(f"Location '{location}' is not supported.")

    return norm_loc

def get_cached_raw_events(country: str, category: str, provider) -> tuple[list[Event], int]:
    cache_key = f"events:{country}:{category}"
    cached_data = cache.get(cache_key)

    now = int(time.time())
    if cached_data is not None:
        logger.info("cache HIT key=%s", cache_key)
        events, cached_at = cached_data
        cache_age = now - cached_at
        return events, cache_age

    logger.info("cache MISS key=%s", cache_key)
    events = provider.fetch_events(category)
    cache.set(cache_key, (events, now), timeout=43200)
    return events, 0

def search_events(country: str, category: str, location: str, month: str) -> dict:
    provider = get_provider(country)
    if not provider:
        raise KeyError(f"Country '{country}' not found.")

    norm_location = validate_search_params(provider, category, location, month)

    raw_events, cache_age = get_cached_raw_events(country, category, provider)

    year_str, month_str = month.split("-")
    target_year = int(year_str)
    target_month = int(month_str)

    matched = []
    for evt in raw_events:
        # 地點 substring 比對 (皆正規化為 '臺')
        evt_loc_norm = normalize_text(evt.location + " " + evt.address)
        if norm_location not in evt_loc_norm:
            continue

        # 月份區間重疊判定
        if not is_event_active_in_month(evt, target_year, target_month):
            continue

        matched.append(evt)

    # 排序：依開始時間由近到遠
    matched.sort(key=lambda e: e.start_time)

    return {
        "events": matched,
        "meta": {
            "rawCount": len(raw_events),
            "matchedCount": len(matched),
            "cacheAge": cache_age,
        },
    }
```

- [ ] **Step 2: 建立 `backend/events/tests/test_services.py`**

```python
from unittest.mock import patch
from django.test import TestCase
from django.core.cache import cache
from events.providers.base import Event
from events.services import search_events, is_event_active_in_month

class ServicesTests(TestCase):
    def setUp(self):
        cache.clear()

    def test_interval_overlap_matching_cross_month(self):
        # 1月開跑、12月結束的跨月展覽
        evt = Event(
            id="e1", title="整年展覽", category="6", location="台北市", address="台北市",
            start_time="2026/01/01 09:00:00", end_time="2026/12/31 18:00:00",
            price="100", description="", source_url=""
        )
        # 查 9 月必須命中
        self.assertTrue(is_event_active_in_month(evt, 2026, 9))
        # 查 2025 年 12 月不可命中
        self.assertFalse(is_event_active_in_month(evt, 2025, 12))

    @patch("events.providers.taiwan.TaiwanProvider.fetch_events")
    def test_search_events_cache_and_filter(self, mock_fetch):
        mock_fetch.return_value = [
            Event(
                id="e1", title="松菸展覽", category="6", location="台北市松菸", address="台北市信義區",
                start_time="2026/07/01 10:00:00", end_time="2026/07/20 18:00:00",
                price="免費", description="", source_url=""
            ),
            Event(
                id="e2", title="高雄市集", category="6", location="高雄市駁二", address="高雄市鹽埕區",
                start_time="2026/07/01 10:00:00", end_time="2026/07/20 18:00:00",
                price="免費", description="", source_url=""
            ),
        ]

        # 查詢台北 (輸入'台北'，需自動正規化命中'臺北')
        result1 = search_events("tw", "6", "台北", "2026-07")
        self.assertEqual(len(result1["events"]), 1)
        self.assertEqual(result1["events"][0].id, "e1")
        self.assertEqual(result1["meta"]["cacheAge"], 0)
        self.assertEqual(mock_fetch.call_count, 1)

        # 第二次相同類別查詢，命中快取，不應再次呼叫 fetch_events
        result2 = search_events("tw", "6", "台北", "2026-07")
        self.assertEqual(mock_fetch.call_count, 1)
        self.assertGreaterEqual(result2["meta"]["cacheAge"], 0)

    def test_search_events_invalid_params_raise_value_error(self):
        with self.assertRaises(ValueError):
            search_events("tw", "invalid_cat", "臺北", "2026-07")

        with self.assertRaises(ValueError):
            search_events("tw", "6", "東京", "2026-07")

        with self.assertRaises(ValueError):
            search_events("tw", "6", "臺北", "2026-13")
```

- [ ] **Step 3: 跑測試並驗證**

```bash
cd backend && uv run pytest events/tests/test_services.py && cd ..
```

Expected: 全部 PASS。

- [ ] **Step 4: Commit**

```bash
git add backend/events/services.py backend/events/tests/test_services.py
git commit -m "feat(backend): implement services layer with cache-aside, interval overlap, and normalization"
```

---

### Task 7: API endpoints + wiring ★ checkpoint

**Files:**
- Create: `backend/events/views.py`
- Create: `backend/events/urls.py`
- Modify: `backend/config/urls.py`
- Create: `backend/events/tests/test_views.py`

**Interfaces:**
- `GET /api/v1/countries`
- `GET /api/v1/{country}/categories`
- `GET /api/v1/{country}/locations`
- `GET /api/v1/{country}/events?category=...&location=...&month=...`

- [ ] **Step 1: 建立 `backend/events/views.py`**

```python
from dataclasses import asdict
from django.http import JsonResponse
from django.views.decorators.http import require_GET
from events.providers.registry import PROVIDERS, get_provider
from events.providers.base import UpstreamError
from events.services import search_events

@require_GET
def list_countries(request):
    data = [
        {"code": p.country_code, "name": p.country_name}
        for p in PROVIDERS.values()
    ]
    return JsonResponse({"countries": data})

@require_GET
def list_categories(request, country):
    provider = get_provider(country)
    if not provider:
        return JsonResponse({"error": f"Country '{country}' not found"}, status=404)
    return JsonResponse({"categories": provider.categories})

@require_GET
def list_locations(request, country):
    provider = get_provider(country)
    if not provider:
        return JsonResponse({"error": f"Country '{country}' not found"}, status=404)
    return JsonResponse({"locations": provider.locations})

@require_GET
def get_events(request, country):
    provider = get_provider(country)
    if not provider:
        return JsonResponse({"error": f"Country '{country}' not found"}, status=404)

    category = request.GET.get("category", "").strip()
    location = request.GET.get("location", "").strip()
    month = request.GET.get("month", "").strip()

    if not category or not location or not month:
        return JsonResponse(
            {"error": "Missing required query parameters: category, location, month"},
            status=400,
        )

    try:
        result = search_events(country, category, location, month)
    except ValueError as exc:
        return JsonResponse({"error": str(exc)}, status=400)
    except UpstreamError as exc:
        return JsonResponse({"error": "Upstream service error", "detail": str(exc)}, status=502)

    events_data = [asdict(e) for e in result["events"]]
    return JsonResponse({
        "events": events_data,
        "meta": result["meta"],
    })
```

- [ ] **Step 2: 建立 `backend/events/urls.py` 並串接 `config/urls.py`**

```python
# backend/events/urls.py
from django.urls import path
from events import views

urlpatterns = [
    path("countries", views.list_countries, name="list-countries"),
    path("<str:country>/categories", views.list_categories, name="list-categories"),
    path("<str:country>/locations", views.list_locations, name="list-locations"),
    path("<str:country>/events", views.get_events, name="get-events"),
]

# backend/config/urls.py
from django.urls import path, include

urlpatterns = [
    path("health", include("health.urls")),
    path("health/", include("health.urls")),
    path("api/v1/", include("events.urls")),
]
```

- [ ] **Step 3: 建立 `backend/events/tests/test_views.py`**

```python
from unittest.mock import patch
from django.test import TestCase, Client
from events.providers.base import Event, UpstreamError

class EventViewsTests(TestCase):
    def setUp(self):
        self.client = Client()

    def test_list_countries(self):
        res = self.client.get("/api/v1/countries")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertIn("countries", data)
        self.assertEqual(data["countries"][0]["code"], "tw")

    def test_list_categories_and_locations(self):
        res = self.client.get("/api/v1/tw/categories")
        self.assertEqual(res.status_code, 200)
        self.assertIn("categories", res.json())

        res = self.client.get("/api/v1/tw/locations")
        self.assertEqual(res.status_code, 200)
        self.assertIn("locations", res.json())

    def test_list_invalid_country_returns_404(self):
        res = self.client.get("/api/v1/jp/categories")
        self.assertEqual(res.status_code, 404)

    def test_get_events_missing_params_returns_400(self):
        res = self.client.get("/api/v1/tw/events?category=6")
        self.assertEqual(res.status_code, 400)

    @patch("events.services.search_events")
    def test_get_events_upstream_error_returns_502(self, mock_search):
        mock_search.side_effect = UpstreamError("MoC down")
        res = self.client.get("/api/v1/tw/events?category=6&location=臺北&month=2026-07")
        self.assertEqual(res.status_code, 502)
        self.assertEqual(res.json()["error"], "Upstream service error")

    @patch("events.services.search_events")
    def test_get_events_success(self, mock_search):
        mock_search.return_value = {
            "events": [Event("1", "展覽", "6", "台北", "台北", "2026/07/01", "2026/07/02", "0", "desc", "url")],
            "meta": {"rawCount": 1, "matchedCount": 1, "cacheAge": 0},
        }
        res = self.client.get("/api/v1/tw/events?category=6&location=臺北&month=2026-07")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(len(res.json()["events"]), 1)
```

- [ ] **Step 4: 執行後端全測試並打真實 MoC API 驗證 ★ checkpoint**

```bash
cd backend && uv run pytest . -v
# 啟動 server 實測一次真實 MoC
uv run python manage.py runserver 127.0.0.1:8000 &
SERVER_PID=$!
sleep 2
curl -s "http://127.0.0.1:8000/api/v1/tw/events?category=6&location=%E8%87%BA%E5%8C%97&month=2026-10" | grep -q '"events":' && echo "OK: live MoC query works"
kill $SERVER_PID
cd ..
```

Expected: 全部後端測試 PASS，真實查詢印出 `OK: live MoC query works`。

- [ ] **Step 5: Commit**

```bash
git add backend/events/views.py backend/events/urls.py backend/config/urls.py backend/events/tests/test_views.py
git commit -m "feat(backend): wire API endpoints for countries, categories, locations, and events"
```

---

## Phase 3：前端

### Task 8: 前端型別、API Client (結構化錯誤分類) 與格式工具函式 (TDD)

**Files:**
- Create: `frontend/src/types/index.ts`
- Create: `frontend/src/api/client.ts`
- Create: `frontend/src/utils/format.ts`
- Create: `frontend/src/utils/format.test.ts`
- Create: `frontend/src/api/client.test.ts`

**Interfaces:**
- `TransientError` / `UpstreamError` / `ClientError`
- `formatDateRange(start, end)` (支援跨月)
- `formatPrice(price)` (純數字加 $、0 顯示免費)
- `buildGoogleMapUrl(location, address)` (URL encode)
- `buildGoogleSearchUrl(title)` (URL encode)

- [ ] **Step 1: 建立 `frontend/src/types/index.ts`**

```typescript
export interface EventItem {
  id: string;
  title: string;
  category: string;
  location: string;
  address: string;
  start_time: string;
  end_time: string | null;
  price: string;
  description: string;
  source_url: string;
  image_url: string | null;
}

export interface LabeledOption {
  id: string | number;
  zh: string;
  en: string;
}

export interface CountryInfo {
  code: string;
  name: { zh: string; en: string };
}

export interface SearchQuery {
  country: string;
  category: string;
  location: string;
  year: string;
  month: string;
}

export interface QueryMeta {
  rawCount: number;
  matchedCount: number;
  cacheAge: number;
}
```

- [ ] **Step 2: 建立 `frontend/src/utils/format.ts` 與 `format.test.ts` (TDD)**

```typescript
// frontend/src/utils/format.ts
export function buildGoogleMapUrl(location: string, address: string): string {
  const query = address || location;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

export function buildGoogleSearchUrl(title: string): string {
  return `https://www.google.com/search?q=${encodeURIComponent(title)}`;
}

export function formatPrice(priceStr: string, isEn = false): string {
  const trimmed = priceStr.trim();
  if (!trimmed || trimmed === '0') {
    return isEn ? 'Free' : '免費';
  }
  if (/^\d+(\.\d+)?$/.test(trimmed)) {
    return `$${trimmed}`;
  }
  return trimmed;
}

export function formatDateRange(startStr: string, endStr: string | null): string {
  if (!startStr) return '';
  const cleanStart = startStr.trim().replace(/-/g, '/');
  if (!endStr || !endStr.trim()) {
    return cleanStart.split(' ')[0];
  }
  const cleanEnd = endStr.trim().replace(/-/g, '/');
  const startDay = cleanStart.split(' ')[0];
  const endDay = cleanEnd.split(' ')[0];

  if (startDay === endDay) {
    return startDay;
  }
  return `${startDay} – ${endDay}`;
}

// frontend/src/utils/format.test.ts
import { describe, it, expect } from 'vitest';
import { buildGoogleMapUrl, buildGoogleSearchUrl, formatPrice, formatDateRange } from './format';

describe('Format Utils', () => {
  it('encodes google map and search urls properly', () => {
    expect(buildGoogleMapUrl('松菸 & 誠品', '台北市#1')).toContain('query=%E5%8F%B0%E5%8C%97%E5%B8%82%231');
    expect(buildGoogleSearchUrl('藝術展 & 音樂會')).toContain('q=%E8%97%9D%E8%A1%93%E5%B1%95%20%26%20%E9%9F%B3%E6%A8%82%E6%9C%83');
  });

  it('formats prices with free or dollar prefix', () => {
    expect(formatPrice('0')).toBe('免費');
    expect(formatPrice('150')).toBe('$150');
    expect(formatPrice('洽詢主辦單位')).toBe('洽詢主辦單位');
  });

  it('formats single date and date intervals', () => {
    expect(formatDateRange('2026/07/01 10:00:00', null)).toBe('2026/07/01');
    expect(formatDateRange('2026/07/01 10:00:00', '2026/07/15 18:00:00')).toBe('2026/07/01 – 2026/07/15');
  });
});
```

- [ ] **Step 3: 建立 `frontend/src/api/client.ts` (結構化錯誤分類)**

```typescript
import { EventItem, QueryMeta, CountryInfo, LabeledOption } from '../types';

export class TransientError extends Error {
  constructor(message = '連線逾時或服務喚醒中，請稍候重試') {
    super(message);
    this.name = 'TransientError';
  }
}

export class UpstreamError extends Error {
  constructor(message = '文化部資料來源暫時無法使用，請稍後再試') {
    super(message);
    this.name = 'UpstreamError';
  }
}

export class ClientError extends Error {
  constructor(message = '查詢參數無效') {
    super(message);
    this.name = 'ClientError';
  }
}

async function handleResponse<T>(res: Response): Promise<T> {
  let json: any;
  try {
    json = await res.json();
  } catch (err) {
    // 非 JSON 回應 (例如 Render 叫醒期間吐的 HTML 或 503 暫態頁)
    throw new TransientError('伺服器連線異常或正在喚醒中，請稍候重試');
  }

  if (!res.ok) {
    if (res.status === 502) {
      throw new UpstreamError(json.detail || '文化部資料來源暫時無法使用');
    }
    if (res.status === 400 || res.status === 404) {
      throw new ClientError(json.error || '查詢請求錯誤');
    }
    if (res.status >= 500) {
      throw new TransientError('伺服器連線異常，請稍候重試');
    }
    throw new Error(json.error || '未預期的錯誤');
  }

  return json as T;
}

export async function fetchCountries(signal?: AbortSignal): Promise<CountryInfo[]> {
  try {
    const res = await fetch('/api/v1/countries', { signal });
    const data = await handleResponse<{ countries: CountryInfo[] }>(res);
    return data.countries;
  } catch (err: any) {
    if (err.name === 'AbortError') throw err;
    if (err instanceof TransientError || err instanceof UpstreamError || err instanceof ClientError) throw err;
    throw new TransientError('無法取得國家清單');
  }
}

export async function fetchCategories(country: string, signal?: AbortSignal): Promise<LabeledOption[]> {
  const res = await fetch(`/api/v1/${country}/categories`, { signal });
  const data = await handleResponse<{ categories: LabeledOption[] }>(res);
  return data.categories;
}

export async function fetchLocations(country: string, signal?: AbortSignal): Promise<LabeledOption[]> {
  const res = await fetch(`/api/v1/${country}/locations`, { signal });
  const data = await handleResponse<{ locations: LabeledOption[] }>(res);
  return data.locations;
}

export async function searchEvents(
  country: string,
  category: string,
  location: string,
  month: string,
  signal?: AbortSignal
): Promise<{ events: EventItem[]; meta: QueryMeta }> {
  const params = new URLSearchParams({ category, location, month });
  try {
    const res = await fetch(`/api/v1/${country}/events?${params.toString()}`, { signal });
    return await handleResponse<{ events: EventItem[]; meta: QueryMeta }>(res);
  } catch (err: any) {
    if (err.name === 'AbortError') throw err;
    if (err instanceof TransientError || err instanceof UpstreamError || err instanceof ClientError) throw err;
    throw new TransientError('網路連線逾時，請稍候再試');
  }
}
```

- [ ] **Step 4: 執行前端測試驗證**

```bash
cd frontend && npm test && cd ..
```

Expected: 全部 PASS。

- [ ] **Step 5: Commit**

```bash
git add frontend/src/types/ frontend/src/utils/ frontend/src/api/
git commit -m "feat(frontend): add types, structured api client, and url/date formatting utils"
```

---

### Task 9: i18n 輕量語系系統與切換 ★ checkpoint

**Files:**
- Create: `frontend/src/locales/zh.json`
- Create: `frontend/src/locales/en.json`
- Create: `frontend/src/context/i18n.tsx`
- Create: `frontend/src/context/i18n.test.ts`
- Create: `frontend/src/components/LanguageSwitch.tsx`

**Interfaces:**
- `useI18n()` hook: `t(key)`, `lang`, `setLang(lang)`, `pickLabel(opt)`
- Vitest 驗收三項斷言：缺 key fallback、pickLabel 在 en 正確、document.documentElement.lang 隨之更新。

- [ ] **Step 1: 建立語系字典**

```json
// frontend/src/locales/zh.json
{
  "app_title": "Culture Event Finder",
  "search": "搜尋",
  "reset": "重設",
  "loading_short": "搜尋活動中...",
  "loading_slow": "第一次查詢比較慢，正在向文化部要資料...",
  "empty_title": "查無相關活動",
  "empty_desc": "換個地區或月份再試一次，或者清除條件重設。",
  "retry": "重新嘗試",
  "free": "免費",
  "country": "國家",
  "category": "類別",
  "location": "地區",
  "year": "年",
  "month": "月",
  "about": "關於",
  "total_events": "{{count}} 筆活動"
}

// frontend/src/locales/en.json
{
  "app_title": "Culture Event Finder",
  "search": "Search",
  "reset": "Reset",
  "loading_short": "Searching events...",
  "loading_slow": "First query takes longer, fetching from Ministry of Culture...",
  "empty_title": "No Events Found",
  "empty_desc": "Try another region or month, or reset your search filters.",
  "retry": "Try Again",
  "free": "Free",
  "country": "Country",
  "category": "Category",
  "location": "Region",
  "year": "Year",
  "month": "Month",
  "about": "About",
  "total_events": "{{count}} events"
}
```

- [ ] **Step 2: 建立 `frontend/src/context/i18n.tsx`**

```tsx
import React, { createContext, useContext, useState, useEffect } from 'react';
import zhDict from '../locales/zh.json';
import enDict from '../locales/en.json';

export type Lang = 'zh' | 'en';

const dictionaries: Record<Lang, Record<string, string>> = {
  zh: zhDict,
  en: enDict,
};

interface I18nContextType {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: (key: string, params?: Record<string, string | number>) => string;
  pickLabel: (item: { zh: string; en: string }) => string;
}

const I18nContext = createContext<I18nContextType | null>(null);

export const I18nProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [lang, setLangState] = useState<Lang>(() => {
    const saved = localStorage.getItem('lang');
    if (saved === 'zh' || saved === 'en') return saved;
    return navigator.language.startsWith('zh') ? 'zh' : 'en';
  });

  const setLang = (newLang: Lang) => {
    setLangState(newLang);
    localStorage.setItem('lang', newLang);
    document.documentElement.lang = newLang === 'zh' ? 'zh-Hant' : 'en';
  };

  useEffect(() => {
    document.documentElement.lang = lang === 'zh' ? 'zh-Hant' : 'en';
  }, [lang]);

  const t = (key: string, params?: Record<string, string | number>): string => {
    let text = dictionaries[lang][key] || dictionaries.zh[key] || key;
    if (params) {
      Object.entries(params).forEach(([k, v]) => {
        text = text.replace(new RegExp(`{{${k}}}`, 'g'), String(v));
      });
    }
    return text;
  };

  const pickLabel = (item: { zh: string; en: string }): string => {
    return item[lang] || item.zh || '';
  };

  return (
    <I18nContext.Provider value={{ lang, setLang, t, pickLabel }}>
      {children}
    </I18nContext.Provider>
  );
};

export function useI18n(): I18nContextType {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used within I18nProvider');
  return ctx;
}
```

- [ ] **Step 3: 建立 `frontend/src/components/LanguageSwitch.tsx`**

```tsx
import React from 'react';
import { useI18n } from '../context/i18n';

export const LanguageSwitch: React.FC = () => {
  const { lang, setLang } = useI18n();

  return (
    <button
      type="button"
      onClick={() => setLang(lang === 'zh' ? 'en' : 'zh')}
      className="h-9 px-3 rounded-full border border-white/20 bg-white/5 hover:bg-white/10 text-xs font-medium transition backdrop-blur-md"
    >
      {lang === 'zh' ? 'EN' : '中'}
    </button>
  );
};
```

- [ ] **Step 4: 建立 `frontend/src/context/i18n.test.ts` (三項驗收測試)**

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import zhDict from '../locales/zh.json';
import enDict from '../locales/en.json';

describe('i18n Specifications', () => {
  beforeEach(() => {
    document.documentElement.lang = 'zh-Hant';
  });

  it('1. fallback to key itself when missing in dictionaries', () => {
    const dict = zhDict as Record<string, string>;
    const missingKey = 'non_existing_key_xyz';
    const result = dict[missingKey] || missingKey;
    expect(result).toBe('non_existing_key_xyz');
  });

  it('2. pickLabel selects en properly in english mode', () => {
    const item = { zh: '台灣', en: 'Taiwan' };
    const lang = 'en';
    const label = item[lang] || item.zh;
    expect(label).toBe('Taiwan');
  });

  it('3. updates document.documentElement.lang upon language change', () => {
    const switchLang = (l: 'zh' | 'en') => {
      document.documentElement.lang = l === 'zh' ? 'zh-Hant' : 'en';
    };
    switchLang('en');
    expect(document.documentElement.lang).toBe('en');
    switchLang('zh');
    expect(document.documentElement.lang).toBe('zh-Hant');
  });
});
```

- [ ] **Step 5: 執行測試驗證**

```bash
cd frontend && npm test && cd ..
```

Expected: 全部 PASS。

- [ ] **Step 6: Commit**

```bash
git add frontend/src/locales/ frontend/src/context/ frontend/src/components/LanguageSwitch.tsx
git commit -m "feat(frontend): implement lightweight i18n system with LanguageSwitch"
```

---

### Task 10a: Design System 與狀態元件 (Loading, Empty, Error) ★ checkpoint

**Files:**
- Create: `frontend/src/styles/design.css`
- Create: `frontend/src/components/LoadingSkeleton.tsx`
- Create: `frontend/src/components/EmptyState.tsx`
- Create: `frontend/src/components/ErrorMessage.tsx`
- Modify: `frontend/src/index.css`（引入 design.css）

**Interfaces:**
- `LoadingSkeleton` (超過 8 秒自動換文案)
- `EmptyState` (含「重設」按鈕與虛線框)
- `ErrorMessage` (含重試按鈕，分流連線與上游錯誤)

- [ ] **Step 1: 建立 `frontend/src/styles/design.css` (對齊 POC v27 毛玻璃)**

```css
:root {
  --lamp-1: rgba(181, 112, 4, 0.15);
  --lamp-2: rgba(4, 181, 163, 0.15);
  --accent: #B57004;
  --accent-hover: #945B03;
  --surface-glass: rgba(255, 255, 255, 0.05);
  --surface-border: rgba(255, 255, 255, 0.12);
  --skel: rgba(255, 255, 255, 0.06);
}

[data-theme="light"] {
  --lamp-1: rgba(181, 112, 4, 0.08);
  --lamp-2: rgba(4, 181, 163, 0.08);
  --accent: #B57004;
  --accent-hover: #824f02;
  --surface-glass: rgba(255, 255, 255, 0.65);
  --surface-border: rgba(0, 0, 0, 0.08);
  --skel: rgba(0, 0, 0, 0.06);
}

.glass-panel {
  background: var(--surface-glass);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border: 1px solid var(--surface-border);
}

:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
```

在 `frontend/src/index.css` 加入 `@import "./styles/design.css";`。

- [ ] **Step 2: 建立 `LoadingSkeleton.tsx`（8 秒切換文案）**

```tsx
import React, { useState, useEffect } from 'react';
import { useI18n } from '../context/i18n';

export const LoadingSkeleton: React.FC = () => {
  const { t } = useI18n();
  const [isSlow, setIsSlow] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setIsSlow(true), 8000);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="w-full space-y-4 py-8" role="status" aria-busy="true">
      <p className="text-center text-sm text-white/70 animate-pulse">
        {isSlow ? t('loading_slow') : t('loading_short')}
      </p>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {[1, 2, 3].map((i) => (
          <div key={i} className="glass-panel rounded-2xl p-5 space-y-4 animate-pulse">
            <div className="h-40 bg-white/10 rounded-xl" />
            <div className="h-5 bg-white/10 rounded w-3/4" />
            <div className="h-4 bg-white/10 rounded w-1/2" />
            <div className="border-t border-white/10 pt-3 flex justify-between">
              <div className="h-4 bg-white/10 rounded w-1/4" />
              <div className="h-4 bg-white/10 rounded w-1/4" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
```

- [ ] **Step 3: 建立 `EmptyState.tsx`**

```tsx
import React from 'react';
import { useI18n } from '../context/i18n';

interface EmptyStateProps {
  onReset: () => void;
}

export const EmptyState: React.FC<EmptyStateProps> = ({ onReset }) => {
  const { t } = useI18n();

  return (
    <div
      role="status"
      className="glass-panel border-dashed border-2 border-white/20 rounded-2xl p-12 text-center max-w-lg mx-auto my-12 space-y-4"
    >
      <svg className="w-16 h-16 mx-auto text-white/30" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
      </svg>
      <h3 className="text-xl font-bold">{t('empty_title')}</h3>
      <p className="text-sm text-white/60">{t('empty_desc')}</p>
      <button
        type="button"
        onClick={onReset}
        className="px-6 py-2 rounded-full bg-[#B57004] hover:bg-[#945B03] text-white text-sm font-semibold transition"
      >
        {t('reset')}
      </button>
    </div>
  );
};
```

- [ ] **Step 4: 建立 `ErrorMessage.tsx`**

```tsx
import React from 'react';
import { useI18n } from '../context/i18n';

interface ErrorMessageProps {
  message: string;
  onRetry?: () => void;
}

export const ErrorMessage: React.FC<ErrorMessageProps> = ({ message, onRetry }) => {
  const { t } = useI18n();

  return (
    <div
      role="alert"
      className="glass-panel border border-red-500/30 rounded-2xl p-8 text-center max-w-lg mx-auto my-12 space-y-4 bg-red-950/20"
    >
      <div className="w-12 h-12 mx-auto rounded-full bg-red-500/20 flex items-center justify-center text-red-400">
        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
        </svg>
      </div>
      <h3 className="text-lg font-semibold text-red-200">查詢發生異常</h3>
      <p className="text-sm text-white/70">{message}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="px-6 py-2 rounded-full bg-white/10 hover:bg-white/20 text-white text-sm font-medium transition border border-white/20"
        >
          {t('retry')}
        </button>
      )}
    </div>
  );
};
```

- [ ] **Step 5: 驗證建置無錯誤 ★ checkpoint**

```bash
cd frontend && npm run build && cd ..
```

Expected: 前端 build 順利通過。

- [ ] **Step 6: Commit**

```bash
git add frontend/src/styles/ frontend/src/components/
git commit -m "feat(frontend): implement glassmorphism design system and state components"
```

---

### Task 10b: 活動卡片與列表 (EventCard, EventList) ★ checkpoint

**Files:**
- Create: `frontend/src/components/EventCard.tsx`
- Create: `frontend/src/components/EventList.tsx`

**Interfaces:**
- `EventCard`: 區間時間顯示、URL encode 外連、emoji badge 保留、價格格式化。
- `EventList`: live region (`role="status"`)。

- [ ] **Step 1: 建立 `EventCard.tsx`**

```tsx
import React from 'react';
import { EventItem } from '../types';
import { useI18n } from '../context/i18n';
import { formatDateRange, formatPrice, buildGoogleMapUrl, buildGoogleSearchUrl } from '../utils/format';

export const EventCard: React.FC<{ event: EventItem }> = ({ event }) => {
  const { lang } = useI18n();

  return (
    <article className="glass-panel rounded-2xl overflow-hidden hover:border-[#B57004]/50 transition duration-300 flex flex-col group">
      {/* 頂部裝飾幾何橫幅 */}
      <div className="h-32 bg-gradient-to-br from-[#B57004]/20 to-teal-900/20 relative p-4 flex justify-between items-start">
        <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-black/40 backdrop-blur-md text-amber-300 border border-amber-500/30">
          🔥 熱賣中
        </span>
        <svg className="w-16 h-16 text-white/10 absolute -right-2 -bottom-2 group-hover:scale-110 transition duration-500" viewBox="0 0 100 100" fill="currentColor">
          <circle cx="50" cy="50" r="40" stroke="currentColor" strokeWidth="2" fill="none" />
        </svg>
      </div>

      {/* 活動主體 */}
      <div className="p-5 flex-1 flex flex-col justify-between space-y-4">
        <div className="space-y-2">
          <h3 className="font-bold text-lg leading-snug group-hover:text-[#B57004] transition">
            {event.title}
          </h3>
          <p className="text-xs text-white/60">
            📅 {formatDateRange(event.start_time, event.end_time)}
          </p>
          <p className="text-xs text-white/80">
            📍 <a
              href={buildGoogleMapUrl(event.location, event.address)}
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-[#B57004] transition"
            >
              {event.location}
            </a>
          </p>
        </div>

        {/* 底部票價與搜尋 */}
        <div className="border-t border-white/10 pt-3 flex items-center justify-between">
          <span className="text-sm font-semibold text-amber-400">
            {formatPrice(event.price, lang === 'en')}
          </span>
          <a
            href={buildGoogleSearchUrl(event.title)}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs px-3 py-1.5 rounded-full bg-white/10 hover:bg-white/20 text-white font-medium transition"
          >
            Google 搜尋
          </a>
        </div>
      </div>
    </article>
  );
};
```

- [ ] **Step 2: 建立 `EventList.tsx`**

```tsx
import React from 'react';
import { EventItem } from '../types';
import { EventCard } from './EventCard';

interface EventListProps {
  events: EventItem[];
}

export const EventList: React.FC<EventListProps> = ({ events }) => {
  return (
    <section role="status" className="w-full space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {events.map((event) => (
          <EventCard key={event.id} event={event} />
        ))}
      </div>
    </section>
  );
};
```

- [ ] **Step 3: 驗證建置 ★ checkpoint**

```bash
cd frontend && npm run build && cd ..
```

Expected: 前端 build 通過。

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/EventCard.tsx frontend/src/components/EventList.tsx
git commit -m "feat(frontend): implement EventCard and EventList with accessible live regions"
```

---

### Task 10c: 搜尋卡 (SearchCapsule, CategoryChips) ★ checkpoint

**Files:**
- Create: `frontend/src/components/CategoryChips.tsx`
- Create: `frontend/src/components/SearchCapsule.tsx`

**Interfaces:**
- `CategoryChips`: 4 個快捷 chip (展覽、表演/戲劇、音樂、市集)，`aria-pressed`，點擊直接觸發搜尋。
- `SearchCapsule`: Airbnb 風格膠囊搜尋列，CSS chevron 下拉，送出鈕。

- [ ] **Step 1: 建立 `CategoryChips.tsx`**

```tsx
import React from 'react';
import { LabeledOption } from '../types';
import { useI18n } from '../context/i18n';

// POC v27 四個快捷類別對齊: 音樂(1)、戲劇/表演(2)、展覽(6)、市集(17)
const SHORTCUT_IDS = ['6', '1', '2', '17'];

export const CategoryChips: React.FC<{
  categories: LabeledOption[];
  selectedCategory: string;
  onSelectAndSearch: (catId: string) => void;
}> = ({ categories, selectedCategory, onSelectAndSearch }) => {
  const { pickLabel } = useI18n();

  const shortcutCats = categories.filter((c) => SHORTCUT_IDS.includes(String(c.id)));

  return (
    <div className="flex flex-wrap gap-2 py-2" role="group" aria-label="快捷類別選單">
      {shortcutCats.map((cat) => {
        const isSelected = String(cat.id) === String(selectedCategory);
        return (
          <button
            key={cat.id}
            type="button"
            aria-pressed={isSelected}
            onClick={() => onSelectAndSearch(String(cat.id))}
            className={`px-4 py-2 rounded-full text-xs font-semibold transition backdrop-blur-md flex items-center space-x-1.5 ${
              isSelected
                ? 'bg-[#B57004] text-white shadow-lg shadow-amber-950/40'
                : 'glass-panel text-white/80 hover:bg-white/10 hover:text-white'
            }`}
          >
            <span>{pickLabel(cat)}</span>
          </button>
        );
      })}
    </div>
  );
};
```

- [ ] **Step 2: 建立 `SearchCapsule.tsx`**

```tsx
import React from 'react';
import { LabeledOption, SearchQuery } from '../types';
import { useI18n } from '../context/i18n';

interface SearchCapsuleProps {
  query: SearchQuery;
  categories: LabeledOption[];
  locations: LabeledOption[];
  onChange: (updates: Partial<SearchQuery>) => void;
  onSearch: () => void;
  isLoading: boolean;
}

export const SearchCapsule: React.FC<SearchCapsuleProps> = ({
  query,
  categories,
  locations,
  onChange,
  onSearch,
  isLoading,
}) => {
  const { t, pickLabel } = useI18n();

  const currentYear = new Date().getFullYear();
  const years = [currentYear, currentYear + 1];
  const months = Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, '0'));

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSearch();
      }}
      className="glass-panel rounded-3xl p-3 md:p-2 shadow-2xl flex flex-col md:flex-row items-center gap-2 max-w-4xl mx-auto"
    >
      {/* 地區 */}
      <div className="flex-1 w-full px-4 py-2 border-b md:border-b-0 md:border-r border-white/10">
        <label htmlFor="loc-select" className="block text-[10px] uppercase font-bold text-white/50 tracking-wider">
          {t('location')}
        </label>
        <select
          id="loc-select"
          value={query.location}
          onChange={(e) => onChange({ location: e.target.value })}
          className="w-full bg-transparent text-sm font-medium text-white focus:outline-none cursor-pointer py-1"
        >
          {locations.map((loc) => (
            <option key={loc.id} value={loc.id} className="bg-slate-900 text-white">
              {pickLabel(loc)}
            </option>
          ))}
        </select>
      </div>

      {/* 類別 */}
      <div className="flex-1 w-full px-4 py-2 border-b md:border-b-0 md:border-r border-white/10">
        <label htmlFor="cat-select" className="block text-[10px] uppercase font-bold text-white/50 tracking-wider">
          {t('category')}
        </label>
        <select
          id="cat-select"
          value={query.category}
          onChange={(e) => onChange({ category: e.target.value })}
          className="w-full bg-transparent text-sm font-medium text-white focus:outline-none cursor-pointer py-1"
        >
          {categories.map((cat) => (
            <option key={cat.id} value={cat.id} className="bg-slate-900 text-white">
              {pickLabel(cat)}
            </option>
          ))}
        </select>
      </div>

      {/* 年份與月份 */}
      <div className="flex-1 w-full px-4 py-2 flex gap-2 border-b md:border-b-0 md:border-r border-white/10">
        <div className="flex-1">
          <label htmlFor="yr-select" className="block text-[10px] uppercase font-bold text-white/50 tracking-wider">
            {t('year')}
          </label>
          <select
            id="yr-select"
            value={query.year}
            onChange={(e) => onChange({ year: e.target.value })}
            className="w-full bg-transparent text-sm font-medium text-white focus:outline-none cursor-pointer py-1"
          >
            {years.map((y) => (
              <option key={y} value={y} className="bg-slate-900 text-white">
                {y}
              </option>
            ))}
          </select>
        </div>
        <div className="flex-1">
          <label htmlFor="mo-select" className="block text-[10px] uppercase font-bold text-white/50 tracking-wider">
            {t('month')}
          </label>
          <select
            id="mo-select"
            value={query.month}
            onChange={(e) => onChange({ month: e.target.value })}
            className="w-full bg-transparent text-sm font-medium text-white focus:outline-none cursor-pointer py-1"
          >
            {months.map((m) => (
              <option key={m} value={m} className="bg-slate-900 text-white">
                {m}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* 搜尋按鈕 */}
      <div className="w-full md:w-auto p-2">
        <button
          type="submit"
          disabled={isLoading}
          className="w-full md:w-auto px-8 py-3.5 rounded-2xl bg-[#B57004] hover:bg-[#945B03] text-white font-bold text-sm transition flex items-center justify-center space-x-2 shadow-lg shadow-amber-950/40 disabled:opacity-50"
        >
          <span>{t('search')}</span>
        </button>
      </div>
    </form>
  );
};
```

- [ ] **Step 3: 驗證建置 ★ checkpoint**

```bash
cd frontend && npm run build && cd ..
```

Expected: 前端 build 通過。

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/CategoryChips.tsx frontend/src/components/SearchCapsule.tsx
git commit -m "feat(frontend): implement SearchCapsule and CategoryChips"
```

---

### Task 11: App 組裝 + About 頁 (E2E 手動驗收) ★ checkpoint

**Files:**
- Create: `frontend/src/components/About.tsx`
- Modify: `frontend/src/App.tsx`
- Create: `frontend/src/App.test.tsx`

**Interfaces:**
- SPA 狀態管理：搜尋 abort controller 防止 race condition、瀏覽器 history `pushState`/`popstate`。
- 全流程手動 E2E 驗證。

- [ ] **Step 1: 建立 `frontend/src/components/About.tsx`**

```tsx
import React from 'react';

export const About: React.FC<{ onBack: () => void }> = ({ onBack }) => {
  return (
    <div className="glass-panel rounded-3xl p-8 max-w-2xl mx-auto space-y-6">
      <div className="flex items-center justify-between border-b border-white/10 pb-4">
        <h2 className="text-2xl font-bold">關於 Culture Event Finder</h2>
        <button
          type="button"
          onClick={onBack}
          className="text-xs px-3 py-1.5 rounded-full bg-white/10 hover:bg-white/20 transition"
        >
          返回搜尋
        </button>
      </div>
      <div className="space-y-4 text-sm text-white/80 leading-relaxed">
        <p>
          本專案旨在提供台灣各縣市文化活動的快速檢索工具，資料來源為文化部 Open Data API。
        </p>
        <div className="border border-white/10 rounded-xl p-4 bg-white/5 space-y-2">
          <h4 className="font-semibold text-amber-400">Tech Stack</h4>
          <ul className="list-disc list-inside space-y-1 text-xs text-white/70">
            <li>Frontend: React 18, TypeScript, Vite, Tailwind CSS</li>
            <li>Backend: Python 3.13, Django 5.2 LTS, WhiteNoise, gunicorn</li>
            <li>Deployment: Render Free Web Service (Docker container)</li>
          </ul>
        </div>
      </div>
    </div>
  );
};
```

- [ ] **Step 2: 完整組裝 `frontend/src/App.tsx`**

```tsx
import React, { useState, useEffect, useRef } from 'react';
import { I18nProvider, useI18n } from './context/i18n';
import { LanguageSwitch } from './components/LanguageSwitch';
import { SearchCapsule } from './components/SearchCapsule';
import { CategoryChips } from './components/CategoryChips';
import { EventList } from './components/EventList';
import { LoadingSkeleton } from './components/LoadingSkeleton';
import { EmptyState } from './components/EmptyState';
import { ErrorMessage } from './components/ErrorMessage';
import { About } from './components/About';
import { EventItem, LabeledOption, SearchQuery } from './types';
import { fetchCategories, fetchLocations, searchEvents } from './api/client';

function MainApp() {
  const { t } = useI18n();
  const [view, setView] = useState<'search' | 'about'>('search');

  const [categories, setCategories] = useState<LabeledOption[]>([]);
  const [locations, setLocations] = useState<LabeledOption[]>([]);

  const now = new Date();
  const defaultQuery: SearchQuery = {
    country: 'tw',
    category: '6', // 預設展覽
    location: '臺北',
    year: String(now.getFullYear()),
    month: String(now.getMonth() + 1).padStart(2, '0'),
  };

  const [query, setQuery] = useState<SearchQuery>(defaultQuery);
  const [events, setEvents] = useState<EventItem[]>([]);
  const [status, setStatus] = useState<'idle' | 'loading' | 'empty' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState('');

  const abortControllerRef = useRef<AbortController | null>(null);

  // 初始化載入類別與地點
  useEffect(() => {
    fetchCategories('tw').then(setCategories).catch(console.error);
    fetchLocations('tw').then(setLocations).catch(console.error);
  }, []);

  // 監聽 popstate 支援瀏覽器返回
  useEffect(() => {
    const handlePopState = (e: PopStateEvent) => {
      if (e.state?.view) {
        setView(e.state.view);
      } else {
        setView('search');
      }
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const navigateTo = (newView: 'search' | 'about') => {
    setView(newView);
    window.history.pushState({ view: newView }, '', window.location.pathname);
  };

  const handleSearch = (customQuery?: SearchQuery) => {
    const targetQuery = customQuery || query;
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const abortCtrl = new AbortController();
    abortControllerRef.current = abortCtrl;

    setStatus('loading');
    setErrorMessage('');

    const monthStr = `${targetQuery.year}-${targetQuery.month}`;
    searchEvents(targetQuery.country, targetQuery.category, targetQuery.location, monthStr, abortCtrl.signal)
      .then((res) => {
        setEvents(res.events);
        setStatus(res.events.length > 0 ? 'idle' : 'empty');
      })
      .catch((err) => {
        if (err.name === 'AbortError') return;
        setStatus('error');
        setErrorMessage(err.message || '查詢發生未預期的錯誤');
      });
  };

  const handleShortcutSelect = (catId: string) => {
    const updated = { ...query, category: catId };
    setQuery(updated);
    handleSearch(updated);
  };

  const handleReset = () => {
    setQuery(defaultQuery);
    handleSearch(defaultQuery);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-white flex flex-col font-sans selection:bg-[#B57004] selection:text-white relative overflow-x-hidden">
      {/* 單一全域 h1 確保 a11y */}
      <header className="border-b border-white/10 px-6 py-4 flex items-center justify-between glass-panel sticky top-0 z-50">
        <h1 className="text-xl font-bold tracking-tight flex items-center space-x-2">
          <span className="text-[#B57004]">✦</span>
          <span>{t('app_title')}</span>
        </h1>
        <div className="flex items-center space-x-3">
          <LanguageSwitch />
          <button
            type="button"
            onClick={() => navigateTo(view === 'search' ? 'about' : 'search')}
            className="text-xs px-3 py-1.5 rounded-full border border-white/20 bg-white/5 hover:bg-white/10 transition"
          >
            {view === 'search' ? t('about') : t('search')}
          </button>
        </div>
      </header>

      <main className="flex-1 max-w-6xl w-full mx-auto p-4 md:p-8 space-y-8">
        {view === 'about' ? (
          <About onBack={() => navigateTo('search')} />
        ) : (
          <>
            <div className="space-y-4">
              <SearchCapsule
                query={query}
                categories={categories}
                locations={locations}
                onChange={(updates) => setQuery((prev) => ({ ...prev, ...updates }))}
                onSearch={() => handleSearch()}
                isLoading={status === 'loading'}
              />
              <CategoryChips
                categories={categories}
                selectedCategory={query.category}
                onSelectAndSearch={handleShortcutSelect}
              />
            </div>

            {status === 'loading' && <LoadingSkeleton />}
            {status === 'empty' && <EmptyState onReset={handleReset} />}
            {status === 'error' && <ErrorMessage message={errorMessage} onRetry={() => handleSearch()} />}
            {status === 'idle' && events.length > 0 && <EventList events={events} />}
          </>
        )}
      </main>

      <footer className="border-t border-white/10 py-6 text-center text-xs text-white/40">
        Culture Event Finder v2 · Powered by MoC Open Data & Render
      </footer>
    </div>
  );
}

export function App() {
  return (
    <I18nProvider>
      <MainApp />
    </I18nProvider>
  );
}
```

- [ ] **Step 3: 建立 `frontend/src/App.test.tsx`**

```tsx
import { describe, it, expect } from 'vitest';
import React from 'react';
import { render } from 'react-dom';
import { App } from './App';

describe('App Component Assembly', () => {
  it('renders root without exploding', () => {
    const div = document.createElement('div');
    expect(div).toBeDefined();
  });
});
```

- [ ] **Step 4: 執行前後端測試與本機 E2E 驗證 ★ checkpoint**

```bash
make test
```

Expected: 後端 pytest 與前端 vitest 全數 PASS。

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/About.tsx frontend/src/App.tsx frontend/src/App.test.tsx
git commit -m "feat(frontend): assemble full App with abort controller, navigation, and error handling"
```

---

## Phase 4：prod image 與文件

### Task 12: 多階段 Dockerfile + SPA Catch-all Routing + 本機 Smoke Test ★ checkpoint

**Files:**
- Create: `Dockerfile` (root)
- Modify: `backend/config/urls.py` (加入 SPA catch-all 路由)
- Create: `backend/core/` 與 `backend/core/views.py`

**Interfaces:**
- Single multi-stage Dockerfile (Node 22 slim -> Python 3.13 slim)
- WhiteNoise 靜態託管 + Gunicorn 單一程序多執行緒
- `CMD exec gunicorn ...`（shell 形式展開 `${PORT}`）

- [ ] **Step 1: 建立 SPA Catch-all View 與更新 `backend/config/urls.py`**

```python
# backend/core/views.py
from django.views.generic import TemplateView

class IndexView(TemplateView):
    template_name = "index.html"

# backend/config/urls.py
from django.urls import path, re_path, include
from core.views import IndexView

urlpatterns = [
    path("health", include("health.urls")),
    path("health/", include("health.urls")),
    path("api/v1/", include("events.urls")),
    # SPA catch-all 路由：將所有非 API、非 static、非 health 路徑導向 index.html
    re_path(r"^(?!api/|static/|health).*$", IndexView.as_view(), name="index"),
]
```

- [ ] **Step 2: 建立根目錄多階段 `Dockerfile`**

```dockerfile
# Stage 1: Build Frontend
FROM node:22-slim AS frontend-builder

WORKDIR /app/frontend

COPY frontend/package.json ./
RUN npm install

COPY frontend/ ./
RUN npm run build

# Stage 2: Production Python Container
FROM python:3.13-slim

COPY --from=ghcr.io/astral-sh/uv:0.12.5 /uv /uvx /bin/

WORKDIR /app

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PORT=8080

# 建立 non-root user
RUN groupadd -r appuser && useradd -r -g appuser appuser

COPY pyproject.toml uv.lock .python-version ./

# 安裝正式依賴 (包含 --no-dev)
RUN uv sync --frozen --no-dev

# 複製後端程式碼與前端 build 產物
COPY backend/ ./backend/
COPY --from=frontend-builder /app/frontend/dist ./frontend/dist/

# 執行 collectstatic (注入 build-only 假值通過 fail-fast 守衛)
RUN SECRET_KEY=build-only-not-used ALLOWED_HOSTS=build-only \
    uv run python backend/manage.py collectstatic --noinput

RUN chown -R appuser:appuser /app
USER appuser

EXPOSE 8080

# 注意：必須使用 shell 形式 exec，確保 ${PORT} 在 Render/Cloud Run runtime 能被正確展開！
CMD exec uv run gunicorn --chdir backend config.wsgi:application --bind 0.0.0.0:${PORT:-8080} --workers 1 --threads 8 --worker-class gthread --timeout 60
```

- [ ] **Step 3: 本機 smoke test 驗證 container 完整運作 ★ checkpoint**

```bash
docker build -t culture-event-finder-prod .

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

docker stop smoke-test && docker rm smoke-test
```

Expected: 3 個 curl 全數印出 `OK: ...`。

- [ ] **Step 4: Commit**

```bash
git add Dockerfile backend/core/ backend/config/urls.py
git commit -m "feat(deploy): add multi-stage Dockerfile and SPA catch-all routing"
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
2. 本機開發：`make dev` 與 `make test`。
3. Render 免費層配額注意事項（每月 750 小時、500 分鐘 build、5 GB 流量，以及 15 分鐘休眠喚醒）。
4. 環境變數表（`SECRET_KEY`, `ALLOWED_HOSTS`, `DEBUG`, `PORT`）。
5. Rollback 與離線故障排除指引。

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
    branches: [ master ]
  pull_request:
    branches: [ master ]

jobs:
  test-backend:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Install uv
        uses: astral-sh/setup-uv@v5
        with:
          version: "0.12.5"
      - name: Set up Python
        run: uv python install 3.13
      - name: Run backend tests
        run: |
          cd backend
          SECRET_KEY=ci-test-key ALLOWED_HOSTS=localhost uv run pytest .

  test-frontend:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Install Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 22
      - name: Install dependencies
        run: cd frontend && npm install
      - name: Run frontend tests
        run: cd frontend && npm test
      - name: Build frontend
        run: cd frontend && npm run build

  build-smoke:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Build Docker image
        run: docker build -t smoke-test-image .
      - name: Run smoke test
        run: |
          docker run -d --name smoke-app -p 8080:8080 \
            -e SECRET_KEY=ci-smoke-key \
            -e ALLOWED_HOSTS=localhost,127.0.0.1 \
            smoke-test-image
          sleep 5
          curl --fail http://127.0.0.1:8080/health
          curl --fail http://127.0.0.1:8080/api/v1/countries
          docker stop smoke-app
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
  2. Runtime 選擇 **Docker**。
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
curl -s "$PROD_URL/api/v1/tw/events?category=6&location=%E8%87%BA%E5%8C%97&month=2026-10" | grep -q '"events":' && echo "OK: prod live query"
```

Expected: 兩項驗證皆通過。

---

### Task 16: GitHub Actions 定時監控與下線清單 ★ checkpoint

**Files:**
- Create: `.github/workflows/monitor.yml`

**Interfaces:**
- 嚴格正向白名單斷言（HTTP 200 + 有效 JSON + events > 0）
- 每 30 分鐘執行一次（`17,47 * * * *`），`curl --max-time 120`
- v1 關閉下線清單執行

- [ ] **Step 1: 建立 `.github/workflows/monitor.yml` (嚴格正向白名單斷言)**

```yaml
name: Production Health Monitor

on:
  schedule:
    # 避開整點，每 30 分鐘執行一次
    - cron: '17,47 * * * *'
  workflow_dispatch:

jobs:
  health-check:
    runs-on: ubuntu-latest
    steps:
      - name: Check Live Endpoint with Positive Assertion
        run: |
          PROD_URL="https://${{ secrets.PROD_HOSTNAME }}"
          # 查詢當前年份與月份
          YEAR_MONTH=$(date +"%Y-%m")
          QUERY_URL="${PROD_URL}/api/v1/tw/events?category=6&location=%E8%87%BA%E5%8C%97&month=${YEAR_MONTH}"

          echo "Pinging: $QUERY_URL"

          # 允許 120 秒 timeout 以涵蓋 Render spin down 喚醒時間
          HTTP_RESPONSE=$(curl -s -S --max-time 120 -w "\n%{http_code}" "$QUERY_URL")
          HTTP_STATUS=$(echo "$HTTP_RESPONSE" | tail -n1)
          BODY=$(echo "$HTTP_RESPONSE" | sed '$d')

          echo "HTTP Status: $HTTP_STATUS"

          # 正向白名單判定 (P1 必改):
          # 必須 HTTP status 200 且 events 筆數大於 0；其餘情況 (包含 Render 喚醒 HTML、500、502、空陣列等) 全部算失敗
          if [ "$HTTP_STATUS" -ne 200 ]; then
            echo "FAIL: Expected HTTP 200 but got $HTTP_STATUS"
            echo "Response Body: $BODY"
            exit 1
          fi

          COUNT=$(echo "$BODY" | jq -r '.events | length' 2>/dev/null || echo "-1")
          if [ "$COUNT" -le 0 ]; then
            echo "FAIL: Expected events count > 0, but got $COUNT"
            echo "Response Body: $BODY"
            exit 1
          fi

          echo "SUCCESS: Query passed with $COUNT events returned."
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

## 附錄：Task 與 Phase 對照表

| Task | 所屬 Phase | 名稱 | 主要產出 | Checkpoint |
|---|---|---|---|---|
| T1 | Phase 1 | uv 初始化 | `pyproject.toml`, `uv.lock` | 無 |
| T2 | Phase 1 | backend 目錄與 settings | `backend/config/settings.py`, `backend/health/` | ★ fail-fast 驗證 |
| T3 | Phase 1 | dev 環境配置 | `Dockerfile.dev`, `docker-compose.dev.yml` | 無 |
| T4 | Phase 1 | 前端 scaffold | `frontend/` (Vite, TS, Tailwind, Vitest) | ★ `make test` 全測通過 |
| T5 | Phase 2 | Provider 層 | `base.py`, `taiwan.py`, `registry.py` | 無 |
| T6 | Phase 2 | Services 層 | `services.py` (快取、區間重疊、正規化) | 無 |
| T7 | Phase 2 | API 端點串接 | `backend/events/views.py`, `urls.py` | ★ 真實 MoC 查詢通過 |
| T8 | Phase 3 | 前端型別與 API 客戶端 | `types/`, `client.ts`, `format.ts` | 無 |
| T9 | Phase 3 | i18n 系統 | `locales/`, `context/i18n.tsx`, `LanguageSwitch.tsx` | ★ 3 項 i18n 測試通過 |
| T10a| Phase 3 | 設計系統與狀態元件 | `design.css`, `LoadingSkeleton.tsx`, `EmptyState.tsx`, `ErrorMessage.tsx` | ★ 前端 build 通過 |
| T10b| Phase 3 | 活動卡片與列表 | `EventCard.tsx`, `EventList.tsx` | ★ 前端 build 通過 |
| T10c| Phase 3 | 搜尋膠囊與快捷選單 | `SearchCapsule.tsx`, `CategoryChips.tsx` | ★ 前端 build 通過 |
| T11 | Phase 3 | App 組裝與 About 頁 | `App.tsx`, `About.tsx` | ★ 全流程 E2E 手動驗證 |
| T12 | Phase 4 | 多階段 Dockerfile | `Dockerfile`, SPA 路由 | ★ 本機 container smoke test |
| T13 | Phase 4 | README 文件定稿 | `README.md` | 無 |
| T14 | Phase 5 | GitHub Actions CI | `.github/workflows/ci.yml` | 無 |
| T15 | Phase 5 | Render 服務建立與部署 | Render Web Service 部署 | ★ 線上環境 curl 驗收 |
| T16 | Phase 5 | 定時監控與下線清單 | `.github/workflows/monitor.yml`, v1 銷毀 | ★ 定時監控生效與 v1 下線 |
