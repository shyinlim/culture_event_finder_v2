# Culture Event Finder Refactor：Implementation Plan v9

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** `docs/superpowers/specs/2026-10-06-culture-event-finder-design-v9.md`
**Roadmap:** `docs/roadmaps/2026-10-06-roadmap-v9.md`

> ⚠️ **本文件自足。執行時不需開啟舊 plan 或舊 spec。**
> `2026-10-04-...-plan-v8.md` 以前全部標記 SUPERSEDED。

**Goal:** 收尾 Phase 5：所有 CLI 收進 Makefile、CI 改成每個 branch 都跑且只呼叫 make、`SECRET_KEY` 改選填，然後上 Render 並加定時監控。

**Architecture:** Makefile 是唯一的指令入口，`ci.yml` 與 `monitor.yml` 只放 `uses:` action 與 `make <target>`。本機跑 `make run-prod && make smoke-prod` 與 CI 跑的是同一份指令。`SECRET_KEY` 沒設時由 settings 開機隨機產生。

**Tech Stack:** Django 5.2 LTS、uv、pytest + pytest-django；Vite + React + TS + Vitest；Docker multi-stage；GNU Make；GitHub Actions；Render free web service。

---

## Global Constraints

- **Python 3.13、Django 5.2 LTS。** 依賴管理單一來源是 uv（`pyproject.toml` + `uv.lock`）。
- **所有 CLI 指令都寫在 Makefile。** workflow 的 `run:` 只能是 `make <target>`，其餘步驟只能是 `uses:`；README 只寫 make 指令。開發者自己打的 `git`、`gh` 不在範圍內。
- **CI 觸發是 `on: push`，不限 branch，不加 `pull_request`。**
- **新工作開 branch 開發，CI 綠燈後合回 master。** master 的 push 觸發 Render 部署。
- **`SECRET_KEY` 選填：** `SECRET_KEY = os.environ.get("SECRET_KEY") or get_random_secret_key()`。任何環境（Makefile、CI、Dockerfile、Render）都不設它。
- **`ALLOWED_HOSTS` 仍是 prod 必填**，build 期 collectstatic 只注入 `ALLOWED_HOSTS=build-only`。
- **所有部署檔案放 `deployment/`。** build context 一律是 repo root：`docker build -f deployment/prod/Dockerfile .`。
- **prod port 8791；dev backend 8789、frontend 8790。** prod container 名稱 `culture-event-prod`，image 名稱 `culture-event-finder-prod`。
- **監控：** 每 30 分鐘 `make monitor-prod`，`curl --max-time 90`，`jq -e '.events | length > 0'`，月份用 `TZ=Asia/Taipei`。

## Review Focus

1. **非 master branch 的 push 要觸發 CI。** 這是這次改版的起因，Task 15 Step 6 用 feature branch 實際 push 驗證。
2. **`SECRET_KEY` 被設成空字串時**（例如有人在 Render 加了變數但沒填值），要跟沒設一樣拿到隨機 key，不是空 key。Task 16 的 `test_empty_secret_key_falls_back_to_random` 釘住。
3. **container 起不來時 smoke 要失敗而且看得到原因。** `make smoke-prod` 等 30 秒後照樣打 curl，curl 失敗讓 make 失敗；CI 以 `if: failure()` 跑 `make logs-prod`。Task 15 Step 4 驗證沒有 container 時 `make smoke-prod` 回非 0。
4. **Render 冷啟動不能被當成故障。** free instance 喚醒約一分鐘，`monitor-prod` 用 `--max-time 90`。
5. **月初跨時區。** GitHub runner 是 UTC，台灣每月 1 號 00:00 到 08:00 用 UTC 算會拿到上個月。`monitor-prod` 用 `TZ=Asia/Taipei date +%Y-%m`，Task 18 Step 2 驗證。

---

## Phase 0 ~ Phase 4 ✅（Task 1 ~ Task 14 已完成）

- [x] **Phase 0**：spec、POC v28、plan、roadmap 定稿（v9 於 2026-10-06 改版）
- [x] **Task 1 ~ 4**：uv、settings 骨架、dev 環境、前端 scaffold（commit `c2fa6fd` ~ `4127ea6`）
- [x] **Task 5 ~ 7**：provider、services、API endpoints（commit `d3d1aa1` ~ `f749a18`）
- [x] **Task 8 ~ 11**：前端型別、i18n、元件、App 組裝（commit `f07a2de` ~ `8708bb8`）
- [x] **Task 12**：(title, location) 聚合與多場次 Modal
- [x] **Task 13**：prod multi-stage Dockerfile + SPA catch-all（commit `c5ae9c4`）
- [x] **Task 14**：README（commit `4aa6e6d`、`59ee17f`）

v8 的 Task 15（CI，commit `6d61ea8`）由本版 Task 15 重寫；Task 16 是新增的 `SECRET_KEY` 選填；原 Task 16、17 順延為 Task 17、18。

---

## Phase 5：收尾、上 Render 與監控（Task 15 ~ Task 18）

### Task 15: 所有 CLI 收進 Makefile，CI 改成每個 branch 都跑

**Files:**
- Modify: `Makefile`
- Modify: `.github/workflows/ci.yml`（整份重寫）
- Modify: `README.md`、`readme/README.zh-tw.md`（本機 prod 段落加 `make smoke-prod`）

**Interfaces:**
- Consumes: 現有 `run-prod`（此時仍帶 `-e SECRET_KEY=local-prod-test-key`，Task 16 才拿掉）
- Produces: Make targets `smoke-prod`、`logs-prod`；`test-backend` 帶 `--frozen`。Task 16 用 `make run-prod && make smoke-prod` 驗證；Task 18 的 `monitor-prod` 加在同一份 Makefile。

- [ ] **Step 0: 開 branch 並 commit v9 文件**

```bash
git switch -c chore/v9-makefile-ci-secret-key
git add docs/
git commit -m "docs: add spec v9, plan v9, roadmap v9"
```

- [ ] **Step 1: 改 Makefile**

`.PHONY` 那行換成：

```makefile
.PHONY: run-dev stop-dev install-host test test-backend test-frontend build-prod run-prod smoke-prod logs-prod stop-prod prune
```

`test-backend` 加 `--frozen`（CI 原本就有，搬進來後本機與 CI 一致：照 `uv.lock` 跑，不偷偷更新 lock）：

```makefile
test-backend:
	cd backend && DEBUG=True uv run --frozen pytest .
```

刪掉 `build-prod` 上方過期的註解 `# Production Dockerfile is created in Task 12; failure before Task 12 is expected.`。

在 `stop-prod` 之前加兩個 target（內容從原本 `ci.yml` 的 smoke 步驟搬過來）：

```makefile
# Wait up to 30s for /health, then check 4 endpoints. Any failed curl fails make.
smoke-prod:
	@for i in $$(seq 30); do curl -sf http://127.0.0.1:8791/health > /dev/null && break; sleep 1; done
	curl -sf http://127.0.0.1:8791/health
	curl -sf http://127.0.0.1:8791/health/
	curl -sf http://127.0.0.1:8791/ | grep -q "root"
	curl -sf http://127.0.0.1:8791/api/v1/countries | grep -q "Taiwan"
	@echo ""
	@echo "Smoke tests passed."

logs-prod:
	docker logs culture-event-prod
```

- [ ] **Step 2: 重寫 `.github/workflows/ci.yml`**

```yaml
name: CI Pipeline

# Every push on every branch. No pull_request trigger: PRs come from this repo's
# branches, so the push run already covers them.
on: push

# All shell commands live in the Makefile. Steps here are `uses:` or `make <target>` only.
jobs:
  test-backend:
    name: Backend Tests (pytest)
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: astral-sh/setup-uv@v5
        with:
          enable-cache: true
      - run: make test-backend

  test-frontend:
    name: Frontend Tests (vitest)
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
          cache-dependency-path: frontend/package-lock.json
      - run: make install-host
      - run: make test-frontend

  build-smoke:
    name: Production Image Smoke Test
    runs-on: ubuntu-latest
    needs: [test-backend, test-frontend]
    steps:
      - uses: actions/checkout@v4
      - run: make run-prod
      - run: make smoke-prod
      - if: failure()
        run: make logs-prod
```

不寫 cleanup 步驟：runner 跑完整台丟掉。`npm test` 本身就是 `vitest run`，不會卡在 watch mode。

- [ ] **Step 3: 本機跑一次正向 smoke**

Run: `make run-prod && make smoke-prod`
Expected: 最後一行 `Smoke tests passed.`

- [ ] **Step 4: 本機跑一次反向 smoke（沒有 container 時一定要失敗）**

Run: `make stop-prod; make smoke-prod; echo "exit=$?"`
Expected: 約 30 秒後 curl 失敗，最後一行 `exit=2`（非 0 即可）。

- [ ] **Step 5: README 加 smoke 指令**

`README.md` 的「2. Production Container Simulation (Prod)」code block 換成：

```bash
make run-prod
make smoke-prod   # same checks CI runs
```

`readme/README.zh-tw.md` 對應段落：

```bash
make run-prod
make smoke-prod   # 跟 CI 跑的檢查一樣
```

- [ ] **Step 6: Commit 並在 branch 上驗證 CI**

```bash
git add Makefile .github/workflows/ci.yml README.md readme/README.zh-tw.md
git commit -m "ci: run on every branch push and route all commands through Makefile"
git push -u origin chore/v9-makefile-ci-secret-key
gh run watch
```

Expected: 這個非 master branch 觸發了 CI，三個 job 全綠。`test-backend` 若在 Python 安裝階段失敗，代表 `uv run` 沒有依 `.python-version` 自動取得 3.13：在 `setup-uv` 的 `with:` 加 `python-version: "3.13"`（仍是 `uses:` 設定，不違反 CLI 規則）後重推。

---

### Task 16: `SECRET_KEY` 改選填 ★ checkpoint

**Files:**
- Create: `backend/config/tests.py`
- Modify: `backend/config/settings.py:1-20`
- Modify: `Makefile`（`run-prod` 拿掉 `-e SECRET_KEY=...`）
- Modify: `deployment/prod/Dockerfile:32-33`
- Modify: `README.md`、`readme/README.zh-tw.md`（環境變數表與 Render 步驟）

**Interfaces:**
- Consumes: Task 15 的 `make smoke-prod`
- Produces: `settings.SECRET_KEY` 永遠是非空字串；env var `SECRET_KEY` 有值時用它，沒有或為空字串時開機隨機產生。之後任何地方都不再傳 `SECRET_KEY`。

- [ ] **Step 1: 寫 failing test**

settings 是 import 時就執行的 module，在同一個 process 裡改 env 不會重跑它，所以用 subprocess 起乾淨的 Python 讀 `settings.SECRET_KEY`。

建立 `backend/config/tests.py`：

```python
import os
import subprocess
import sys
from pathlib import Path

from django.test import SimpleTestCase

BACKEND_DIR = Path(__file__).resolve().parent.parent
PRINT_SECRET_KEY = (
    "import django; django.setup(); "
    "from django.conf import settings; print(settings.SECRET_KEY)"
)


def load_secret_key(**env):
    """Start a fresh prod-mode Django process and return its SECRET_KEY."""
    clean_env = {k: v for k, v in os.environ.items() if k not in ("SECRET_KEY", "DEBUG")}
    clean_env.update(DJANGO_SETTINGS_MODULE="config.settings", ALLOWED_HOSTS="testserver", **env)
    result = subprocess.run(
        [sys.executable, "-c", PRINT_SECRET_KEY],
        cwd=BACKEND_DIR,
        env=clean_env,
        capture_output=True,
        text=True,
        check=True,
    )
    # The logger may print to stdout first; the key is always the last line.
    return result.stdout.strip().splitlines()[-1]


class SecretKeyTests(SimpleTestCase):
    def test_missing_secret_key_uses_random_key_per_start(self):
        first, second = load_secret_key(), load_secret_key()
        self.assertGreaterEqual(len(first), 50)
        self.assertNotEqual(first, second)

    def test_empty_secret_key_falls_back_to_random(self):
        self.assertGreaterEqual(len(load_secret_key(SECRET_KEY="")), 50)

    def test_secret_key_from_env_is_used(self):
        self.assertEqual(load_secret_key(SECRET_KEY="from-env"), "from-env")
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `make test-backend`
Expected: `test_missing_secret_key_uses_random_key_per_start` 與 `test_empty_secret_key_falls_back_to_random` FAIL，`CalledProcessError`，stderr 含 `SECRET_KEY environment variable is required in production.`。`test_secret_key_from_env_is_used` PASS。

- [ ] **Step 3: 改 settings**

`backend/config/settings.py`：import 區加一行，第 14 ~ 20 行的整段 `# 2. SECRET_KEY fail-fast guard` 換成下面三行。

```python
from django.core.management.utils import get_random_secret_key
```

```python
# 2. SECRET_KEY: optional. Nothing reads it today (no sessions/auth/messages), so a random
# per-boot key is safe. Set a fixed key on Render once sessions or auth are added.
SECRET_KEY = os.environ.get("SECRET_KEY") or get_random_secret_key()
```

- [ ] **Step 4: 跑測試確認通過**

Run: `make test-backend`
Expected: 全部 PASS（含原有 health、events 測試）。

- [ ] **Step 5: 拿掉其他地方的 `SECRET_KEY`**

`Makefile` 的 `run-prod` 第二行：

```makefile
	docker run -d --rm --name culture-event-prod -p 8791:8791 -e ALLOWED_HOSTS=localhost,127.0.0.1,0.0.0.0 culture-event-finder-prod
```

`deployment/prod/Dockerfile` 的 collectstatic：

```dockerfile
RUN ALLOWED_HOSTS=build-only python backend/manage.py collectstatic --noinput
```

`README.md` 環境變數表的 `SECRET_KEY` 列：

```markdown
| `SECRET_KEY` | Optional | Django signing key. Nothing reads it today; when unset, a random key is generated on each start. Set a fixed key once sessions or auth are added. | (unset) |
```

`README.md` 的 Render Deployment Guide 第 4 步：

```markdown
4. Set the Environment Variable:
   - `ALLOWED_HOSTS`: Set to your Render domain (e.g. `culture-event-finder-v2.onrender.com`).
```

`readme/README.zh-tw.md` 對應兩處：

```markdown
| `SECRET_KEY` | 選填 | Django 簽章用的 key。目前沒有功能讀它，未設定時每次啟動隨機產生。日後加了 sessions 或登入功能再設固定值。 | （不設） |
```

```markdown
4. 設定環境變數：
   - `ALLOWED_HOSTS`：填入 Render 分配的域名（例如 `culture-event-finder-v2.onrender.com`）。
```

- [ ] **Step 6: 確認沒有殘留**

Run: `git grep -n "SECRET_KEY" -- ':!docs/'`
Expected: 只剩 `backend/config/settings.py`、`backend/config/tests.py`、兩份 README 的說明列。

- [ ] **Step 7: prod image 不帶 SECRET_KEY 也能起來**

Run: `make run-prod && make smoke-prod && make stop-prod`
Expected: `Smoke tests passed.`

- [ ] **Step 8: Commit、推 branch、合回 master ★ checkpoint**

```bash
git add backend/config/ Makefile deployment/prod/Dockerfile README.md readme/README.zh-tw.md
git commit -m "feat(settings): make SECRET_KEY optional with random per-boot fallback"
git push
gh run watch
gh pr create --fill --base master
gh pr merge --merge --delete-branch
git switch master && git pull
gh run list --branch master --limit 1
```

Expected: branch 上的 CI 全綠；合回 master 後 master 的 CI 也全綠。

---

### Task 17: Render Web Service 部署與驗證 ★ checkpoint

Dashboard 操作，沒有 code 改動。

- [ ] **Step 1: Render Dashboard 建立 Web Service**：Region Singapore、Runtime Docker、Dockerfile Path `deployment/prod/Dockerfile`、Docker Build Context Directory 留空、Health Check Path `/health`、Instance Free、Auto-Deploy「After CI Checks Pass」branch `master`。
- [ ] **Step 2: 設定環境變數**：只設 `ALLOWED_HOSTS` = Render 分配的網域（不含 `https://`）。**不設 `SECRET_KEY`。**
- [ ] **Step 3: 設 GitHub repo variable `PROD_URL`**：GitHub repo → Settings → Secrets and variables → Actions → Variables → New repository variable，Name `PROD_URL`，Value `https://<Step 2 的網域>`（結尾不加 `/`）。
- [ ] **Step 4: 首次部署與線上驗證 ★ checkpoint**：瀏覽器開 Render 網址，首頁出現；`<網址>/health` 顯示 `{"status": "ok"}`；搜尋「臺北 · 展覽 · 當月」有結果。指令層的線上驗證由 Task 18 的 `make monitor-prod PROD_URL=...` 負責。

---

### Task 18: 定時監控與 v1 下線清單 ★ checkpoint

**Files:**
- Modify: `Makefile`（加 `PROD_URL` 與 `monitor-prod`）
- Create: `.github/workflows/monitor.yml`

**Interfaces:**
- Consumes: Task 17 Step 3 的 repo variable `PROD_URL`
- Produces: `make monitor-prod [PROD_URL=...]`，成功 exit 0；`events` 為空、HTTP 非 2xx、timeout 都 exit 非 0。

- [ ] **Step 0: 開 branch**

```bash
git switch -c chore/monitor
```

- [ ] **Step 1: Makefile 加 `monitor-prod`**

`.PHONY` 那行尾端加 `monitor-prod`。在 `COMPOSE = ...` 下方加：

```makefile
# Local `make run-prod` by default; monitor.yml passes the Render URL.
PROD_URL ?= http://localhost:8791
```

在 `logs-prod` 之後加：

```makefile
# Real search through MoC. Month uses Taiwan time: GitHub runners are UTC.
# --max-time 90: Render free cold start takes about a minute.
monitor-prod:
	curl -sf --max-time 90 "$(PROD_URL)/api/v1/tw/events?category=6&location=%E8%87%BA%E5%8C%97&month=$$(TZ=Asia/Taipei date +%Y-%m)" | jq -e '.events | length > 0' > /dev/null
	@echo "Monitor passed: $(PROD_URL)"
```

（`%E8%87%BA%E5%8C%97` 是 `臺北` 的 URL encode。）

- [ ] **Step 2: 本機驗證正向、反向、線上與時區**

Run: `make run-prod && make monitor-prod`
Expected: `Monitor passed: http://localhost:8791`

Run: `make monitor-prod PROD_URL=http://localhost:1; echo "exit=$?"`
Expected: `exit=2`（非 0 即可）。

Run: `make monitor-prod PROD_URL=https://<Task 17 的網域>`
Expected: `Monitor passed: https://...onrender.com`

Run: `TZ=UTC date -r 1790787600 +%Y-%m; TZ=Asia/Taipei date -r 1790787600 +%Y-%m`
Expected: `2026-09` 然後 `2026-10`（1790787600 是 UTC 2026-09-30 17:00，台灣已是 10/1 01:00）。證明 `TZ=Asia/Taipei` 會把月初那 8 小時算對。

- [ ] **Step 3: 建立 `.github/workflows/monitor.yml`**

```yaml
name: Monitor

on:
  schedule:
    - cron: "*/30 * * * *"
  workflow_dispatch:

# All shell commands live in the Makefile.
jobs:
  monitor:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: make monitor-prod PROD_URL=${{ vars.PROD_URL }}
```

- [ ] **Step 4: Commit、合回 master、手動觸發一次 ★ checkpoint**

```bash
git add Makefile .github/workflows/monitor.yml
git commit -m "ci: add scheduled production monitor via make monitor-prod"
git push -u origin chore/monitor
gh run watch
gh pr create --fill --base master
gh pr merge --merge --delete-branch
git switch master && git pull
gh workflow run monitor.yml
gh run watch
```

Expected: 手動觸發的 Monitor run 綠燈，log 有 `Monitor passed: https://...onrender.com`。schedule 只在 default branch 生效，所以要合回 master 後才會每 30 分鐘跑。

- [ ] **Step 5: 上線穩定一週後之 v1 下線執行清單 ★ checkpoint**
  - Monitor 連續 7 天沒有紅燈：`gh run list --workflow monitor.yml --limit 400 --json conclusion -q '[.[] | select(.conclusion=="failure")] | length'` 為 `0`。
  - 朋友改用 v2 網址。
  - 執行 `fly apps destroy taiwan-culture-event-info`（不可逆，執行前再跟 owner 確認一次）。

---

進度追蹤只記在 `docs/roadmaps/2026-10-06-roadmap-v9.md`，本文件不另放對照表。
