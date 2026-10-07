# Culture Event Finder Refactor：Implementation Plan v10

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** `docs/superpowers/specs/2026-10-06-culture-event-finder-design-v10.md`
**Roadmap:** `docs/roadmaps/2026-10-06-roadmap-v10.md`

> ⚠️ **本文件自足。執行時不需開啟舊 plan 或舊 spec。**
> `2026-10-06-...-plan-v9.md` 以前全部標記 SUPERSEDED。

**Goal:** 收尾 Phase 5：所有 CLI 收進 Makefile、CI 改成每個 branch 都跑且只呼叫 make、移除用不到的 `SECRET_KEY`，然後上 Render 並加定時監控。

**Architecture:** Makefile 是唯一的指令入口，`ci.yml` 與 `monitor.yml` 只放 `uses:` action 與 `make <target>`。本機跑 `make run-prod && make smoke-prod` 與 CI 跑的是同一份指令。settings 不設 `SECRET_KEY`。

**Tech Stack:** Django 5.2 LTS、uv、pytest + pytest-django；Vite + React + TS + Vitest；Docker multi-stage；GNU Make；GitHub Actions；Render free web service。

---

## Global Constraints

- **Python 3.13、Django 5.2 LTS。** 依賴管理單一來源是 uv（`pyproject.toml` + `uv.lock`）。
- **所有 CLI 指令都寫在 Makefile。** workflow 的 `run:` 只能是 `make <target>`，其餘步驟只能是 `uses:`；README 只寫 make 指令。開發者自己打的 `git`、`gh` 不在範圍內。
- **CI 觸發是 `on: push`，不限 branch，不加 `pull_request`。**
- **Phase 5 全程直接在 master commit、push，不開 branch、不開 PR**（v1 下線前，朋友還在用 v1，spec §6.4）。v1 下線後新工作才開 branch。master 的 push 觸發 Render 部署，CI 紅燈不部署。
- **不設 `SECRET_KEY`：** settings 不寫這個設定，任何環境（Makefile、CI、Dockerfile、Render）都不傳它。專案沒有 sessions、auth、messages，沒有程式讀它；日後加了這類功能再補（spec §11）。
- **`ALLOWED_HOSTS` 仍是 prod 必填**，build 期 collectstatic 只注入 `ALLOWED_HOSTS=build-only`。
- **所有部署檔案放 `deployment/`。** build context 一律是 repo root：`docker build -f deployment/prod/Dockerfile .`。
- **prod port 8791；dev backend 8789、frontend 8790。** prod container 名稱 `culture-event-prod`，image 名稱 `culture-event-finder-prod`。
- **監控：** 每 30 分鐘 `make monitor-prod`，`curl --max-time 90`，`jq -e '.events | length > 0'`，月份用 `TZ=Asia/Taipei`。

## Review Focus

1. **master 的 push 要觸發 CI。** Task 15 Step 6 實際 push 驗證。`on: push` 不限 branch，非 master branch 的觸發這次不驗證，v1 下線後第一次開 branch 時確認。
2. **container 起不來時 smoke 要失敗而且看得到原因。** `make smoke-prod` 等 30 秒後照樣打 curl，curl 失敗讓 make 失敗；CI 以 `if: failure()` 跑 `make logs-prod`。Task 15 Step 4 驗證沒有 container 時 `make smoke-prod` 回非 0。
3. **Render 冷啟動不能被當成故障。** free instance 喚醒約一分鐘，`monitor-prod` 用 `--max-time 90`。
4. **月初跨時區。** GitHub runner 是 UTC，台灣每月 1 號 00:00 到 08:00 用 UTC 算會拿到上個月。`monitor-prod` 用 `TZ=Asia/Taipei date +%Y-%m`，Task 18 Step 2 驗證。

---

## Phase 0 ~ Phase 4 ✅（Task 1 ~ Task 14 已完成）

- [x] **Phase 0**：spec、POC v28、plan、roadmap 定稿（v10 於 2026-10-06 改版）
- [x] **Task 1 ~ 4**：uv、settings 骨架、dev 環境、前端 scaffold（commit `c2fa6fd` ~ `4127ea6`）
- [x] **Task 5 ~ 7**：provider、services、API endpoints（commit `d3d1aa1` ~ `f749a18`）
- [x] **Task 8 ~ 11**：前端型別、i18n、元件、App 組裝（commit `f07a2de` ~ `8708bb8`）
- [x] **Task 12**：(title, location) 聚合與多場次 Modal
- [x] **Task 13**：prod multi-stage Dockerfile + SPA catch-all（commit `c5ae9c4`）
- [x] **Task 14**：README（commit `4aa6e6d`、`59ee17f`）

v8 的 Task 15（CI，commit `6d61ea8`）由本版 Task 15 重寫；Task 16 是新增的移除 `SECRET_KEY`；原 Task 16、17 順延為 Task 17、18。

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

- [x] **Step 0: 在 master commit v10 文件**

```bash
git add docs/
git commit -m "docs: add spec v10, plan v10, roadmap v10"
```

- [x] **Step 1: 改 Makefile**

`.PHONY` 那行換成：

```makefile
.PHONY: run-dev stop-dev install-host test test-backend test-frontend build-prod run-prod smoke-prod logs-prod watch-ci stop-prod prune
```

`test-backend` 加 `--frozen`（CI 原本就有，搬進來後本機與 CI 一致：照 `uv.lock` 跑，不偷偷更新 lock）：

```makefile
test-backend:
	cd backend && DEBUG=True uv run --frozen pytest .
```

刪掉 `build-prod` 上方過期的註解 `# Production Dockerfile is created in Task 12; failure before Task 12 is expected.`。

在 `stop-prod` 之前加三個 target（`smoke-prod` 從 `git show 6d61ea8:.github/workflows/ci.yml` 的 smoke 步驟搬過來；目前工作區的 `ci.yml` 已被 commit `154819b` 清空，Step 2 整份重寫）：

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

# Wait for the run of the current commit, then watch it. Non-zero exit if it fails.
# gh needs a run ID when not interactive, and the run may not exist right after push.
WORKFLOW ?= ci.yml
watch-ci:
	@for i in $$(seq 30); do \
		id=$$(gh run list --workflow $(WORKFLOW) --commit $$(git rev-parse HEAD) -L1 --json databaseId -q '.[0].databaseId'); \
		[ -n "$$id" ] && break; sleep 2; \
	done; \
	gh run watch "$$id" --exit-status
```

- [x] **Step 2: 重寫 `.github/workflows/ci.yml`**

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

- [x] **Step 3: 本機跑一次正向 smoke**

Run: `make run-prod && make smoke-prod`
Expected: 最後一行 `Smoke tests passed.`

- [x] **Step 4: 本機跑一次反向 smoke（沒有 container 時一定要失敗）**

Run: `make stop-prod; make smoke-prod; echo "exit=$?"`
Expected: 約 30 秒後 curl 失敗，最後一行 `exit=2`（非 0 即可）。

- [x] **Step 5: README 加 smoke 指令**

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

- [x] **Step 6: Commit、push master、驗證 CI**

```bash
git add Makefile .github/workflows/ci.yml README.md readme/README.zh-tw.md
git commit -m "ci: run on every branch push and route all commands through Makefile"
git push
make watch-ci
```

Expected: master 的 push 觸發了 CI，三個 job 全綠，`make watch-ci` exit 0。第一次 push 會連同尚未推上去的 `6d61ea8`、`154819b` 一起推；Step 6 之前不可以先 push，否則會推出被清空的 `ci.yml`。`test-backend` 若在 Python 安裝階段失敗，代表 `uv run` 沒有依 `.python-version` 自動取得 3.13：在 `setup-uv` 的 `with:` 加 `python-version: "3.13"`（仍是 `uses:` 設定，不違反 CLI 規則）後重推。

---

### Task 16: 移除 `SECRET_KEY` ★ checkpoint

**Files:**
- Modify: `backend/config/settings.py:14-20`
- Modify: `Makefile`（`run-prod` 拿掉 `-e SECRET_KEY=...`）
- Modify: `deployment/prod/Dockerfile:32-33`
- Modify: `README.md`、`readme/README.zh-tw.md`（環境變數表與 Render 步驟）

**Interfaces:**
- Consumes: Task 15 的 `make smoke-prod`
- Produces: settings 裡沒有 `SECRET_KEY`，任何環境都不傳它。

沒有新測試：沒有邏輯可測。「不帶 key 也能開機、能回應」由 Step 3 的 `make test-backend` 與 Step 4 的 smoke 驗證。

- [x] **Step 1: 刪掉 settings 的 `SECRET_KEY`**

`backend/config/settings.py` 第 14 ~ 20 行整段 `# 2. SECRET_KEY fail-fast guard` 刪掉（含結尾空行），下面的 `# 3. ALLOWED_HOSTS` 改編號成 `# 2. ALLOWED_HOSTS`。`from django.core.exceptions import ImproperlyConfigured` 留著，`ALLOWED_HOSTS` 守衛還在用。

- [x] **Step 2: 拿掉其他地方的 `SECRET_KEY`**

`Makefile` 的 `run-prod` 第二行：

```makefile
	docker run -d --rm --name culture-event-prod -p 8791:8791 -e ALLOWED_HOSTS=localhost,127.0.0.1,0.0.0.0 culture-event-finder-prod
```

`deployment/prod/Dockerfile` 的 collectstatic：

```dockerfile
RUN ALLOWED_HOSTS=build-only python backend/manage.py collectstatic --noinput
```

`README.md`：環境變數表刪掉 `SECRET_KEY` 那一列；Render Deployment Guide 第 4 步換成：

```markdown
4. Set the Environment Variable:
   - `ALLOWED_HOSTS`: Set to your Render domain (e.g. `culture-event-finder-v2.onrender.com`).
```

`readme/README.zh-tw.md`：環境變數表刪掉 `SECRET_KEY` 那一列；第 4 步換成：

```markdown
4. 設定環境變數：
   - `ALLOWED_HOSTS`：填入 Render 分配的域名（例如 `culture-event-finder-v2.onrender.com`）。
```

- [x] **Step 3: 確認沒有殘留、測試全過**

Run: `git grep -n "SECRET_KEY" -- ':!docs/'`
Expected: 沒有任何輸出（exit 1）。

Run: `make test-backend`
Expected: 全部 PASS。

- [x] **Step 4: prod image 不帶 SECRET_KEY 也能起來**

Run: `make run-prod && make smoke-prod && make stop-prod`
Expected: `Smoke tests passed.`

- [x] **Step 5: Commit、push master ★ checkpoint**

```bash
git add backend/config/settings.py Makefile deployment/prod/Dockerfile README.md readme/README.zh-tw.md
git commit -m "refactor(settings): remove unused SECRET_KEY"
git push
make watch-ci
```

Expected: master 的 CI 三個 job 全綠，`make watch-ci` exit 0。

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

Run: `make run-prod && make smoke-prod && make monitor-prod`（`run-prod` 不等 server 起來，先用 `smoke-prod` 等 `/health`）
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

- [ ] **Step 4: Commit、push master、手動觸發一次 ★ checkpoint**

```bash
git add Makefile .github/workflows/monitor.yml
git commit -m "ci: add scheduled production monitor via make monitor-prod"
git push
make watch-ci
gh workflow run monitor.yml
make watch-ci WORKFLOW=monitor.yml
```

Expected: 手動觸發的 Monitor run 綠燈，log 有 `Monitor passed: https://...onrender.com`。schedule 只在 default branch 生效，master 就是 default branch，push 後就會每 30 分鐘跑。

- [ ] **Step 5: 上線穩定一週後之 v1 下線執行清單 ★ checkpoint**
  - Monitor 連續 7 天沒有紅燈：`gh run list --workflow monitor.yml --limit 400 --json conclusion -q '[.[] | select(.conclusion=="failure")] | length'` 為 `0`。
  - 朋友改用 v2 網址。
  - 執行 `fly apps destroy taiwan-culture-event-info`（不可逆，執行前再跟 owner 確認一次）。

---

進度追蹤只記在 `docs/roadmaps/2026-10-06-roadmap-v10.md`，本文件不另放對照表。
