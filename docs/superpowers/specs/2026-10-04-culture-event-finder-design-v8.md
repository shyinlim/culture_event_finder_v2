# Culture Event Finder：React + Django API 重構設計 v8

- 日期：2026-10-04
- 狀態：owner 於 2026-10-04 定案：活動卡片依 (title, location) 進行多場次聚合，卡片展示檔期與場次數，避免同節目連續重複排版。
- 取代：`2026-10-04-culture-event-finder-design-v7.md`（v7 標記 SUPERSEDED）
- 前身：`taiwan_culture_event_info_django_jinja2`（Django + Jinja2 server-rendered，
  另一個 repo，現役跑在 Fly.io app `taiwan-culture-event-info`）
- 本 repo：`culture_event_finder_v2`（全新 repo，從零開始，不搬 v1 的 git歷史）

> 本文件自足。執行時不需開啟 v1 到 v7。需要 v1 的程式碼時，只看 §7 列出的檔案。

**Phase 編號全文統一為 0 到 7，見 §9。**

## 1. 背景與定位

現況是一個 Django server-rendered 網站，透過台灣文化部 (MoC) open data API 查詢藝文活動。
產品定位：**owner 自己 + 朋友真的在用的實用工具**，不是 portfolio 展示品、暫不需要 SEO。

重構的驅動需求：

1. 前後端改為 **React (Vite) SPA + Django JSON API**，兼顧 owner 的 SDET 職涯發展。
2. Hosting 分兩階段：**Phase 5 上 Render free web service**（不用綁卡、$0，先出貨）；
   **Phase 6 才遷 Google Cloud Run**（always-free tier，owner 有時間再做）。
   Phase 6 另開 branch，不 block 主線。v1 在 Fly 上照常跑，當 v2 的 fallback，
   v2 上線穩定一週後才關（§6.5）。
3. UI 全面重做：**mobile-first responsive、卡片式列表**，丟掉 Material Dashboard 後台模板。
4. **多國擴展架構**：先做骨架，只實作台灣；未來加國家不推翻重寫。
5. **UI 多語言 (zh/en)**：用免費方案 (locale JSON)，不用付費翻譯服務。
6. **Cache 機制**：cache-aside + TTL，為未來付費 API 預留，跨 user 共用。
7. Code 難度控制在 owner 可獨立維護的程度（entry-level SDET 看得懂）。
8. **dev 環境 container 化**：docker-compose 起 Django + Vite，符合市面主流做法。

### 明確排除 (YAGNI)

- 搜尋條件進 URL (shareable URL)：之後要加很容易
- 結果二次篩選/排序
- SEO / SSR
- 活動內容機器翻譯（活動資料維持資料源語言）
- 第二個國家的實作（只做架構）
- **k8s 不進主線**：Render 與 Cloud Run 都是吃 Dockerfile 的 container 平台，
  不吃 k8s manifest。k8s 對本專案（單 container、單 instance）無運行價值，
  列為 Phase 7 學習用 side quest。
- **`render.yaml`（Blueprint）不做**：Render 的設定只有 region、plan、health check path、
  兩個環境變數、auto-deploy 模式這六項，在 dashboard 點一次，抄進 README（§6.1）。
  Phase 6 搬走時這份設定就作廢，為它多維護一個檔不划算。

## 2. Repo 結構 (monorepo)

Repo 名稱維持 `culture_event_finder_v2`，不改名。

```
culture_event_finder_v2/
├── backend/                     # Django
│   ├── config/                  # settings / urls / wsgi
│   ├── events/                  # 唯一的業務 app
│   │   ├── providers/
│   │   │   ├── base.py          # Provider 抽象 interface + registry
│   │   │   └── taiwan.py        # MoC API 呼叫 + 台灣 locations/categories 設定
│   │   ├── services.py          # cache-aside + 過濾/排序（純函式）
│   │   ├── views.py             # 薄：只做 HTTP in/out 與參數驗證
│   │   └── tests/
│   └── health/                  # health check endpoints
├── frontend/                    # Vite + React + TypeScript
│   ├── public/favicon.svg       # prod 在 /static/ 底下，CI 用它驗 base path
│   └── src/
│       ├── components/          # Scene, Icon, StatePanels, EventCard, EventList,
│       │                        # CountryPicker, SearchForm, CategoryChips,
│       │                        # LanguageSwitch, About, ShowTimesModal
│       ├── design.css           # 毛玻璃 design system（從 POC v28 抽出）
│       ├── api.ts               # 集中所有 fetch 呼叫 + 錯誤分類
│       ├── types.ts             # 與 §3.1 合約對應的型別
│       ├── i18n.tsx             # 語系 context + 純函式
│       ├── theme.ts             # 主題 hook
│       ├── utils/               # format.ts（純函式，可單測）
│       └── locales/             # zh.json / en.json
├── deployment/                  # 所有部署相關檔案集中在這裡，root 不放
│   ├── dev/
│   │   ├── docker-compose.yml   # dev 環境，起 backend + frontend
│   │   ├── backend.Dockerfile   # dev 用 python container
│   │   └── frontend.Dockerfile  # dev 用 node container
│   ├── prod/
│   │   ├── Dockerfile           # prod multi-stage
│   │   └── Dockerfile.dockerignore
│   └── terraform/               # Phase 6 才建（§6.6）
├── docs/poc/                    # POC HTML 迭代紀錄（design reference，唯讀）
├── Makefile                     # 指令入口，留 root（不是部署設定）
└── pyproject.toml / uv.lock     # Python 依賴，留 root
```

**`deployment/` 是唯一放部署檔的地方。** 之後新增的部署相關檔案（CI 以外的 IaC、
監控設定等）一律放這裡，root 只留 makefile 與語言工具鏈必須在 root 的檔案
（`pyproject.toml`、`uv.lock`、`.python-version`）。
`.github/workflows/` 是 GitHub 規定的位置，不搬。

**build context 一律是 repo root，Dockerfile 只是放在子目錄。** image 需要同時拿到
`backend/`、`frontend/`、`pyproject.toml` 與 `uv.lock`，所以所有 build 都寫成
`docker build -f deployment/prod/Dockerfile .`（最後的 `.` 就是 repo root）。
Dockerfile 裡的 `COPY` 路徑因此照舊相對 repo root 寫，不用加 `../`。

**`.dockerignore` 放在 Dockerfile 旁邊，不放 root。** Docker 支援 Dockerfile 專屬的
ignore 檔，命名是 `<Dockerfile 檔名>.dockerignore`，與 Dockerfile 同目錄，
且優先於 build context root 的 `.dockerignore`。prod 用
`deployment/prod/Dockerfile.dockerignore`，至少排除 `.git`、`.venv`、
`frontend/node_modules`、`staticfiles/`、`docs/`。不排除的話每次 build 都把
`.venv` 與 `node_modules` 整包送進 build context，慢而且 image 可能夾帶 host 的
macOS binary。dev 的兩個 Dockerfile 只 `COPY` 依賴清單、原始碼靠 bind mount，
暫不需要 ignore 檔。

沒有任何平台專屬設定檔（無 `fly.toml`、無 `render.yaml`）。同一個 Dockerfile
在 Render 與 Cloud Run 都能跑，因為兩者都會注入 `$PORT`（§6.1）。
Dockerfile 不在 root 的代價是兩個平台都要告訴它路徑：Render 在 dashboard 填
Dockerfile Path（§6.1），Cloud Run 改成 CI 自己 build image 再部署（§6.6）。

分層原則：views (HTTP) → services (業務邏輯 + cache) → providers (外部資料源)。
每層單獨可測、單獨可替換。**不再加第四層**：不引 DRF、不引 serializer、不引 repository。
`_event_to_json` 用十行手寫 dict 就是正確答案。

## 3. 後端設計

### 3.1 API contract

```
GET /api/v1/countries
    → [{ "code": "tw", "name": {"zh", "en"},
         "locations":  [{ "value": "臺北", "zh": "臺北", "en": "Taipei" }, ...],
         "categories": [{ "value": "6", "zh": "展覽", "en": "Exhibition" }, ...] }]
      前端下拉選單的唯一資料來源；只回傳已註冊的國家。
      categories 的第一個是前端的預設類別。

GET /api/v1/{country}/events?category=6&location=臺北&month=2026-07
    → { "events": [ { "id", "title", "location", "locationName", "onSales", "price",
                      "shows": [ { "startTime", "endTime" }, ... ] } ],
        "meta": { "rawCount", "matchedCount", "cacheAge" } }
      id 是代表活動的唯一 id；shows 為依 (title, location) 聚合的時段列表，按時間升序排列；
      onSales 為 boolean（任一場次 onSales 為 true 即為 true）；
      price 為票價字串（若有相異票價以首筆或統整顯示）；
      cacheAge 是秒數，這次是 cache miss 時為 null。
      Google Map 與 Google 搜尋連結由前端組（要 encodeURIComponent），不放在合約裡。

GET /health
    → 200，平台 health check。不碰任何外部依賴，只證明 process 活著。
```

**`meta` 是這個專案最可靠的事後診斷工具，不是裝飾。** Render 的 log 只保留 7 天
（Hobby workspace），朋友常常隔一兩週才回報「查無結果」，那時 log 已經沒了（§3.4）。
三個數字分別回答三個問題：`rawCount` 是上游給了幾筆（0 代表 MoC 那邊沒資料或格式變了）、
`matchedCount` 是本地過濾後剩幾筆（`rawCount` 大而 `matchedCount` 為 0 代表過濾邏輯壞了）、
`cacheAge` 是這份資料在 cache 裡幾秒了（`null` 代表這次是 miss）。
前端不顯示它們，但 owner 一個 curl 就能分辨是上游問題還是自己的問題。

錯誤格式統一：`{ "error": { "code": "...", "message": "..." } }`

- 參數缺漏/非法 → 400，`code` 為 `bad_request`
- 未支援的國家 → 404，`code` 為 `not_found`
- 上游 (MoC) 失敗或 timeout → 502，`code` 為 `upstream_error`，前端顯示「資料來源暫時無法使用」
- 「查無結果」是 200 + 空陣列，與錯誤明確區分

**參數一律對照 provider 白名單驗證。** `category` 必須在 `provider.categories` 的 value
集合內，`location` 必須在 `provider.locations` 的 value 集合內，否則 400。
只檢查 `isdigit()` 是不夠的：`category=999999` 會實際打上游並佔用一個 cache entry，
連續丟不同 category 可以把 LocMemCache 預設的 300 個 entry 上限洗掉，
之後每個真實查詢都變成 cache miss。

#### ⚠️ 驗證通過但轉型爆炸的兩個洞

驗證與轉型用的不是同一套判定時，會出現「守衛說沒問題、下一行就 500」的情況。
這兩個洞都是回 Django 500 HTML，不是合約承諾的 400 JSON，前端只看得到「發生錯誤」。

1. **`str.isdigit()` 對上標數字回 True。** `'²'.isdigit()` 是 `True`，
   而 `int('²')` 拋 `ValueError`。`?category=²` 通過守衛、死在轉型。
   解法是不轉 int：category 用字串直接比對白名單（白名單是 `"6"` 這種字串），`²` 自然不在裡面。
2. **月份 regex 允許不存在的年份。** `^\d{4}-(0[1-9]|1[0-2])$` 接受 `0000-01`，
   而 `datetime.strptime("0000-01-01", "%Y-%m-%d")` 拋
   `ValueError: year 0 is out of range`。regex 收斂成
   `(19|20)\d{2}-(0[1-9]|1[0-2])`。

**`location` 的白名單比對要先正規化再查。** 過濾階段會把 `台` 折成 `臺`（見 §3.2），
但白名單比對如果拿原值去查集合，`location=台北` 這個書籤會拿到 400，
而它的過濾邏輯本來是會命中的。兩處要用同一個正規化函式。

**404 的判定放在 view 層**，用 `PROVIDERS.get(country)` 直接判斷。
services 不 raise `KeyError`，view 的 try 區塊只留 `except UpstreamError`。
若讓 `except KeyError` 包住整個 service 呼叫，內部任何深層 `KeyError`
都會變成假的「不支援這個國家」，排查方向會被完全帶偏。

### 3.2 Provider 架構（多國擴展點）

- `base.py` 定義抽象 interface：`fetch_events(category) -> list[Event]`、
  `locations`、`categories`、國家 metadata。加上 `Event` dataclass 與 `UpstreamError`。
- `taiwan.py` 實作 MoC API。SSL `verify=False` workaround（`cloud.culture.tw` 憑證缺
  Subject Key Identifier，Python 3.13 拒連）封裝在此檔內並附註解。
- Registry 用簡單 dict：`PROVIDERS = {"tw": TaiwanProvider()}`，放在 `events/providers/__init__.py`。
- **一場 showInfo 一個 Event。** MoC 一個活動可能有多場，每場的城市與時間不同
  （v1 也是逐場處理）。只取第一場的話，巡演在其他城市的場次會被地區過濾靜默丟掉。
- v1 `main_project/culture/data.py` 的 hardcoded Location/EventCategory 移植進
  `taiwan.py`（來源檔見 §7）。

**界線與定位（Owner 於 2026-10-02 明確確認保留）：不要再加 provider factory、不要加 `providers/registry.py`、
不要讓 `get_provider` 做 fallback。** 這個 ABC 目前雖只有一個實作，但不是過度設計，
而是明確為未來多國/多來源開發所預留的擴展骨架，換到的是
README「Adding a country」那幾步真的成立且單元測試極易 mock，成本只有一個 `@abstractmethod`。

#### 台灣的 locations 是 20 個前綴，涵蓋 22 個縣市

實測 MoC 資料（category 1/6/17 共 1320 筆 showInfo）：`宜蘭縣` 有 9 筆，
但既有 `data.py` 的清單裡沒有宜蘭，使用者永遠選不到。連江同樣缺漏。
清單必須涵蓋全部 22 個縣市。

**但清單的長度是 20 不是 22。** 新竹市與新竹縣共用 `新竹` 這個前綴，
嘉義市與嘉義縣共用 `嘉義`，所以 20 個前綴涵蓋 22 個縣市。
測試斷言的數字是 20，測試名稱要寫成
`test_location_prefixes_cover_22_counties`，不要寫 `test_location_count_is_twenty`。
把「22」當成清單長度會讓人補上新竹市與嘉義市，弄壞三處斷言加一個 checkpoint。

#### 上游回應必須先確認是 list

`response.json()` 只保證是合法 JSON，不保證是陣列。政府 open data 改版包一層
`{"data": [...]}`、或維護頁回 `{"message": "..."}` 帶 HTTP 200，都會讓
`for item in payload` 拿到 `str`，`item.get(...)` 拋 `AttributeError`。
`AttributeError` 不是 `UpstreamError`，view 的 `except UpstreamError` 接不到，
使用者拿到 500 而不是設計好的 502，而且上游健康訊號完全沒動。

`payload = response.json()` 的下一行就要 `if not isinstance(payload, list): raise UpstreamError(...)`，
而且解析迴圈本身要 `except (AttributeError, TypeError)` 轉成 `UpstreamError`。
這正是 §3.4 的格式漂移訊號要抓的東西，不補的話它會從網子裡漏出去。

#### 地名比對前必須做異體字正規化

實測同一批資料：`台北市` 有 11 筆，其餘寫 `臺北市`。
`location in e.location` 是字面 substring 比對，使用者選「臺北」時那 11 筆被靜默丟掉。
過濾前把查詢值與資料值都做一次 `replace("台", "臺")` 再比對。
使用者看到的失敗是「查無結果」，與真的沒活動長得一模一樣，是最難被回報的一種 bug。

### 3.3 Cache (cache-aside)

- 用 Django cache framework (`django.core.cache`)，業務 code 只碰 `cache.get/set`。
- Key：`events:{country}:{category}`；TTL：12 小時 (`43200` 秒)。
- MoC API 只按 category 查詢（location/月份是本地過濾）。「每 12 小時最多打 12 次上游、
  跨 user 共用」是 best-effort 上界，不是硬保證：LocMemCache 是 per-process 記憶體。
  故 prod 用 `--workers 1`；Render free 本身就只能跑單一 instance（不能 scale），
  所以平台側不用另外設定。
- **`--workers 1` 必須搭配 `--threads 8 --worker-class gthread`。**
  gunicorn 預設是 sync worker，一個 worker 一次只吃一個 request。cache miss 時
  `requests.get(timeout=15)` 會佔住整個 process，這段期間靜態檔、`/health`、
  其他人的搜尋全部排隊；排到超過 gunicorn 的 request timeout 時 worker 被 kill，
  LocMemCache 整個歸零，本節的上界假設就在流量最高的時候破功。
  gthread 仍是單一 process，LocMemCache 只有一份，前提不變。
  `--timeout` 要設得比上游的 15 秒大（用 60）。
- cache-aside 的 check-then-set 無 lock，冷啟動瞬間並發仍可能對同一 category 重複打上游：屬可接受取捨（MoC 免費、不影響正確性），不加 lock 以維持 code 簡單。
- **失敗也要進 cache（negative caching），TTL 60 秒。** 只在成功時寫 cache 的話，
  上游持續失敗期間**每一個 request 都會重打一次 15 秒的上游**，八個 thread 全部
  停在那裡，正是本節加 gthread 要避免的狀況，而且是在上游最虛弱的時候加倍打它。
  失敗時寫一個短 TTL 的失敗標記，60 秒內的後續請求直接回 502 不再打上游。
  60 秒夠短，上游恢復後最多一分鐘就會重試。
- 已知限制：spin down（Render free 閒置 15 分鐘）時 cache 消失：可接受。未來接付費 API 時僅改 settings
  換持久 backend，業務 code 不動。
- **Cloud Run 上此上界僅在 `--max-instances=1` 時成立**（見 §6.6）。

#### 月份過濾必須用區間重疊判斷

API 收 ISO `month=2026-07`，MoC 的 `show['time']` 是 `YYYY/MM/DD HH:MM:SS`，
兩者格式不同，比對前必須轉換。**但只轉換格式是不夠的。**

實測 MoC `category=6`（展覽）：439 筆 showInfo 裡 **386 筆跨月**（88%），
`endTime` 一筆都沒缺，最長的是 `2026/01/01 → 2026/12/31` 的常設展。
若只比對 `start_time` 的年月，這類活動在開幕月之後的每一個月都查不到，
等於展覽這個類別整個是壞的。

正確條件是區間重疊：活動的 `[start, end or start]` 與查詢月的 `[月初, 下月初)`
有交集就算命中。

測試必須涵蓋：一個 1 月開跑、12 月結束的活動，查 9 月要查得到。

### 3.4 Observability

- **Logging 用 owner 自有套件 `toolkitsy`**：
  `from toolkitsy.logger import logger, configure, set_correlation_id`。
  settings 啟動時 `configure()`（console only）；
  CorrelationIdMiddleware 每個 request 設 correlation id + 回 `X-Request-ID` header。
- **不做 `/health/upstream`。** v4 的設計是 provider 失敗時寫一個 cache 旗標、
  開一個 endpoint 讀它、監控指向那個 endpoint。這個設計的前提不成立，理由有三個，
  任一個都足以讓它永遠回綠燈：
  1. 旗標只在 cache **miss** 的路徑上被寫，也就是只有真人搜尋才會動。
     沒人搜的時段，MoC 掛掉不會留下任何痕跡。
  2. 旗標放在 LocMemCache，而服務閒置 15 分鐘就 spin down。服務一停旗標就消失，
     重啟後必然是「乾淨」狀態，與上游實際健康無關。
  3. 監控每次去讀的是一個唯讀的 cache view，它自己從不碰 MoC。
     所以這個「上游監控」整條鏈路裡沒有任何一段真的接觸上游。

  取代方案：**uptime 監控直接打一個真實的搜尋 URL**
  （`/api/v1/tw/events?category=6&location=臺北&month=<當月>`），
  對 HTTP 502 或 `"events": []` 告警。它會真的走完 provider、真的碰到 MoC，
  而且順便證明過濾邏輯還活著。頻率見 §6.5 的監控設定。
- **格式漂移的 sanity 訊號**：一次 fetch 若 raw payload 非空但 parsed events 為 0，
  先 `logger.error` 再拋 `UpstreamError`。MoC 改欄位名時 HTTP 仍是 200、mock 仍全綠，
  這個訊號是唯一會亮的東西。**順序不可以顛倒**：v4 的 code 直接 raise 沒有 log，
  等於這個「唯一會亮的東西」一行紀錄都不會留下。
- **每個查詢回應都帶 `meta`（§3.1）。** 這是取代旗標的事後診斷手段：
  不需要 log 保留期，也不需要監控，owner 一個 curl 就分得出上游問題與自己的問題。
- **已知限制**：Render 的 log 只保留 7 天。`X-Request-ID` 在 7 天內可以拿去
  Render dashboard 的 Logs 搜尋，超過 7 天就查不到。README 要寫明這個期限，
  不要讓那個 header 看起來像永遠可以追查的東西。
- **correlation id 在 `--threads 8` 下必須先驗過。** 八個 request 共用一個 process，
  `toolkitsy.logger.set_correlation_id` 若用 module global 而非 `contextvars`
  或 `threading.local`，log 會互相錯掛，而且錯掛比沒有 id 更糟。
  後端 checkpoint 要跑一次 `inspect.getsource` 確認它用的是哪一種，
  確認不了就不要裝這個 middleware。

## 4. 前端設計

- **Vite + React + TypeScript**：型別寫到夠用，不用進階泛型、不用 Redux、不用 server components。
- **Tailwind CSS**：mobile-first utility，搭配 `design.css` 的 CSS variables（見 §4.1）。
- **i18n**：UI 文案走 `locales/zh.json` / `en.json` + 一個輕量 context/hook
  （不引重型 i18n 套件），預設中文。活動資料維持資料源語言。
  切換語言時同步設定 `document.documentElement.lang`（`zh-Hant` / `en`）。
- **不用 react-router**：只有搜尋頁和 About 兩個畫面，用 in-app state 切換。
  但 `config/urls.py` 仍要有一條 catch-all 把非 `/api`、非 `/static`、非 `/health`
  的路徑導回 `index.html`，否則打錯字的網址會拿到 Django 的裸 404 純文字頁，
  使用者會以為站掛了。
- 頁面結構（依定案 POC `docs/poc/20261004_213658_ui_design_v28.html`）：
  - **背景場景**：深色 radial-gradient 底 + 抽象曲線 SVG 線稿（低透明度、
    bronze/cyan 漸層描邊）+ 雙色燈光 (`--lamp-1` 暖銅、`--lamp-2` 冷青) +
    兩顆跨面板光暈 (bronze/cyan)，是毛玻璃 blur 的視覺素材
  - **導覽**：桌機左側毛玻璃 icon rail（搜尋/關於/主題切換/語言切換）；
    手機隱藏 rail，改頂部毛玻璃 bar。**手機 bar 必須含語言切換**，
    四顆 `h-9 w-9` 按鈕在 375px 放得下（標題 `flex-1` 會自動縮）
  - **國家選擇器**：搜尋卡標題列右上角，膠囊容器內：台灣是 active
    (`.btn-primary`) chip；日本/韓國是 `opacity-60` chip（不帶「即將推出」文字，
    純用視覺降權表示未開放）。用 `aria-disabled` + onClick 攔截取代 `disabled`，
    並補 `title` / `aria-label`，讓鍵盤與螢幕閱讀器接收得到「未開放」這個訊息
  - **搜尋列**：Airbnb 風格「搜尋膠囊」(`.search-capsule`)：地區、類別、年、月四個
    `search-field`（label 在上、`<select>` 在下，欄位間以 `border-right`/`border-bottom`
    分隔），尾端一個圓形/膠囊搜尋鈕。月份維持年 + 月兩個 `<select>`；刻意不用
    `<input type="month">`：桌面版 Firefox 與 Safari 全版本不支援，會 fallback 成純文字框
  - **類別 chips**：`地區/類別/年/月` 之外另有一列**四個**帶 icon 的類別快捷 chip
    （展覽 6 / 戲劇 2 / 音樂 1 / 演唱會 17，各配一個 inline SVG icon：frame/masks/music/tent）。
    POC 的第四個是「市集」，但 MoC 沒有市集類別（v1 `data.py` 的 12 類裡沒有，category 17
    於 2026-10-04 實測是演唱會），所以第四個 chip 改成演唱會，沿用帳篷 icon，
    數量對齊 POC，不渲染全部 12 個類別（12 個 chip 在手機上會換三行、佔滿第一屏）。
    chip 與類別 `<select>` 是同一個 `value.category` 的兩個入口：
    select 是慢速精確設定，**chip 點下去直接觸發搜尋**（快捷就要一步到位，
    只改 state 不重搜會讓使用者以為篩選壞了）。兩者都要 `aria-pressed`
  - **結果**：卡片式列表：漸層 banner + 白色線條幾何裝飾（三組輪流，hover 時
    banner SVG 有 1.5s 慢速 zoom 動效）、活動名稱（hover 變 accent 色）、檔期時間、
    地點（點擊開 Google Map，新分頁，組裝 URL 時地點需做 `encodeURIComponent`，避免地址包含 `&` 或 `#` 等特殊字元損壞外連）、卡片底部一條分隔線後放票價 + 一個連往
    Google 搜尋的按鈕（活動名稱同樣需 `encodeURIComponent`）；手機單欄、桌機三欄 grid。狀態 badge 文案含裝飾性 emoji
    （「🔥 熱賣中」，owner 已於 2026-08-22 確認保留）
  - **同 (title, location) 聚合多場次**：當活動有多場次時，卡片日期展示總檔期（例如 `2026/10/10 – 10/24`），日期右側展示 `N 場次 ▾` 按鈕，點擊彈出毛玻璃 Modal 依日期分組檢視完整時段，卡片本體維持簡潔，不被密集的時段框洗版。
  - **卡片的時間必須顯示區間，不是只有 `startTime`。** 後端整節 §3.3 在打
    區間重疊比對的仗，`endTime` 也一路傳到前端的型別裡，卡片只 render `startTime`
    等於把區間丟掉。展覽有 88% 跨月，使用者查九月會看到每一張卡都寫「01/01」，
    合理判斷這個站的資料是舊的。同月顯示 `07/12 19:30 – 07/14`，
    跨月顯示 `2026/01/01 – 2026/12/31`，`endTime` 為 `null` 時只顯示開始時間
  - **票價是自由文字，不可以直接前綴 `$`。** MoC 那一欄實際會出現
    「洽詢主辦單位」「0」「免費」。純數字才加 `$`，`0` 顯示成「免費」，
    其餘原樣顯示不加前綴
  - **結果計數列顯示完整條件**（「臺北 · 音樂 · 2026/07 共 12 筆」）。
    預設類別是 provider 的第一個類別而不是「全部」，MoC 也沒有 all-category 查詢能力，
    條件不顯性寫出來的話使用者會誤以為看到的是全類別
  - **Loading**：skeleton 卡片（`--skel` 變數，雙主題各自可見，含分隔線 + 票價列 skeleton）
  - **四種狀態都要有畫面**：`idle` / `loading` / `empty` / `error`。
    `idle` 不可以是一片空白，否則使用者一進站看不出要按搜尋鈕，
    也分不出「還沒搜」與「查無結果」。空結果與錯誤各配一個大型線條 SVG 插圖，
    外層加虛線邊框容器 (`border-dashed`) 與 `--surface-2` 底色；錯誤畫面附重試按鈕
  - **空結果的文案叫使用者做什麼，那個東西就必須存在。** v4 的文案寫
    「或者清除篩選條件重新搜尋」而 `SearchForm` 裡沒有任何清除鈕。
    空結果是冷門搜尋最常見的結果，所以這是全站最多人會讀到的一段字。
    兩條路擇一：`SearchForm` 真的加一顆「重設」鈕（把四個欄位回到預設值），
    或把文案改成「換個地區或月份再試一次」。**選加鈕**，因為手機上
    重設四個 `<select>` 要點八下
  - **loading 超過 8 秒要換一段文案。** cache miss 加上 15 秒的上游 timeout，
    最壞情況是 15 秒的骨架動畫配一片安靜。8 秒後把 skeleton 上方的文字換成
    「第一次查詢比較慢，正在向文化部要資料」，讓使用者知道站沒死。
    不做取消鈕（多一個狀態要管），但這段文案不可省。
    （注意：Render 冷啟動喚醒的那 1 分鐘，使用者看到的是 Render 自己的原生 loading 頁，
    本站的 8 秒文案是在進站後的搜尋等待時生效）
  - **API 回應錯誤與非 JSON 時需有統一錯誤分類，分出「可重試」與「不可重試」。**
    分頁開著超過 15 分鐘再按搜尋，服務若已 spin down，`fetch` 打到的是喚醒中的服務，
    可能拿到 Render 的 HTML 錯誤/喚醒頁面而不是 JSON：
    1. **可重試 (TransientError)**：包含 HTTP 502/503、網路斷線/逾時、非預期 HTML 回應（`res.json()` 解析失敗）。
       UI 顯示「連線逾時或服務喚醒中，請稍候再試」，並附「重試」按鈕。
       **絕不可將非 JSON 或 503 逕行顯示為「文化部資料庫故障」**，避免誤導排查與使用者。
    2. **文化部上游故障 (UpstreamError)**：後端明確回傳 502 且 JSON payload 為 upstream error 時，
       才顯示「文化部資料來源暫時無法使用，請稍後再試」，並附「重試」按鈕。
    3. **不可重試 (ClientError)**：HTTP 400（參數無效）或 404（不支援國家），
       顯示輸入驗證提示，不提供無效的重試按鈕。
    Phase 5 驗收要實測一次非 JSON 回應情境（§8.2）
  - **About 頁**：合併原 tech_stack 頁內容（tech stack 表 + 作者連結），同樣走毛玻璃面板
- **視覺方向（已凍結，POC v28）**：毛玻璃 (glassmorphism)。深色抽象背景
  (`radial-gradient(circle at 80% 20%, #1e1812 0%, #05070f 65%)`)；
  accent 是單一 copper/ochre 色系 `#B57004`（`--accent-cool: #7a4700` →
  `--accent: #B57004` 漸層）；**不用粉紅/magenta**；
  dark/light 雙主題由 CSS variables（`[data-theme]`）驅動，兩個主題都必須是
  真正透亮的毛玻璃，不是換色而已。

### 4.1 視覺 source of truth

**唯一的視覺 source of truth 是 `docs/poc/20261004_213658_ui_design_v28.html`。**
POC gate 於 2026-10-04 通過（多場次聚合卡片與 Modal 定案）。
POC 保留在 `docs/poc/` 作 design reference，不是丟棄式產物。

寫 React 元件時對照該檔抄 CSS 與 Tailwind class 組合：

- `<style>` 區塊整段抄成 `frontend/src/design.css`（CSS variables、`.scene`/`.glass`/
  `.search-capsule`/`.btn-primary`/`.btn-secondary` 等）
- inline SVG icon 抄成 `Icon.tsx` 元件，不引 icon library。
  **只抄實際會用到的九個**：search / info / moon / sun / calendar / pin / ticket / refresh / close，
  加上四個類別 chip 用的 music / tent / masks / frame，共 13 個。
  `alert` 不需要（ErrorMessage 用自己的 inline path）

毛玻璃四要件（POC 迭代驗證出的經驗值，改 CSS 時不可破壞）：

1. 玻璃後方要有結構化視覺素材（抽象曲線 SVG + 雙色燈光）可供 blur 扭曲
2. 面板填色極低不透明度（dark 2%／light 55%）、blur 為 **36 到 40px**、
   `brightness(>1)` 讓面板比周圍亮
3. `::after` 斜向 sheen 高光，light/dark 各自獨立調校
4. 彩色光暈要**跨越玻璃面板邊界**（外側銳利、內側模糊）

### 4.2 前端的三個隱含前提

這三項不寫下來的話，實作時會踩到而且不容易連結到原因：

1. **時間一律用本地時區。** 後端 `TIME_ZONE = "Asia/Taipei"`、`USE_TZ = True`（以 repo 現況為準）；
   MoC 的時間字串本身就是台灣時間，後端不做時區轉換、原樣傳給前端。前端取預設月份**不可以用 `toISOString()`**，那是 UTC，
   台灣時間每月 1 號 00:00 到 08:00 之間會抓成上個月，而且極難重現。
   用 `getFullYear()` + `getMonth()+1` 組字串。
2. **`tsconfig.app.json` 要開 `resolveJsonModule`。** Vite 的 react-ts template
   預設沒開，`import zh from "./locales/zh.json"` 會讓 `tsc --noEmit` 直接失敗。
3. **Vite proxy 不設 `changeOrigin`。** 預設 `false` 時轉發保留 Host
   `127.0.0.1:8790`，Django 去掉 port 後剛好落在 `ALLOWED_HOSTS` 裡。
   哪天有人加上 `changeOrigin: true`，Host 變成 `backend`，所有 `/api` 立刻 400，
   而且只在 dev 出現、看起來像後端壞了。dev compose 的 backend 同時把
   `backend` 加進 `ALLOWED_HOSTS`，兩種寫法都涵蓋。

### 4.3 可測性與 a11y 的最低要求

> **範圍決策（Owner 於 2026-10-02 確認）**：本節所有可測性與 a11y 規範皆為 MVP 必備品質要求，不拆分延後，全數在 Phase 3 前端開發時一次落實到位。

- **有分支的邏輯抽成純函式放 `utils/`**，配 vitest。目前有三處：
  年月字串切片重組、切國家時重設 location/category、多場次時間聚合與格式化。元件本身不寫 render test。
- **`data-testid` 只加在關鍵節點**：搜尋鈕、類別 chip 列容器、結果 grid、
  四種狀態容器、多場次 Modal。其餘不鋪。
- **focus 樣式不可以只有 `outline: none`。** 必須補
  `:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }`，
  否則鍵盤 Tab 時完全看不到焦點在哪。
- **`appearance: none` 拿掉原生下拉箭頭後必須補 chevron**（`::after` 純 CSS 即可），
  否則四個欄位在視覺上是純文字，看不出可以點。
- **結果區要有 live region**：EventList 與空結果容器加 `role="status"`，
  loading 的 grid 加 `aria-busy="true"`。否則螢幕閱讀器使用者按下搜尋後
  沒有任何播報，會以為按鈕沒作用。
- **主題要持久化**：`useState` 用 lazy initializer 讀 `localStorage`，
  讀不到就看 `prefers-color-scheme`；effect 裡寫回 `localStorage`。
  同時在 `index.html` 的 `<head>` 放三行 inline script 先設好 `data-theme`，
  這是避免 FOUC 唯一可靠的做法。
- **語言也要持久化，做法與主題完全一樣。** lazy initializer 讀 `localStorage`，
  讀不到才看 `navigator.language`。
- **搜尋要能被取消，否則兩次搜尋會互相蓋掉。** `api.ts` 已經收 `AbortSignal`。每次搜尋開一個 `AbortController`，
  新的搜尋先 abort 舊的，`AbortError` 不寫 state。
- **切換畫面要進 history，否則手機的返回鍵會直接離站。** About 頁與 Modal 用 `history.pushState` 加 `popstate` listener。
- **重試按鈕要接對對象**：初次載入 `/countries` 失敗時 `form.country` 是空字串，
  若重試接的是搜尋，會打 `/api/v1//events` 而永遠失敗。錯誤來源要分開記，重試依來源決定重載 countries 或重搜。
- **countries 載入完成前送出鈕要 disabled**。
- **每個畫面都要有一個 `<h1>`，而且不能被關在某一個分支裡。** `<h1>` 要放在 `view` 判斷之外。
- **圖示按鈕與有文字的按鈕，`aria-label` 規則是相反的。** 純 icon 的按鈕必須補 `aria-label`。有可見文字時就讓文字當 accessible name。
- **外連一律 `rel="noopener noreferrer"`。**
- **選項比對前先轉字串。** 兩邊都套 `String()` 再比。

## 5. 開發環境

### 5.1 dev 走 docker-compose（兩個 service）

- `deployment/dev/docker-compose.yml` 起兩個 service：
  - `backend`：Django `runserver 0.0.0.0:8789`，Dockerfile 是 `deployment/dev/backend.Dockerfile`
  - `frontend`：Vite dev server，port 8790，`server.proxy` 把 `/api` 轉發到 `backend:8789`，
    Dockerfile 是 `deployment/dev/frontend.Dockerfile`
- port 選 8789 / 8790，container 內外同號。
- compose 檔在子目錄，相對路徑一律從 `deployment/dev/` 算。
- compose 檔頂層寫 `name: culture_event_finder_v2`。
- 一律透過 makefile 啟動。
- backend 的 venv 放在 bind mount 之外（`/opt/venv`）。
- bind mount 原始碼，named volume 隔離 `node_modules`。
- `server.host: '0.0.0.0'`，`CHOKIDAR_USEPOLLING=true`。
- container 內跑 non-root user。
- backend service 加 `user: "${HOST_UID:-1000}:${HOST_GID:-1000}"`。

### 5.2 host 也要裝一份 node_modules（給 IDE 用）

host 另跑一次 `npm ci`，提供 `make install-host`。

### 5.3 named volume 會 stale，要有 reset 出口

提供 `make dev-reset`（`down -v` 後重建）。

### 5.4 dev 常用指令

由 makefile 提供：`make dev`、`make dev-reset`、`make install-host`、`make test-backend`、`make test-frontend`、`make test`、`make run-prod`。

## 6. 部署

### 6.1 Phase 5 目標平台：Render free web service

| 項目 | 值 | 理由 |
|---|---|---|
| Runtime | Docker，Dockerfile Path 填 `deployment/prod/Dockerfile`；Docker Build Context Directory 留空 | 留空時 Render 用 repo root 當 context，正是 Dockerfile 需要的（§2） |
| Instance type | Free | 不用綁卡；512 MB RAM、0.1 vCPU |
| Region | Singapore | 離台灣最近 |
| Health Check Path | `/health` | 新版沒通過 check 就不切流量 |
| Auto-Deploy | After CI Checks Pass，branch `master` | CI 紅燈不部署；亦可設為手動以省 build 配額 |
| 環境變數 | `SECRET_KEY`、`ALLOWED_HOSTS` | §11，`ALLOWED_HOSTS` 填 dashboard 實際分配之網址 |

Free instance 限制：15 分鐘 spin down、每月 750 free instance hours、每月 500 分鐘 build 時間、每月 5 GB 出站流量、ephemeral filesystem、單 instance、無 shell。

Multi-stage Dockerfile (`deployment/prod/Dockerfile`)：
stage 1 (`node:22-slim`) `vite build` → stage 2 (`python:3.13-slim`) Django + gunicorn + WhiteNoise。

collectstatic 帶 build-only 假值：
```dockerfile
RUN SECRET_KEY=build-only-not-used ALLOWED_HOSTS=build-only \
    python backend/manage.py collectstatic --noinput
```

CMD shell 形式：
```dockerfile
CMD exec gunicorn --chdir backend config.wsgi:application --bind 0.0.0.0:${PORT:-8080} --workers 1 --threads 8 --worker-class gthread --timeout 60
```

### 6.2 CI/CD

GitHub Actions 三個 job：`test-backend`、`test-frontend`、`build-smoke`。
沒有 deploy job，交給 Render Auto-Deploy。

### 6.3 依賴管理單一來源：uv

`pyproject.toml` + `uv.lock`。無 `[build-system]`。

### 6.4 branch 策略

Phase 5 前直接在 master 開發。

### 6.5 上線、rollback、關掉 v1

v2 上線一週後依清單關閉 v1。監控每 30 分鐘打真實搜尋 URL，以 `jq -e '.events | length > 0'` 嚴格驗證。

### 6.6 Phase 6：遷移 Cloud Run（另開 branch）

Terraform 管理 infra，CI build image 後部署。

## 7. 從 v1 移植的清單

| v1 檔案 | 移植到 | 拿什麼 |
|---|---|---|
| `main_project/culture/data.py` | `backend/events/providers/taiwan.py` | Location 與 EventCategory 清單，補上宜蘭與連江（§3.2） |
| `main_project/culture/views.py` | `backend/events/providers/taiwan.py` | MoC API URL、query 參數、SSL `verify=False` |
| `main_project/tech_stack/templates/tech_stack.html` | `frontend` 的 About 頁 | tech stack 表的內容與作者連結 |
| `main_project/health_check/` | `backend/health/` | `/health` 回 200 |

## 8. 測試策略

後端 pytest（provider mock、services 區間重疊、端到端 responses 測試、API 合約）、前端 Vitest（日期格式化、多場次聚合、純函式）、Phase 4 本機 container smoke test。

## 9. 里程碑

```
Phase 0：規劃 ✅（2026-10-04 改版 v8 定稿）
Phase 1：骨架先立好 ✅（T1~T4 完成）
Phase 2：後端 ✅（T5~T7 完成）
Phase 3：前端 ✅（T8~T11 完成）
Phase 3.5：活動卡片聚合與多場次 Modal（Task 12）
Phase 4：prod image 與文件（Task 13, 14）
Phase 5：上 Render 與監控（Task 15, 16, 17）
Phase 6：遷移 Cloud Run（另開 branch）
Phase 7：k8s（另開 branch，學習用）
```

## 10. 風險與已知取捨

見全文 §10 各項細節。

## 11. 環境變數

| 變數 | 設在哪 | 誰用它 | 沒設會怎樣 |
|---|---|---|---|
| `SECRET_KEY` | prod：Render dashboard；build：collectstatic 假值；test：makefile 與 CI | Django | 非 dev 時啟動即 `ImproperlyConfigured` |
| `ALLOWED_HOSTS` | prod：Render dashboard；build 與 test 同上 | Django | 非 dev 時啟動即 `ImproperlyConfigured` |
| `DEBUG` | dev：`deployment/dev/docker-compose.yml` | Django | 預設走 prod 分支 |
| `PORT` | 平台注入或預設 8080；dev backend 8789 / frontend 8790 | gunicorn / Vite | 不會沒設 |
| `UV_PROJECT_ENVIRONMENT` | `deployment/dev/backend.Dockerfile` | uv | venv 落在 bind mount 內被 host 覆蓋 |
| `HOST_UID` / `HOST_GID` | dev：Makefile 帶入 | container non-root user | Linux host 權限問題 |

## 12. Owner 定案之設計與架構決策

1. **Provider ABC 骨架保留**
2. **前端 20 項可測性與 a11y 規範全部實作**
3. **v1 舊站獨立，不侵入修改**
4. **活動卡片依 (title, location) 聚合，附多場次 Modal（v8 決策）**
