# Culture Event Finder：React + Django API 重構設計 v7

- 日期：2026-10-04
- 狀態：owner 於 2026-10-02 批准方向並通過 Review-Crew 審查（定案 3 項決策：保留 Provider ABC 擴充骨架、前端 20 項需求全做、v1/v2 彼此獨立不侵入修改 v1）；2026-10-04 owner 定案部署檔案集中於 `deployment/`、dev port 改為 backend 8789 / frontend 8790
- 取代：`2026-10-02-culture-event-finder-design-v6.md`（v6 標記 SUPERSEDED）
- 前身：`taiwan_culture_event_info_django_jinja2`（Django + Jinja2 server-rendered，
  另一個 repo，現役跑在 Fly.io app `taiwan-culture-event-info`）
- 本 repo：`culture_event_finder_v2`（全新 repo，從零開始，不搬 v1 的 git歷史）

> 本文件自足。執行時不需開啟 v1 到 v6。需要 v1 的程式碼時，只看 §7 列出的檔案。

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
│       │                        # LanguageSwitch, About
│       ├── design.css           # 毛玻璃 design system（從 POC v27 抽出）
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
    → { "events": [ { "id", "title", "startTime", "endTime", "location",
                      "locationName", "onSales", "price" } ],
        "meta": { "rawCount", "matchedCount", "cacheAge" } }
      id 是 "<MoC UID>-<第幾場>"；onSales 是 boolean（MoC 的 "Y" 才是 true）；
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
- 頁面結構（依定案 POC `docs/poc/20260719_155200_ui_design_v27.html`）：
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
    banner SVG 有 1.5s 慢速 zoom 動效）、活動名稱（hover 變 accent 色）、時間、
    地點（點擊開 Google Map，新分頁，組裝 URL 時地點需做 `encodeURIComponent`，避免地址包含 `&` 或 `#` 等特殊字元損壞外連）、卡片底部一條分隔線後放票價 + 一個連往
    Google 搜尋的按鈕（活動名稱同樣需 `encodeURIComponent`）；手機單欄、桌機三欄 grid。狀態 badge 文案含裝飾性 emoji
    （「🔥 熱賣中」，owner 已於 2026-08-22 確認保留）
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
- **視覺方向（已凍結，POC v27）**：毛玻璃 (glassmorphism)。深色抽象背景
  (`radial-gradient(circle at 80% 20%, #1e1812 0%, #05070f 65%)`)；
  accent 是單一 copper/ochre 色系 `#B57004`（`--accent-cool: #7a4700` →
  `--accent: #B57004` 漸層）；**不用粉紅/magenta**；
  dark/light 雙主題由 CSS variables（`[data-theme]`）驅動，兩個主題都必須是
  真正透亮的毛玻璃，不是換色而已。

### 4.1 視覺 source of truth

**唯一的視覺 source of truth 是 `docs/poc/20260719_155200_ui_design_v27.html`。**
POC gate 於 2026-07-19 通過（owner 迭代 27 版後口頭定案，未另交付截圖）。
POC 保留在 `docs/poc/` 作 design reference，不是丟棄式產物。

寫 React 元件時對照該檔抄 CSS 與 Tailwind class 組合：

- `<style>` 區塊整段抄成 `frontend/src/design.css`（CSS variables、`.scene`/`.glass`/
  `.search-capsule`/`.btn-primary`/`.btn-secondary` 等）
- inline SVG icon 抄成 `Icon.tsx` 元件，不引 icon library。
  **只抄實際會用到的八個**：search / info / moon / sun / calendar / pin / ticket / refresh，
  加上四個類別 chip 用的 music / tent / masks / frame，共 12 個。
  `alert` 不需要（ErrorMessage 用自己的 inline path）

毛玻璃四要件（POC 迭代驗證出的經驗值，改 CSS 時不可破壞）：

1. 玻璃後方要有結構化視覺素材（v27 是抽象曲線 SVG + 雙色燈光）可供 blur 扭曲
2. 面板填色極低不透明度（dark 2%／light 55%）、v27 blur 為 **36 到 40px**、
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

- **有分支的邏輯抽成純函式放 `utils/`**，配 vitest。目前有兩處：
  年月字串切片重組、切國家時重設 location/category。元件本身不寫 render test。
- **`data-testid` 只加在四個關鍵節點**：搜尋鈕、類別 chip 列容器、結果 grid、
  四種狀態容器。其餘不鋪。不加的話可用的 selector 只剩 i18n 文字
  （切 EN 就全掛）或 Tailwind 動態 class（chip active 會整串換掉）。
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
- **語言也要持久化，做法與主題完全一樣。** v4 只持久化了主題，`lang` 是裸的
  `useState<Lang>("zh")`。看英文的朋友每次進站都要重切一次，而且他不會知道
  這個站記得住主題卻記不住語言。lazy initializer 讀 `localStorage`，
  讀不到才看 `navigator.language`。
- **搜尋要能被取消，否則兩次搜尋會互相蓋掉。** `api.ts` 已經收 `AbortSignal`，
  但 v4 的 `handleSearch` 從來沒傳。類別 chip 是直接觸發搜尋的（見上面的
  「類別 chips」），所以「點展覽（cache miss，最多 15 秒）再點音樂（cache hit，
  200 毫秒）」是一根手指就會走到的路徑：音樂先渲染，展覽後到把畫面換掉，
  而音樂的 chip 還亮著。每次搜尋開一個 `AbortController`，
  新的搜尋先 abort 舊的，`AbortError` 不寫 state。
  `loadCountries` 已經是這個寫法，照抄即可。
- **切換畫面要進 history，否則手機的返回鍵會直接離站。** `view` 是純 state，
  About 頁按返回等於離開網站。這與 §1 排除的 shareable URL 是兩件事：
  那個排除的是把搜尋條件寫進網址，這裡要的只是 `history.pushState` 加一個
  `popstate` listener，兩行。
- **重試按鈕要接對對象**：初次載入 `/countries` 失敗時 `form.country` 是空字串，
  若重試接的是搜尋，會打 `/api/v1//events` 而永遠失敗，使用者按幾次都一樣、
  下拉選單全空無法自救。錯誤來源要分開記，重試依來源決定重載 countries 或重搜。
- **countries 載入完成前送出鈕要 disabled**，否則網路慢時先按下去會打出雙斜線 URL。
- **每個畫面都要有一個 `<h1>`，而且不能被關在某一個分支裡。** v4 的桌機 `<h1>`
  只寫在搜尋分支內、手機的那個是 `sm:hidden`，所以桌機開 About 頁時整份 DOM
  最高只到 `<h2>`。`<h1>` 要放在 `view` 判斷之外。
- **圖示按鈕與有文字的按鈕，`aria-label` 規則是相反的。** 純 icon 的按鈕
  （主題、搜尋、關於）必須補 `aria-label`。但語言切換鈕看得到的字是 `EN` 或 `中`，
  再掛一個「切換語言」的 `aria-label` 會讓兩者毫無交集，語音控制使用者說
  「click EN」點不到（WCAG 2.5.3 Label in Name）。有可見文字時就讓文字當
  accessible name，不要另外掛 label。
- **外連一律 `rel="noopener noreferrer"`。** 現代瀏覽器的 `noreferrer` 已隱含
  `noopener`，但舊的內嵌 webview 不一定，而補上去成本是零。
- **選項比對前先轉字串。** `LabeledOption.value` 的型別是 `string | number`，
  而類別快捷 chip 硬寫的是 `number`。後端哪天把 value 序列化成字串，
  `c.value === q.id` 就整排 chip 靜默消失，沒有 error 也沒有 console warning。
  兩邊都套 `String()` 再比。

## 5. 開發環境

### 5.1 dev 走 docker-compose（兩個 service）

採市面主流配方，讓任何人 clone 下來跑 `make dev` 就有一致的環境：

- `deployment/dev/docker-compose.yml` 起兩個 service：
  - `backend`：Django `runserver 0.0.0.0:8789`，Dockerfile 是 `deployment/dev/backend.Dockerfile`
  - `frontend`：Vite dev server，port 8790，`server.proxy` 把 `/api` 轉發到 `backend:8789`，
    Dockerfile 是 `deployment/dev/frontend.Dockerfile`
- **port 選 8789 / 8790，container 內外同號。** v1 用掉 8787（web）與 8788（ngrok），
  v2 接著往下編，v1 與 v2 可以同時在本機跑不撞 port。不用 Django 預設的 8000
  與 Vite 預設的 5173，避免和其他專案撞。container 內外用同一個數字，
  看到 port 就知道是誰，不用記對照表。
- **compose 檔在子目錄，相對路徑一律從 `deployment/dev/` 算。** compose 的 `build.context`
  與 volume 的相對路徑是相對 compose 檔所在目錄，不是相對執行指令的目錄。
  所以 context 寫 `../..`，bind mount 寫 `../..:/app`。寫成 `.` 的話 context 會變成
  `deployment/dev/`，`COPY pyproject.toml` 直接找不到檔案。
- **compose 檔頂層要寫 `name: culture_event_finder_v2`。** 沒寫的話 project name 取
  compose 檔所在目錄名，也就是 `dev`。container 會叫 `dev-backend-1`、named volume
  會叫 `dev_frontend_node_modules`，任何其他也把 compose 放在 `dev/` 的專案都會跟它撞名，
  `make dev-reset` 的 `down -v` 可能刪到別人的 volume。
- **一律透過 makefile 啟動。** compose 檔不在 root，直接打 `docker compose up`
  會找不到檔案。makefile 的 target 統一寫 `docker compose -f deployment/dev/docker-compose.yml ...`。
- **backend 的 venv 必須放在 bind mount 之外。** backend 掛 `../..:/app`，
  若 venv 建在 `/app/.venv`，host 的 macOS arm64 venv 會覆蓋 container 內的 linux venv，
  `uv run` 拿到錯的 python，或就地重建 venv 把 linux binary 寫回 host repo，
  反過來弄壞 host 的 IDE。`backend.Dockerfile` 設
  `ENV UV_PROJECT_ENVIRONMENT=/opt/venv` 與 `ENV PATH="/opt/venv/bin:$PATH"`。
- **bind mount 原始碼，named volume 隔離 `node_modules`**：若讓 host (mac ARM) 的
  `node_modules` 蓋掉 container (linux) 的，esbuild 等原生依賴會直接崩潰。
- **`server.host: '0.0.0.0'`**：否則 host 瀏覽器連不進 container 內的 Vite。
- **`CHOKIDAR_USEPOLLING=true`**：macOS/Windows 的 docker file-watching 事件不可靠，
  不開 polling 則 HMR 不會觸發。Vite 把 chokidar 3.6.0 bundle 進 dist，
  該版本確實讀這個環境變數，寫法有效。加 `CHOKIDAR_INTERVAL=1000` 降低 CPU 空轉。
- container 內跑 non-root user。
- Dockerfile 先 `COPY package.json package-lock.json`，再 `COPY` 其餘：吃 layer cache。
- **backend 的 `CMD` 直接跑 `python`，不經過 `uv run`。** `PATH` 已含 `/opt/venv/bin`。
  裸的 `uv run` 每次啟動都會重新 resolve 並 sync，而專案目錄是 bind mount 的 host repo，
  lock 只要稍微 drift，container 就會把 `uv.lock` 改寫回你的工作目錄；
  再加上 `user: HOST_UID` 時沒有可寫的 HOME 給 uv cache。prod 也是同樣做法。
- **non-root user 加 bind mount 在 Linux host 上會壞。** build 時的 `chown`
  被 runtime 的 mount 蓋掉，檔案樹仍屬於 host 的 UID，container 內的 `appuser`
  連 `__pycache__` 都寫不了。macOS 的 Docker Desktop 會假裝 ownership 所以本機測不出來。
  compose 的 backend service 要加 `user: "${HOST_UID:-1000}:${HOST_GID:-1000}"`，
  由 Makefile 在每個 compose 指令前帶入 `HOST_UID=$$(id -u) HOST_GID=$$(id -g)`。
  這一條直接關係到本節「任何人 clone 下來跑 `make dev` 就有一致環境」這個目的。
- **變數名不可以用 `UID` / `GID`。** `UID` 在 sh、bash、zsh 都是 shell 變數，
  沒有 export 給子程序，compose 讀不到，永遠落到預設值 1000。
  而且 macOS 的 `/bin/sh`（make 預設用的 shell）把 `UID` 設成唯讀，
  `UID=$$(id -u) docker compose ...` 會直接報 `UID: readonly variable`。
  實測過，換成 `HOST_UID` 兩個問題都沒有。

**已知取捨**：proxy 指向 Docker DNS 名稱 `backend:8789`，所以只能走 `make dev`，
不能在 host 上單獨 `npm run dev`（那樣 `/api` 代理不到）。

### 5.2 host 也要裝一份 node_modules（給 IDE 用）

因為 `node_modules` 被 named volume 隔離在 container 內，host 上不存在，
編輯器的 TS server / eslint / import 跳轉會全部失效。

解法（市面標準做法）：host 另跑一次 `npm ci`。

- host 那份**只給編輯器讀**，container 那份才是實際執行的
- 兩份吃同一個 `package-lock.json`，不會漂移
- makefile 提供 `make install-host` target，並在註解說明為何要裝兩份

### 5.3 named volume 會 stale，要有 reset 出口

`frontend_node_modules` 這顆 named volume 只在第一次建立時從 image 複製內容。
之後 `package.json` 改了、image 重 build 了，volume 裡仍是舊的，
`make dev` 加 `--build` 也救不回來。症狀是「image 裡有這個套件、container 裡沒有」。

makefile 提供 `make dev-reset`（`down -v` 後重建）。裝新套件之後跑它。

### 5.4 dev 常用指令

由 makefile 提供：`make dev`（起 compose）、`make dev-reset`、`make install-host`、
`make test-backend`、`make test-frontend`、`make test`、
`make run-prod`（本機 build & run production container）。

`make run-prod` 依賴 `deployment/prod/Dockerfile`，那是後面的 task 才產出的檔案；
makefile 定稿時要在該 target 註解說明，避免執行者撞牆後懷疑是自己漏做。

**`make test` 必須拆成 `test-backend` 與 `test-frontend` 兩個 target。**
v4 把兩者寫在同一個 target 裡，而 `frontend/` 要到前端 scaffold 那個 task 才存在。
在那之前 `make test` 會在 `cd frontend` 這一行直接 abort，
而 `make test` 正是 owner 唯一背下來的指令。`test` 呼叫另外兩個，
前端那半在 scaffold 之後才接進去。

## 6. 部署

### 6.1 Phase 5 目標平台：Render free web service

**首次建置與 Render 設定流程（dashboard 點一次，同一張表抄進 README）：**

1. **GitHub 授權**：Render 首次連結 GitHub 時，選擇僅授權存取本專案 repo（`culture_event_finder_v2`）。
2. **SECRET_KEY 產生**：本機執行 `python -c "from django.core.management.utils import get_random_secret_key; print(get_random_secret_key())"` 或 `openssl rand -hex 32` 產生安全隨機字串。
3. **先建服務獲取真實網址**：Render 的 subdomain 若被全域佔用，會自動加上後綴亂數（例如 `culture-event-finder-xxxx.onrender.com`）。**必須先在 Render 建立 Web Service，查看 dashboard 分配到的真實 URL，再將其填入 Environment 的 `ALLOWED_HOSTS`**，不可憑空臆測預填，否則 health check 會因 DisallowedHost 噴 400 導致部署被取消。

| 項目 | 值 | 理由 |
|---|---|---|
| Runtime | Docker，Dockerfile Path 填 `deployment/prod/Dockerfile`；Docker Build Context Directory 留空 | 留空時 Render 用 repo root 當 context，正是 Dockerfile 需要的（§2） |
| Instance type | Free | 不用綁卡；512 MB RAM、0.1 vCPU |
| Region | Singapore | 離台灣最近 |
| Health Check Path | `/health` | 新版沒通過 check 就不切流量（見下） |
| Auto-Deploy | After CI Checks Pass，branch `master` | CI 紅燈不部署（§6.2）；亦可依 build 配額策略設為手動 |
| 環境變數 | `SECRET_KEY`、`ALLOWED_HOSTS` | §11，`ALLOWED_HOSTS` 填 dashboard 實際分配之網址 |

Free instance 的限制（Render 官方文件查證核實）：

- **閒置 15 分鐘 spin down**：15 分鐘無 inbound 流量即休眠，下一個 request 喚醒約需 1 分鐘（期間 Render 顯示原生載入頁）。
- **每月 750 free instance hours**：每個 workspace 每月共 750 小時。**本 workspace 只放這一個 free 服務**，額度算法見 §6.5。
- **每月 500 分鐘 build 時間（Build Pipeline）**：所有 free 服務共用 500 分鐘/月。Docker 多階段 build（Node 22 + Python 3.13 + collectstatic）在 Render 每次耗時約 3~5 分鐘。若直接在 master 開發且每次 push 都觸發 build，約 100 次 commit 就會用盡配額導致當月無法部署。**對策**：非程式碼變更（如只改 docs/README）不觸發部署，或在密集開發期將 Auto-Deploy 設為手動，待階段功能完備再點擊部署。
- **每月 5 GB 出站流量（Outbound Bandwidth）**：超過後服務將強制暫停至下月 1 號。需避免頻繁大封包或無效高頻監控。
- filesystem 是 ephemeral（本專案無 DB、無檔案寫入，不受影響）。
- 不能 scale 超過一個 instance（剛好是 §3.3 LocMemCache 要的）。
- 沒有 shell 可以進 instance。

- **Multi-stage Dockerfile**（`deployment/prod/Dockerfile`，build context 是 repo root）：
  stage 1 (`node:22-slim`) `vite build` → stage 2 (`python:3.13-slim`) Django + gunicorn，
  WhiteNoise 服務 React build 產物 + `/api` JSON。單一 container、單一網址、無 CORS。
- 新增依賴：`gunicorn`、`whitenoise`。
- Python stage 需跑 `collectstatic`；`STATICFILES_DIRS` 指向 `frontend/dist`。
- WhiteNoise 用 plain storage（非 manifest storage）：Vite 已對檔名做 content-hash，
  manifest storage 會重複 hash 且可能 500。
- **但 plain storage 要自訂 `WHITENOISE_IMMUTABLE_FILE_TEST`。** WhiteNoise 預設
  的判定是 `name.<12 位 hex>.ext`，Vite 產出的是 `index-DcJk2sLm.js`（破折號 +
  base64url），一個都不符合。結果是每一個已經 content-hash 過的資產都拿到
  `max-age=60` 而不是 immutable，回訪的使用者每分鐘重下載整包 JS。
  這個問題**只在 prod 出現而且永遠不會報錯**，本機與 CI 都看不到。
- **`base: "/static/"` 只在 production 生效，所以 `public/` 的資產只在 prod 壞。**
  Vite 會改寫 `index.html` 裡的字面引用，但 JSX 裡 runtime 寫死的
  `<img src="/hero.png">` 不會被加前綴，dev 正常、prod 404。
  對策是 CI 的 build-smoke 放一個 `public/` 資產並 curl 它（§6.2）。
- prod stage 也要跑 non-root user。dev container 有做而 prod 沒做是反過來的。
- **CMD 語法限制**：必須使用 shell 形式，或以 `sh -c "exec ..."` 執行：
  ```dockerfile
  CMD exec gunicorn --chdir backend config.wsgi:application --bind 0.0.0.0:${PORT:-8080} --workers 1 --threads 8 --worker-class gthread --timeout 60
  ```
  **嚴禁寫成 JSON 陣列直接傳遞 `${PORT}`**（例如 `CMD ["gunicorn", ..., "${PORT}"]`）：exec 形式不會經由 shell 展開環境變數，`${PORT}` 會維持原樣字串傳給 gunicorn，導致 port 解析失敗、container 啟動直接 crash！

#### ⚠️ build 期的 SECRET_KEY

**這是整條部署鏈最早的斷點。**

settings 的 fail-fast 守衛（見下）在 `collectstatic` 執行時就會觸發：
build 環境沒有 `DEBUG` 也沒有 `SECRET_KEY`，於是直接 `ImproperlyConfigured`，
`docker build` 失敗。連帶本機 smoke test、CI 的 build-smoke job、
`make run-prod`、Render 的 build 全部起不來。

必須做到：collectstatic 那一行帶 build-only 假值。**`ALLOWED_HOSTS` 同樣是
fail-fast，所以兩個都要帶，只帶 `SECRET_KEY` 那行是跑不起來的**：

```dockerfile
RUN SECRET_KEY=build-only-not-used ALLOWED_HOSTS=build-only \
    python backend/manage.py collectstatic --noinput
```

**不可以用 `ENV SECRET_KEY=`**，那會讓假值留在 image 裡變成 runtime 預設，
等於廢掉整個守衛。**不可以用 `DEBUG=True` 繞過**，那會把 debug 帶進 prod image。

同樣的道理，`make test-backend` 帶 `DEBUG=True` 才過得了守衛；CI 也走同一個 make target，
不另外裸跑 `uv run pytest`。

#### PORT：Render 與 Cloud Run 都會注入 `$PORT`

Render 預設注入 `PORT=10000`，Cloud Run 預設注入 `PORT=8080`。
CMD 用 `${PORT:-8080}`，兩個平台都吃平台給的值，本機 `make run-prod` 沒注入時用預設的 8080。
預設值只寫在 CMD 這一處，Dockerfile 不另寫 `ENV PORT`。
Phase 5 首次部署時看 Render log 的 gunicorn `Listening at` 那一行，確認是 10000。

部署驗證用 `curl`，不可只用瀏覽器（瀏覽器可能吃到快取而誤判成功）。

#### ⚠️ 不可以在 Dockerfile 宣告 `ARG SECRET_KEY`

Render 會把 dashboard 上的環境變數自動轉成 Docker build argument。
Dockerfile 只要出現 `ARG SECRET_KEY`，真正的 key 就會在 build 期被帶進 image layer。
本專案 build 期只需要 collectstatic 那一行的假值（上一節），**Dockerfile 裡不准有任何 `ARG`
對應到 §11 的變數**。驗收：`grep -n "^ARG" deployment/prod/Dockerfile` 應為無命中。

#### Health check：Render 會等新版通過才切流量

Health Check Path 設 `/health`。Render 的行為（官方文件）：

- check 送的 `Host` header 是服務的 `onrender.com` 網域（有自訂網域時改用自訂網域）
- 5 秒內回 2xx 或 3xx 算通過
- 新版所有 instance 同時通過 check，才開始把流量導過去；15 分鐘內沒通過就取消這次 deploy，
  流量留在舊版

所以 port 對不上或 process 起不來時，結果是「deploy 失敗、舊版照常服務」，
不是「deploy 成功、站靜默壞掉」。**前提是 `ALLOWED_HOSTS` 含 `onrender.com` 網域**，
否則 check 拿到 400，每一次 deploy 都會被取消。

#### ⚠️ SECRET_KEY 與 ALLOWED_HOSTS 都要真的 fail-fast

設計哲學是「設錯要立刻暴露，不准安靜地照常運作」。兩個變數都要做到，
**不可以只有註解宣稱**：

- `SECRET_KEY`：非 dev 且未注入 → `ImproperlyConfigured`。
- `ALLOWED_HOSTS`：非 dev 且環境變數不存在 → `ImproperlyConfigured`，**不留 fallback**。
  漏注入時 process 起不來，Render 的 health check 不會過，這次 deploy 被取消，
  不會有「站看起來活著、使用者全拿 400」的中間態。

prod 網域一律由平台的環境變數注入（Phase 5 是 Render dashboard 的 Environment，
Phase 6 換成 Cloud Run），fallback 只涵蓋 local dev，刻意不含 `.onrender.com`。
**不讀 Render 自動注入的 `RENDER_EXTERNAL_HOSTNAME`**：那會讓 settings 綁死 Render，
Phase 6 還要再拆掉。

dev 的判定**只實作 `DEBUG` 一個訊號**。環境變數表也只留 `DEBUG`，沒有 `DJANGO_ENV`。

### 6.2 CI/CD

**GitHub Actions**（push master 與 PR）三個 job：

1. `test-backend`：`make test-backend`，與本機同一個入口（帶 `DEBUG=True`，fail-fast 守衛另由 Task 2 的 checkpoint 驗）
2. `test-frontend`：`npm ci` 後 `make test-frontend`（tsc 與 vite build 由 build-smoke 的 docker build 負責）
3. `build-smoke`：真的 `docker build -f deployment/prod/Dockerfile .` 起 container，curl `/health`、`/`、
   `/api/v1/countries`、一個放在 `public/` 的資產（驗 §6.1 的 base path），
   以及一個不存在的路徑（驗 SPA catch-all 回 200 不是 500）。
   失敗時要 `docker logs`（`if: failure()`），
   否則只看得到 curl 的非零離開碼，分不出是啟動失敗還是路由不對。

**沒有 deploy job。** 部署交給 Render 的 Auto-Deploy「After CI Checks Pass」：
master 有新 commit 時，Render 等這個 commit 的 CI checks 全部通過才 deploy，紅燈不部署。
所以 CI 不需要任何部署用的 token，也不需要 `concurrency` group。

**build-smoke 不可以打真實的 MoC。** 政府 API 一有狀況 pipeline 就紅燈且擋住 deploy；
而且 `grep -q 'events'` 對 `{"events": []}` 也會過，正是 §8.1 明文拒絕的通過條件。
contract 漂移由 `test-backend` 的 `responses` mock 負責，
真實 MoC 的驗證留在後端 checkpoint 與 Phase 5 驗收那兩個人工關卡。

`astral-sh/setup-uv` 用 `v10`。

**repo 維持 public。** build-smoke 每次 PR 與 push 都跑一次完整 multi-stage build，
public repo 的 Actions 分鐘數不計費；轉 private 的話免費額度是 2000 分鐘/月，
密集開發期會在月中耗盡。

### 6.3 依賴管理單一來源：uv

`pyproject.toml` (PEP 621) + `uv.lock` 是 source of truth；
Dockerfile 用 `uv sync --frozen --no-dev`。
新 repo 從 `uv init` 開始，不建立 `requirements.txt`，不用 Poetry。

- **`pyproject.toml` 不可以有 `[build-system]`。**
  有的話 uv 會判定這是要 build 的 package，而 Dockerfile 只 COPY 了
  `pyproject.toml` 與 `uv.lock`（沒有 source、沒有 README），build 會失敗。
  `uv init` 預設產生的是 application 專案（無 `[build-system]`），**不可以加 `--package` 或 `--lib`**。
  機械可判的驗收：`grep -q "build-system" pyproject.toml` 應為無命中。
- **dev 用的 container 需要 pytest 等 dev dependencies，`uv sync --frozen`
  不可加 `--no-dev`。** 只有 prod Dockerfile 才加。
- uv binary 釘特定版號（`ghcr.io/astral-sh/uv:0.12.5`），勿用 `:latest`。
  三處（backend dev Dockerfile、prod Dockerfile、依賴與 CI 定義）要一致。

### 6.4 branch 策略

**直接在 master 開發。** 本 repo 在 Phase 5 之前沒有任何部署管線，master 壞了也不會影響任何線上服務。

Phase 5 接上 Render 之後，master 的每一個 CI 綠燈 commit 都會自動部署，
master 從那一刻起就是 prod。之後的大改動（Phase 6 等）開 branch，走 PR 合回 master。

### 6.5 上線、rollback、關掉 v1

#### 上線不是 cutover

v2 是一個新的 Render 服務、新的網址（`<服務名>.onrender.com`），v1 在 Fly 上繼續跑。
兩個站並存，所以首次部署失敗不會讓任何人看到掛掉的站，不需要停機窗口、staging 演練或 rollback tag。

切換的動作是 owner 把新網址傳給朋友，時間點由 owner 決定，發生在 Phase 5 驗收通過之後。

#### rollback

兩層，由淺到深：

1. **Render dashboard 的 Rollback**：退回某一次舊 deploy。官方文件寫明環境變數會跟著
   退回那次 deploy 的值，所以不會出現「新設定配舊 image」的組合。
   **rollback 會自動關掉 Auto-Deploy**，修好之後要回 Settings 把它設回
   「After CI Checks Pass」，不然之後 push 都不會部署。這一行要寫進 README。
2. **v1 還在**：v2 整個不能用的時候，請朋友先用 v1 的網址。這一層只在 v1 關掉之前有效。

(推論：Render 保留的舊 build 數量依 workspace plan 而定，官方沒寫 Hobby 是幾個；
第 1 層退不回太舊的版本時，改用 `git revert` 推一個新 commit 讓 CI 部署)

#### 關掉 v1

> **架構邊界（Owner 於 2026-10-02 決策）**：v1 是 v1、v2 是 v2，兩者完全獨立。不侵入修改 v1 程式碼加跳轉 banner。

v2 上線並穩定一週之後，owner 在 v1 執行下線清單（避免殘留扣款或幽靈告警）：

1. **停用定時工作**：停用或移除 v1 repo 的 GitHub Actions scheduled workflows（若有），避免停機後定時發出誤報失敗信。
2. **撤銷 Token**：撤銷 Fly.io 的 Deploy Token（從 GitHub Secrets 與本機環境清理）。
3. **備份與銷毀 Volume**：若 SQLite 資料庫有留存需求先作備份；確認後執行 `fly apps destroy taiwan-culture-event-info`（連同其 `sqlite_data` volume 一起徹底刪除）。
4. **檢查帳單**：確認 Fly dashboard 的 Billing 沒有其他殘留計費項目。
5. **文件備註**：v1 README 第一行加「已由 culture_event_finder_v2 取代」與新網址。

不急著關的話也沒有技術風險，只是 v1 若不是 grandfathered 免費額度就每個月在扣錢
（停著的 machine 收 rootfs 費用、volume 另外收費）。

#### 監控設定

**一個 GitHub Actions scheduled workflow，每 30 分鐘，打真實搜尋 URL。**

- 目標：`/api/v1/tw/events?category=6&location=臺北&month=<當月>`。
- **嚴格正向白名單判定（P1 必改）**：
  **「HTTP status 200 且 response 為有效 JSON 且 events 陣列長度大於 0 才算成功；其他所有狀態一律判定失敗」。**
  舊設計若只檢查排除 502 或 `[]`，遇到 Render 冷啟動中吐出的 HTML 載入頁、配額用盡的暫停頁面、Django 500 內部錯誤等情況，全都會被誤判為正常綠燈！必須以 `jq -e '.events | length > 0'` 嚴格驗證。
- **`curl --max-time 120`。** 每 30 分鐘一次大於 Render 的 15 分鐘 spin down，
  所以幾乎每一次監控都會遇到睡著的服務：喚醒大約 1 分鐘，加上 cache 空的時候上游最多 15 秒。
  timeout 設 30 秒的話每一次都會誤報。
- cron 寫 `17,47 * * * *`，避開整點。GitHub 官方文件寫整點是高負載時段，schedule 會延遲。
- **告警通知對象**：走 GitHub workflow 失敗通知 email。依 GitHub Actions 規則，定時 schedule workflow 的失敗郵件會發送給**「建立該 workflow 的人」或「最後 commit 修改該 workflow 檔案的人」**。
- **public repo 60 天沒有任何活動，GitHub 會自動停用 scheduled workflow。**
  專案進入維護期後這是最可能讓監控默默消失的原因。README 的「這幾樣東西不會自己告訴你」
  要列這一條，處理方式是每兩個月看一次 Actions 頁面有沒有被停用。
- 頻率不可以更密。每 30 分鐘一次已經讓服務一天大約醒 12 小時
  （每次喚醒後撐 15 分鐘才睡），一個月大約 372 小時，加上真人流量仍在 750 小時內。
  改成每 10 分鐘會讓服務 24 小時醒著，一個月 744 小時，貼著上限，
  一有真人流量疊加就可能在月底被停到下個月（推論：依 750 小時規則推算）。
- 代價要講清楚：服務睡著時，使用者打開網址最壞要等大約 1 分鐘（看到的是 Render 的
  loading 頁），進站後第一次搜尋若 cache miss 再等最多 15 秒。

### 6.6 Phase 6：遷移 Cloud Run（另開 branch）

GCP 一次性 infra 用 **Terraform** 管理（owner 指定，作為 IaC 學習）：
enable APIs、deployer service account + IAM roles、Workload Identity Federation、
billing budget alert。App 部署不進 Terraform（CI 的 `gcloud run deploy` 負責）；
tfstate 存本機並 gitignore。Terraform 檔放 `deployment/terraform/`（§2）。
CI 加回 deploy job，需要 `permissions.id-token: write`。

**deploy job 不可以用 `gcloud run deploy --source .`。** Cloud Run 官方文件只寫
source 目錄裡有 Dockerfile 時會用它 build，沒有記載指定其他路徑的參數，
而本專案的 Dockerfile 在 `deployment/prod/`。deploy job 改成三步：
`docker build -f deployment/prod/Dockerfile .` → push 到 Artifact Registry →
`gcloud run deploy --image <剛 push 的 image>`。這也讓 CI 的 build-smoke 與
deploy 用同一條 build 指令。

$0 目標的真實條件：

- Cloud Run 的 Always Free 是每月 2,000,000 requests、360,000 GB-seconds 記憶體、
  180,000 vCPU-seconds、北美出向 1 GB，per billing account，且只涵蓋 request-based billing。
  以朋友等級的流量，compute 這三格用不到 1%，**Cloud Run 本身確實是 $0**。
- **破口在 Artifact Registry，同一個帳單帳戶只有 0.5 GB 儲存。**
  `python:3.13-slim` + venv + `frontend/dist` 大約 200 到 400 MB，
  兩三個 revision 就吃掉額度。必須設 cleanup policy 只保留最近 2 個 image。
- 部署時明確 `--min-instances=0`（`min-instances > 0` 走 instance-based billing，
  不吃 free tier）。
- **`--max-instances=1`**，否則預設 concurrency 80 / max 100，流量一來就開第二個
  instance，各自一份 LocMemCache，§3.3 的上界假設整個破功。
- **`--concurrency=8` 必須跟著設。** Cloud Run 預設一個 instance 同時收 80 個
  request，而 container 只有 8 個 gunicorn thread。差額會排隊到 request timeout。
  這個數字要跟 `--threads` 對齊，改一邊就要改另一邊。
- **`--max-instances=1` 是一個刻意的天花板，要寫在 README 裡。** 超過
  8 個並行加上排隊就會回 429。這是 LocMemCache 換來的代價，不是設定錯誤，
  半年後看到 429 的人要能在 README 找到這句話。
- billing budget alert 設在 $1，不是 $10。目標是 $0，$1 就該收到信。
- 2026-02-03 起部分服務要求開啟 billing，信用卡一定要綁。
- `ALLOWED_HOSTS` 改成 Cloud Run 的網域；Render 的 Auto-Deploy 改成 Off。

遷移順序：Cloud Run 上線並驗證數天後，才刪掉 Render 服務，不空窗。
網址又會換一次，要再通知朋友一次（有自訂網域的話不用）。

## 7. 從 v1 移植的清單

本 repo 從零開始，**沒有要刪的舊 code**。v1 的程式碼只當參考，需要的部分照下表移植，
其餘一律不帶過來。v1 路徑以 v1 repo root 為準。

**要移植（改寫進新結構，不是整檔複製）：**

| v1 檔案 | 移植到 | 拿什麼 |
|---|---|---|
| `main_project/culture/data.py` | `backend/events/providers/taiwan.py` | Location 與 EventCategory 清單，補上宜蘭與連江（§3.2） |
| `main_project/culture/views.py` | `backend/events/providers/taiwan.py` | MoC API URL（`cloud.culture.tw/frontsite/trans/SearchShowAction.do`）、query 參數、SSL `verify=False` 與 `urllib3.disable_warnings`（第 9 到 30 行） |
| `main_project/tech_stack/templates/tech_stack.html` | `frontend` 的 About 頁 | tech stack 表的內容與作者連結 |
| `main_project/health_check/` | `backend/health/` | 只拿概念：`/health` 回 200，不碰外部依賴 |

**不移植**：Material Dashboard 全部 static assets 與模板、Select2 / FontAwesome /
Google Fonts 等 CDN 依賴、`utility/`（logging 改用 toolkitsy）、`main.py`、
`backup.html`、`deployment_tcei/`、Poetry 與 `requirements.txt`、`fly.toml`、
v1 的 `.github/workflows/deploy.yml`。

**`docs/poc/` 已經在本 repo**，是視覺 design reference（§4.1），唯讀。

**`.gitignore` 必須有 `staticfiles/`。** `STATIC_ROOT` 指向它，
只要本機跑過一次 `collectstatic`，`git add -A` 就會把整包 build 產物 commit 進去。

HTTP 請求：toolkitsy 尚無 http 模組（PyPI 0.1.0 已驗證）。
暫用 `requests` 並集中在 provider 檔案；toolkitsy 發版後單檔替換。

## 8. 測試策略

- **後端 pytest（完整）**：
  - providers：mock MoC（用 `responses`），涵蓋正常/空回應/非 JSON/HTTP 錯誤/**timeout**。
    timeout 正是 `verify=False` 打政府 API 最可能發生的失敗模式，不可漏
  - services：cache hit/miss 行為、過濾與排序 edge cases
  - API contract：status codes、錯誤格式、參數驗證（含白名單外的 category / location）
  - `pytest.ini` 要有 `addopts = --nomigrations`。專案沒有任何 model，
    每次跑測試對 in-memory sqlite 跑一輪 contenttypes migration 是純浪費
  - **`pytest.ini` 也必須有 `python_files = test_*.py tests.py`。**
    pytest 預設只收 `test_*.py` 與 `*_test.py`，而 Django 慣例的 `health/tests.py`
    兩者都不符，會被靜默略過。實測 `pytest .` 對一個只有 `health/tests.py`
    的目錄收到 0 個測試並以 exit code 5 結束，而 `pytest .` 正是 makefile、
    CI、與每一個 checkpoint 用的指令。這一行不加的話：骨架階段的驗收會
    以「測試指令壞掉」的形式失敗，之後的每一次全測都會靜默少跑 health 那組
- **必須有一條端到端不 mock provider 的 services 測試。**
  用 `responses` mock MoC 的 HTTP 回應，走真的 `TaiwanProvider` →
  `search_events(month="2026-07")`，斷言拿到資料。
  否則月份格式轉換的兩端各自被 mock 掉（services 測試餵已 parse 好的 datetime、
  provider 測試只驗 parse 不驗過濾），沒有任何一條測試從
  `"2026/07/12 19:30:00"` 走到 `month=2026-07` 的結果。
- **跨月必須有專屬測試**：一個 1 月開跑、12 月結束的活動，查 9 月要命中。
- **前端 Vitest（輕量）**：日期格式化、`currentMonth()`、年月重組、
  切國家時的重設邏輯等純函式；不追 component 覆蓋率。
- **i18n 那個 task 不可以用 `tsc --noEmit` 當驗收。** 「無輸出」證明的只是型別對，
  不證明缺 key 有 fallback、不證明語言挑對、不證明切換鈕會 render。
  要三個 Vitest 斷言：缺 key 回傳 key 本身、`pickLabel` 在 `en` 下拿到英文、
  切換後 `document.documentElement.lang` 真的變了。Vitest 在 scaffold 那個 task
  就裝好了，這裡是零新依賴。
- **cache 那一層要留一行 log。** v4 的 cache-aside 只對 `MagicMock` 驗過，
  而且整個專案沒有任何一行印出 cache 是 hit 還是 miss。
  加 `logger.info("cache %s key=%s", ...)` 之後，那個 task 當場可以本機驗
  （同一個查詢跑兩次看 log），而且 Phase 5 的驗收不用再靠回應時間去猜。
- **Phase 4 結束前的本機 prod-like container smoke test**：
  `docker build -f deployment/prod/Dockerfile .` + `docker run` + curl `/health`、`/`、`/api/v1/countries`。
  目的是把「image 本身能不能啟動」與「Render 平台設定對不對」這兩個變數拆開驗證，
  不讓它們疊在第一次真實部署裡。
- CI 三個 test job 都跑。

### 8.1 checkpoint 的通過條件不可以無法證偽

**「回傳筆數 N ≥ 0 皆可」不是通過條件。** 月份過濾壞掉時 API 永遠回空陣列，
與「這個月剛好沒活動」在 checkpoint 上長得一模一樣。

所有涉及查詢結果的 checkpoint 都要：先打一次上游確認某個 category 與月份
確實有資料，再對該組合斷言 `len(events) > 0`。空陣列一律算沒過。

### 8.2 錯誤路徑要有人走過

手動驗收清單必須包含錯誤畫面與空結果畫面，而且是分開的兩項，
不可以寫成「看到卡片或空結果畫面」這種二選一。

- 錯誤畫面：`docker compose -f deployment/dev/docker-compose.yml stop backend` 後按搜尋
- 空結果畫面：指定一個確定沒活動的月份
- 服務睡著時的搜尋（Phase 5）：開著分頁等超過 15 分鐘再按搜尋，
  要看到錯誤畫面加重試按鈕，或正常結果；不可以是白畫面或 console 的 JSON parse error（§4）

否則 ErrorMessage 這個元件在整個開發過程中一次都不會被執行到。

## 9. 里程碑

```
Phase 0：規劃 ✅（2026-10-02 完成，2026-10-04 改版 v7）
  spec v7 定稿（本文件），plan v7
  POC HTML → owner 確認（gate）✅ docs/poc/20260719_155200_ui_design_v27.html
  結束狀態：plan 定稿、視覺方向凍結、hosting 定為 Render free

Phase 1：骨架先立好
  uv init → backend/ + config/ + 全新 settings → dev compose
  → 前端 scaffold（Vite + React + TS + Tailwind + Vitest）
  結束狀態：Django 起得來、make test 前後端都跑得動、make dev 兩個 service 都起得來
  （前端 scaffold 排進 Phase 1：makefile 與 compose 只寫一次，
    make test 從這裡開始到收工都是可用的）

Phase 2：後端
  providers（從 v1 移植，§7）→ services → API endpoints（★ checkpoint：打真實 MoC）
  結束狀態：API 回得出真實資料，跨月與異體字都驗過

Phase 3：前端
  types/api/format → i18n → UI 元件三段（★ checkpoint 各一次）
  → App 組裝 + About（★ checkpoint：全流程手動 E2E）
  結束狀態：docker-compose 起得來，SPA 打新 API 全流程可用

Phase 4：prod image 與文件
  prod Dockerfile + 本機 prod-like smoke test（★ checkpoint）→ CI 三個 job → README
  結束狀態：CI 綠燈，image 本機跑得起來，README 有 Render 設定表與 rollback 步驟

Phase 5：上 Render
  owner 建 Render 服務（§6.1 那張表）→ 首次部署 + curl 驗證（★ checkpoint）
  → 監控 workflow → owner 把新網址給朋友
  結束狀態：v2 在 Render serve 真實流量，監控每 30 分鐘打真實搜尋 URL；v1 仍在 Fly
  一週後：owner 關掉 v1（§6.5）

Phase 6：遷移 Cloud Run（另開 branch，不 block）
  Terraform (owner 執行 terraform apply) → CI 加 gcloud run deploy
  → 驗證數天 → 刪 Render 服務

Phase 7：k8s（另開 branch，隨時，純學習）
  kind + manifest 跑同一個 prod image
```

### 9.0 ★ checkpoint 放在哪裡

判準是「這一步之後要退回去很貴」，不是「這一步很難」。所以 checkpoint 要標在
不可逆的點與最後一道防線上。

1. **全新 settings 那個 task**：fail-fast 守衛第一次生效，之後 build、test、CI 全部依賴它
2. **後端 API endpoints**：第一次打到真實 MoC
3. **前端 scaffold**：第一次看到瀏覽器畫面
4. **UI 元件三段各一次**：每一段結束都能開瀏覽器看到那一段做出來的東西
5. **App 組裝**：全流程手動 E2E
6. **prod image 的本機 smoke test**：真實部署前的最後一道防線，
   plan 自己寫了「唯一一次真實部署前的最後防線」卻沒標
7. **Render 首次部署後的 curl 驗證**：PORT、`ALLOWED_HOSTS`、health check
   三件事第一次在真實平台上被證明的那一刻

### 9.1 每個 task 收尾都要能在 local 測一次

owner 的開發時間是零碎的，每個 task 結束時必須有一個當下可跑、看得到結果的驗收。
純 `tsc --noEmit` 或純單元測試綠燈不算「看得到結果」，涉及畫面的 task
要有實際開瀏覽器的步驟。

**沒有不可中斷的 task。** 新 repo 不搬舊 code，也不就地改現役服務，
任何一個 task 做到一半停下來，repo 都還是上一個 task 結束時的可用狀態。

## 10. 風險與已知取捨

- **build 期 SECRET_KEY**：見 §6.1。最早的斷點，會擋掉 build、test、CI 三條路。
- **Dockerfile 出現 `ARG SECRET_KEY`**：見 §6.1。Render 會把環境變數轉成 build arg，
  真 key 會進 image layer。
- **`ALLOWED_HOSTS` 沒含 `onrender.com` 網域**：見 §6.1。health check 拿 400，每次 deploy 都被取消。
- **rollback 會關掉 Auto-Deploy**：見 §6.5。忘了開回去的症狀是「push 了但站沒更新」。
- **free tier 規則會變**：Fly 在 2024-10 取消新用戶免費方案，Koyeb 在 2026-02 改成要綁卡。
  Render free 也可能改。緩解：Dockerfile 不綁平台（§2），Phase 6 是現成的出口。
- **750 小時用完會被停到月底**：見 §6.5。只有這一個 free 服務、監控維持 30 分鐘，算起來約 372 小時。
- **監控 workflow 會被 GitHub 自動停用**：public repo 60 天無活動。見 §6.5。
- **網址換了要通知朋友**：v1 是 `.fly.dev`、v2 是 `.onrender.com`、Phase 6 又會換一次。
  沒有自訂網域就沒有技術解，只能靠通知。
- **spin down + 監控指錯對象 = 靜默壞掉**：`/health` 不碰外部依賴，
  MoC 掛掉時它照樣 200。緩解：監控打真實搜尋 URL（§3.4、§6.5）。
  讀 cache 旗標的 `/health/upstream` 也不行：旗標在 spin down 時必然消失、
  而且只有真人搜尋才會被寫，它是「看起來有監控」而不是有監控，比沒有更危險。
- **免費方案的代價是冷啟動**：服務睡著時打開網址最壞等大約 1 分鐘（Render 的 loading 頁），
  進站後第一次搜尋 cache 全空，最壞再等 15 秒。緩解是 §4 的 8 秒文案，
  不是技術解，是把等待講清楚。
- **Render free 的 0.1 vCPU**：gunicorn 開 8 個 thread 不會讓 CPU 變多，
  只是讓等上游的 request 不互相卡住。(推論：本專案的 CPU 工作只有 JSON 解析與過濾，
  0.1 vCPU 夠用；Phase 5 驗收時看一次 cache hit 的回應時間確認)
- **`verify=False` 是永久且靜音的**：`urllib3.disable_warnings` 是 process 全域。
  MoC 哪天把憑證修好、或換一個 host，沒有任何東西會通知 owner 可以拿掉它。
  README 的維運段要列出這一行並註明「這是暫時解，狀態未被監控」。
- **12 個 category 只實測過 3 個**：category 1/6/17 驗過 payload 形狀，
  其餘九個未驗證。(推論：若某個 category 的 `showInfo` 結構不同，
  會走到「raw 非空但 parsed 為 0」那條 sanity 路徑，回 502 而不是靜默空白)
  緩解：後端 checkpoint 順手把 12 個都打一次，記下筆數。
- **網域只寫在一個地方**：Render 的 `ALLOWED_HOSTS` 環境變數。health check 的 Host header
  由 Render 自己帶，不用另外設定。換自訂網域或搬 Cloud Run 時只改這一個值。
- LocMemCache 不跨 instance、不跨 gunicorn worker、不耐重啟：已知，見 §3.3。
- MoC API 無 SLA、憑證有問題：provider 層隔離，錯誤有明確 UX。
- **MoC 回應格式可能靜默改版**（政府 open data 常見）：改欄位名時 HTTP 仍 200、
  mock 仍全綠、uptime 仍全綠。緩解：§3.4 的 sanity 訊號（raw 非空但 parsed 為 0）。
- **`backdrop-filter` 的裝置負擔**：v27 的 `.glass` 是 `blur(40px)` 加兩顆 36px 光暈，
  是全螢幕面板。低階 Android 可能掉幀甚至白屏，而驗證只在 mac 上做過。
  **這條目前沒有實質緩解**，只有 fallback 方案：提高 `--panel` 不透明度並移除 blur
  （CSS variables 一處改）。design.css 要預留註解好的低配值，臨時要降級不用重想。
  部署驗證要包含一次真實手機的捲動與 hover 順暢度確認。
- **單 category 的資料量量測結果（2026-10-04 實測）**：
  - category=6（展覽）：495,945 bytes（約 484 KB），302 events，302 shows
  - category=1（音樂）：481,024 bytes（約 470 KB），500 events，741 shows
  - category=2（戲劇）：513,039 bytes（約 501 KB），241 events，1,516 shows
  - category=3（舞蹈）：87,137 bytes（約 85 KB），70 events，194 shows
  - category=4（親子）：106,635 bytes（約 104 KB），58 events，233 shows
  - category=5（獨立音樂）：115,685 bytes（約 113 KB），6 events，456 shows
  - category=7（講座/研習）：183,949 bytes（約 180 KB），146 events，164 shows
  - category=8（電影）：1,380,816 bytes（約 1.3 MB），246 events，4,855 shows
  - category=11（綜藝）：1,476 bytes（約 1.4 KB），1 events，1 shows
  - category=17（演唱會）：13,160 bytes（約 13 KB），11 events，15 shows
  - category=19（競賽）：11,841 bytes（約 12 KB），9 events，9 shows
  - category=200（其他）：18,109 bytes（約 18 KB），9 events，9 shows
  - **總結**：單一 category 最大僅約 1.3 MB（電影），12 個類別總和約 3.4 MB，在 Render 512 MB 記憶體限制下極為充裕，目前無需調整 LocMemCache 的 `MAX_ENTRIES`。
- **加國家不是三步**：README 不可以承諾「新增一個 provider 檔就好」。
  已知至少四處要動：前端 `COMING_SOON` 硬編陣列要清（不清的話新國家會同時出現
  一個 active chip 和一個未開放 chip）、`location` 的 substring 比對綁死中文地址習慣、
  `fetch_events(category)` 的簽名假設「一次抓完整個 category 再本地過濾」、
  i18n 只有 zh/en 兩個 dict。現在不預先抽象（YAGNI 正確），但要把卡點寫下來。
- Owner 首次寫 React/TS：code 難度刻意壓低，元件小而少，
  且 §4.1 的 POC gate 已凍結視覺方向，v27 檔案是可對照的 source of truth。

## 11. 環境變數

README 要有這張表。半年後要重建環境或輪替 key 時，這是唯一該看的地方。

| 變數 | 設在哪 | 誰用它 | 沒設會怎樣 |
|---|---|---|---|
| `SECRET_KEY` | prod：Render dashboard → Environment；build：collectstatic 那行的假值；test：makefile 與 CI | Django | 非 dev 時啟動即 `ImproperlyConfigured` |
| `ALLOWED_HOSTS` | prod：Render dashboard → Environment，值為 Render 實際分配之完整網域（如 `<真實服務名>.onrender.com`，防隨機後綴不一致）；build 與 test 同上 | Django | 非 dev 時啟動即 `ImproperlyConfigured` |
| `DEBUG` | dev：`deployment/dev/docker-compose.yml` | Django | 預設走 prod 分支 |
| `PORT` | prod：Render 自動注入 10000；Cloud Run 自動注入 8080；本機 `make run-prod` 沒注入時用 CMD 的 `${PORT:-8080}`。dev：backend 固定 8789、frontend 固定 8790，寫在 `deployment/dev/` 的 compose 與兩個 Dockerfile | gunicorn / runserver / Vite | 不會沒設 |
| `UV_PROJECT_ENVIRONMENT` | `deployment/dev/backend.Dockerfile` | uv | venv 落在 bind mount 內被 host 覆蓋 |
| `HOST_UID` / `HOST_GID` | dev：Makefile 用 `id -u` / `id -g` 帶入（compose 讀，有預設值 1000） | dev container 的 non-root user | Linux host 上 UID 不是 1000 時 container 寫不了 bind mount |

`DJANGO_ENV` 不存在，不要照著找。

## 12. Owner 定案之設計與架構決策 (2026-10-02)

於 2026-10-02 Review-Crew 審查後，由 owner 明確拍板定案的關鍵決策：

1. **Provider ABC 抽象骨架：明確保留**
   - 裁決：非過度設計，明確為未來擴充其他國家或資料來源所保留。維持輕量 interface (`base.py`)，不搞複雜 registry。
2. **前端 20 項可測性與 a11y 規範：全部實作，不予拆分**
   - 裁決：維持 MVP 完整品質標準，不拆 P0/P1，全數於 Phase 3 一次落實。
3. **v1 舊站獨立性：兩者獨立，不侵入修改 v1**
   - 裁決：v1 是 v1、v2 是 v2。v1 保持現狀不加跳轉 banner，一週後依下線清單直接停機銷毀。
4. **視覺與體驗資產保留**：
   - 裝飾用幾何線條 SVG（約 150 行）：保留。
   - i18n 雙語 label schema（約 60 行）：保留。
   - `COMING_SOON` 日韓 chip 與四個類別快捷 chip（約 70 行）：保留。
