# Culture Event Finder Refactor：Implementation Plan v8

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** `docs/superpowers/specs/2026-10-04-culture-event-finder-design-v8.md`
**Roadmap:** `docs/roadmaps/2026-10-04-roadmap-v8.md`

> ⚠️ **本文件自足。執行時不需開啟舊 plan 或舊 spec。**
> `2026-10-04-...-plan-v7.md`、`2026-10-02-...-plan-v6.md`、`2026-08-23-...-plan-v5.md`
> 全部標記 SUPERSEDED。本 repo 為全新 repo（`culture_event_finder_v2`），不包含舊 repo 的 git 歷史與 legacy 程式碼。

**Goal:** 把 Taiwan culture-event 的 Django/Jinja2 網站重構成 React (Vite + TS + Tailwind) SPA + Django JSON API，以單一 container 部署到 Render free web service，具備可擴展之 provider 架構（保留 Provider ABC，先實作台灣）、cache-aside 與 zh/en UI i18n。依 POC v28 實現同 (title, location) 活動卡片場次聚合與 Modal 檢視。

**Architecture:** 後端分層 views (HTTP) → services (cache + 區間過濾/排序 + 場次聚合) → providers (外部資料源封裝)。前端是 Vite 靜態 build，由同一個 Django container 透過 WhiteNoise 服務。無 react-router、無 DB 依賴、無 CORS。dev 環境走 docker-compose 兩個 service。

**Tech Stack:** Django 5.2 LTS、uv (依賴管理)、toolkitsy (logging)、requests、pytest + pytest-django + responses；Vite + React + TypeScript + Tailwind CSS + Vitest；Docker multi-stage；Render free web service + GitHub Actions (CI & Scheduled Monitoring)。

---

## Global Constraints

- **全新 repo 原則**：本 repo 是獨立全新專案（`culture_event_finder_v2`），不引入 v1 的舊 static assets、模板或 Poetry 殘留。
- **Python 3.13、Django 5.2 LTS。**
- **依賴管理單一來源是 uv。** `pyproject.toml` (PEP 621) + `uv.lock` 是 source of truth。
- **所有部署檔案放 `deployment/`，root 不放。** dev：`deployment/dev/`；prod：`deployment/prod/`。
- **build context 一律是 repo root。** prod 一律 `docker build -f deployment/prod/Dockerfile .`。
- **dev port：backend 8789、frontend 8790，container 內外同號。** Vite proxy 目標是 `http://backend:8789`。
- **compose 指令一律經過 Makefile**：帶入 `HOST_UID` 與 `HOST_GID`。
- **build 期必須同時注入 `SECRET_KEY` 與 `ALLOWED_HOSTS` 假值。**
- **prod gunicorn 參數**：`--workers 1 --threads 8 --worker-class gthread --timeout 60`。
- **CMD shell 形式**：`CMD exec gunicorn ...`（不可使用 JSON 陣列傳遞 `${PORT}`）。
- **WhiteNoise 用 plain storage**：自訂 `WHITENOISE_IMMUTABLE_FILE_TEST` 匹配 Vite hash 檔名。
- **cache TTL：12 小時（`43200` 秒）。** Key 格式：`events:{country}:{category}`。失敗短快取（negative cache）60 秒。
- **月份過濾用區間重疊判斷**：`start <= end_of_month and end >= start_of_month`。
- **地名比對前做 `臺` / `台` 正規化。**
- **台灣 locations 是 20 個前綴、涵蓋 22 個縣市。**
- **前端外連必須 URL encode**：Google Maps 與 Google 搜尋連結地點與標題需做 `encodeURIComponent`。
- **前端視覺 source of truth 是 `docs/poc/20261004_213658_ui_design_v28.html`**。禁用粉紅/magenta；日曆基準線對齊；多場次以 Modal 檢視。
- **監控正向白名單斷言**：GitHub Actions 每 30 分鐘打真實 URL，嚴格判定 `HTTP 200 && length > 0`。

---

## Phase 0：規劃 ✅

- [x] **spec v8 定稿**：`docs/superpowers/specs/2026-10-04-culture-event-finder-design-v8.md`
- [x] **POC HTML gate 通過**：`docs/poc/20261004_213658_ui_design_v28.html`
- [x] **plan v8 定稿**（本文件）與 **roadmap v8 定稿**

---

## Phase 1：骨架先立好 ✅（Task 1 ~ Task 4 已完成）

- [x] **Task 1: uv 初始化與依賴配置**（commit `c2fa6fd`）
- [x] **Task 2: backend 目錄與 settings 骨架**（commit `b2616b9`）
- [x] **Task 3: dev 環境配置（`deployment/dev/` + `Makefile`）**（commit `3b49034`）
- [x] **Task 4: 前端 scaffold (Vite + React + TS + Tailwind + Vitest)**（commit `4127ea6`）

---

## Phase 2：後端 ✅（Task 5 ~ Task 7 已完成）

- [x] **Task 5: Provider layer (base.py + taiwan.py + PROVIDERS dict)**（commit `d3d1aa1`）
- [x] **Task 6: Services layer（白名單驗證 + cache-aside + 區間重疊過濾）**（commit `548cf49`）
- [x] **Task 7: API endpoints 端點串接（views.py + urls.py + CorrelationIdMiddleware）**（commit `f749a18`）

---

## Phase 3：前端 ✅（Task 8 ~ Task 11 已完成）

- [x] **Task 8: 前端型別、API 客戶端與純函式工具庫**（commit `f07a2de`）
- [x] **Task 9: i18n 語系架構、主題狀態與 LanguageSwitch 元件**（commit `8f64560`）
- [x] **Task 10a: Design system、背景場景、Icon、四種狀態畫面**（commit `bcf1487`）
- [x] **Task 10b: 活動卡片與卡片列表元件**（commit `cf18538`）
- [x] **Task 10c: 國家選擇器、搜尋膠囊、類別快捷 chips**（commit `c4fe457`）
- [x] **Task 11: App 狀態機組裝與 About 頁面**（commit `8708bb8`）

---

## Phase 3.5：活動卡片多場次聚合與 Modal（Task 12）

### Task 12: 活動卡片依 (title, location) 聚合與多場次 Modal ★ checkpoint

**Files:**
- Modify: `backend/events/services.py` (`search_events` 依 `(title, location)` 聚合場次、排序與組裝 `shows`)
- Modify: `backend/events/views.py` (`_event_to_json` 輸出包含 `shows: [{ startTime, endTime }]` 契約)
- Modify: `backend/events/tests/test_services.py` (新增同活動同地點多場次聚合測試)
- Modify: `backend/events/tests/test_views.py` (驗證 API 回傳之 `shows` 陣列結構)
- Modify: `frontend/src/types.ts` (`EventItem` 增加 `shows: { startTime: string; endTime: string | null }[]`)
- Modify: `frontend/src/components/EventCard.tsx` (日曆列統一基準線；多場次提供場次標籤，點擊開啟 Modal)
- Create: `frontend/src/components/ShowTimesModal.tsx` (毛玻璃多場次彈出視窗，依日期分組展示時段)
- Modify: `frontend/src/api.test.ts` (同步前端合約型別測試)

**Interfaces:**
- API Contract: `GET /api/v1/{country}/events` 回傳物件具備 `shows` 陣列，按時間升序排列。
  ```json
  {
    "events": [
      {
        "id": "...",
        "title": "王羽佳XR音樂會《羽火共舞》",
        "startTime": "2026/10/10 11:00:00",
        "endTime": "2026/10/24 21:00:00",
        "location": "臺北市中正區中山南路21-1號",
        "locationName": "國家兩廳院實驗劇場",
        "onSales": true,
        "price": "500",
        "shows": [
          { "startTime": "2026/10/10 11:00:00", "endTime": "2026/10/10 12:00:00" },
          { "startTime": "2026/10/10 14:00:00", "endTime": "2026/10/10 15:00:00" }
        ]
      }
    ],
    "meta": { "rawCount": 741, "matchedCount": 90, "cacheAge": null }
  }
  ```
- Frontend: 卡片主體時間行格式統一（`formatEventDateRange`），多場次卡片提供場次數量按鈕，點擊彈出毛玻璃 Modal 依日期分組檢視完整時段。

- [x] **Step 1: 後端契約與聚合邏輯**
  - 在 `services.py` 的 `search_events` 流程中，過濾月份命中後，依 `(title, location)` 將場次聚合。
  - 主活動的 `startTime` 取首場開始時間，`endTime` 取末場結束時間（或末場開始時間）。
  - `onSales` 為任一場次為 `True` 即為 `True`；`price` 取首筆非空票價。
  - `views.py` 的 `_event_to_json` 將聚合後的 `shows` 陣列序列化輸出。
  - 補足單元測試 `test_services.py` 與 `test_views.py`。

- [x] **Step 2: 前端型別與 EventCard / ShowTimesModal 元件**
  - `types.ts` 中的 `EventItem` 新增 `shows: { startTime: string; endTime: string | null }[]`。
  - 建立 `ShowTimesModal.tsx`：支援 ESC 鍵關閉、點擊遮罩關閉、日期分組、毛玻璃背景。
  - 修改 `EventCard.tsx`：日曆排版與 POC v28 一致；若 `shows.length > 1` 顯示 `N 場次 ▾` 按鈕，點擊喚出 Modal。

- [x] **Step 3: 雙端測試與驗證 ★ checkpoint**
  - 執行 `make test-backend` 與 `make test-frontend`，確保全數 PASS。
  - 啟動 dev container，打真實 MoC API（`category=1&location=臺北&month=2026-10`），確認王羽佳 85 場聚合成單張卡片，點擊場次按鈕彈出 Modal 檢視時段，且單場次活動正常排版。

- [x] **Step 4: Commit**

```bash
git add backend/ frontend/
git commit -m "feat(events): group events by title and location with multi-showtime modal support"
```

---

## Phase 4：prod image 與文件（Task 13, Task 14）

### Task 13: 多階段 Dockerfile + SPA Catch-all Routing + 本機 Smoke Test ★ checkpoint

**Files:**
- Create: `deployment/prod/Dockerfile`
- Create: `deployment/prod/Dockerfile.dockerignore`
- Modify: `backend/config/urls.py`（加入 SPA catch-all 路由）

**Interfaces:**
- Single multi-stage Dockerfile (`node:22-slim` -> `python:3.13-slim`)
- WhiteNoise 靜態託管 + Gunicorn 單一程序多執行緒
- `CMD exec gunicorn ...`（shell 形式展開 `${PORT}`）

- [x] **Step 1: 在 `backend/config/urls.py` 加 SPA catch-all**
- [x] **Step 2: 建立 `deployment/prod/Dockerfile.dockerignore`**
- [x] **Step 3: 建立 `deployment/prod/Dockerfile`**
- [x] **Step 4: 本機 build production image 並執行 smoke test ★ checkpoint**
- [x] **Step 5: Commit**

```bash
git add deployment/prod/ backend/config/urls.py
git commit -m "feat(deploy): add production multi-stage Dockerfile and SPA catch-all"
```

---

### Task 14: README 文件定稿

**Files:**
- Modify: `README.md`

- [ ] **Step 1: 撰寫正式 README.md**（包含專案架構、本地開發、Render 部署指南、環境變數表、維運須知）
- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: finalize comprehensive production README"
```

---

## Phase 5：上 Render 與監控（Task 15 ~ Task 17）

### Task 15: GitHub Actions CI Pipeline

**Files:**
- Create: `.github/workflows/ci.yml`

- [x] **Step 1: 建立 GitHub Actions CI workflow**（含 `test-backend`, `test-frontend`, `build-smoke` 三個 jobs）
- [ ] **Step 2: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: add GitHub Actions CI pipeline with multi-stage build smoke test"
```

---

### Task 16: Render Web Service 部署與驗證 ★ checkpoint

- [ ] **Step 1: Render Dashboard 建立 Web Service**（Singapore、Docker、Path: `deployment/prod/Dockerfile`、Health: `/health`）
- [ ] **Step 2: 設定環境變數**（`SECRET_KEY`, `ALLOWED_HOSTS` 對齊真實 URL）
- [ ] **Step 3: 首次部署與線上驗證 ★ checkpoint**（curl `/health` 與真實查詢）

---

### Task 17: GitHub Actions 定時監控與下線清單 ★ checkpoint

**Files:**
- Create: `.github/workflows/monitor.yml`

- [ ] **Step 1: 建立定時監控 workflow**（每 30 分鐘，打真實 URL，正向白名單斷言）
- [ ] **Step 2: Commit**
- [ ] **Step 3: Phase 5 上線穩定一週後之 v1 下線執行清單 ★ checkpoint**

---

進度追蹤只記在 `docs/roadmaps/2026-10-04-roadmap-v8.md`，本文件不另放對照表。
