# Culture Event Finder v2

<p align="right">
  <a href="../README.md">English</a> | <b>繁體中文</b>
</p>

Culture Event Finder v2 是一個現代化的台灣藝文活動查詢平台。
後端使用 Django 5，前端使用 Vite 搭配 React。
透過多階段 Dockerfile，將前後端打包成單一容器，方便快速部署。

![frontend.png](frontend.png)

---

## 核心特色

1. **同場次智慧聚合**：以活動名稱與場地聚合多場次活動，整合為單一卡片。點擊可開啟彈窗查看所有日期與時間。
2. **三層快取與防護**：
   - 負面快取：外部文化部 API 呼叫失敗時，快取 60 秒以避免連線擊穿。
   - 白名單驗證：嚴格檢驗縣市名稱、類別代碼與 `YYYY-MM` 日期格式。
   - 請求追蹤：在每個 HTTP 請求注入 `X-Request-ID`。
3. **無換頁單頁應用 (SPA)**：純狀態機驅動視圖切換，支援完整無障礙朗讀與鍵盤導航。支援深淺色雙主題與多語系切換。
4. **單一容器部署**：多階段 Docker 建置將 React 靜態檔案編譯完成，由 Django WhiteNoise 直接託管。

---

## 系統架構與流程圖

```
+----------------------------------------------------------------+
|                       使用者 / 瀏覽器                          |
|                 (選擇縣市與類別，點擊搜尋)                     |
+-------------------------------+--------------------------------+
                                │
                                │ 1. GET /api/v1/events/?...
                                ▼
+----------------------------------------------------------------+
|                     後端服務 (Django 5)                        |
|                   驗證縣市與類別白名單                         |
+-------------------------------+--------------------------------+
                                │
                                │ 2. 檢查快取
                                ▼
                        /---------------\
                       /   快取命中?     \
                       \                 /
                        \---------------/
                         │             │
                  [命中] │             │ [未命中]
                         │             │
                         │             │ 3. 請求活動資料
                         │             ▼
                         │     +---------------------------------+
                         │     |     文化部 Open Data API        |
                         │     +---------------+-----------------+
                         │                     │
                         │                     │ 4. 回傳原始活動
                         │                     ▼
                         │     +---------------------------------+
                         │     |      依「名稱與場地」聚合       |
                         │     |         並寫入快取              |
                         │     +---------------+-----------------+
                         │                     │
                         ▼                     ▼
+----------------------------------------------------------------+
|                     前端介面 (React + Vite)                    |
|             渲染聚合卡片與「共 N 場次」互動彈窗                |
+----------------------------------------------------------------+
```

---

## 技術棧

- **後端**：Python 3.12, Django 5.1, Gunicorn, WhiteNoise, Requests, Pytest
- **前端**：TypeScript, React 18, Vite, Tailwind CSS, Lucide Icons, Vitest
- **套件管理**：`uv` (Python), `npm` (Node.js)
- **部署工具**：Docker, Docker Compose, GitHub Actions

---

## 本地開發

### 1. 開發模式 (Dev)

啟動熱重載開發環境：

```bash
make run-dev
```

- 前端：http://localhost:8790
- 後端：http://localhost:8789
- 停止服務：`make stop-dev`

### 2. 生產容器本機模擬 (Prod)

建置並執行生產環境容器（監聽 port 8791）：

```bash
make run-prod
make smoke-prod   # 跟 CI 跑的檢查一樣
```

- 服務網址：http://localhost:8791
- 停止容器：`make stop-prod`

### 3. 執行自動化測試

執行後端 Pytest 與前端 Vitest 測試套件：

```bash
# 執行全部測試
make test

# 僅執行後端測試
make test-backend

# 僅執行前端測試
make test-frontend
```

---

## 環境變數

| 變數名稱 | 適用環境 | 說明 | 範例 / 預設值 |
|---|---|---|---|
| `SECRET_KEY` | 生產環境 (必填) | Django 密鑰。未設定會在啟動時直接拋錯中止。 | `local-prod-test-key` |
| `ALLOWED_HOSTS` | 生產環境 (必填) | 允許連線的 Host 網域清單（以逗號分隔）。 | `localhost,127.0.0.1,0.0.0.0` |
| `DEBUG` | 開發環境 | 是否開啟 Django 除錯模式。生產容器中預設關閉。 | `0` (Prod) / `1` (Dev) |
| `PORT` | 生產環境 | Gunicorn 監聽埠號。 | `8791` (本地) / 由部署平台注入 |

---

## API 端點

| 方法 | 端點 | 說明 | 參數 / 回傳範例 |
|---|---|---|---|
| `GET` | `/health` | 服務探活與健康檢查 | 回傳 `{"status": "ok"}` 與 HTTP 200 |
| `GET` | `/api/v1/countries` | 取得支援國家清單 | 回傳 `[{"code": "TW", "name": "Taiwan", "supported": true}]` |
| `GET` | `/api/v1/events/` | 查詢並聚合活動清單 | 參數：`country`（如 `TW`）、`location`（如 `臺北`）、`category`（如 `1`）、`month`（格式 `YYYY-MM`） |

---

## Render 部署指引

1. 登入 Render Dashboard，點選 **New +** 並選擇 **Web Service**。
2. 連結 GitHub 專案儲存庫。
3. 設定服務規格：
   - **Region**：Singapore
   - **Environment**：Docker
   - **Dockerfile Path**：`deployment/prod/Dockerfile`
   - **Health Check Path**：`/health`
4. 設定環境變數：
   - `SECRET_KEY`：填入隨機生成的高強度字串。
   - `ALLOWED_HOSTS`：填入 Render 分配的域名（例如 `culture-event-finder-v2.onrender.com`）。
5. 點擊 **Create Web Service** 開始建置與部署。
