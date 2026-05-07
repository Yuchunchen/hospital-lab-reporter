## Hospital Lab Reporter

<!-- 洗腎室（透析室）檢驗資料案管系統 — 獨立 HTML 網頁 -->

洗腎室（血液透析室）檢驗資料管理系統。獨立的單一 HTML 網頁應用程式，供 2–5 人小團隊在院內使用，管理透析病患名單並自動抓取 ernode API 檢驗數據。

### Architecture

<!-- 檔案清單 — html 是主程式，groups/ 是疾病模組 -->

- **hospital-lab-data.html** — 主程式檔案（~3014 行），所有 CSS 與大部分 JS 內嵌於此。直接用瀏覽器開啟即可使用。兩段自動產生的標記區塊：
  - `// __HOSPITAL_LAB_PATTERNS_BEGIN__` ~ `END__` (line ~322–1213) — patterns catalog + manifest + resolver
  - `// __HOSPITAL_LAB_GROUPS_BEGIN__` ~ `END__` (line ~1215–) — disease group modules (currently: dialysis)
- **groups/dialysis.js** — 透析 disease group module。包含 `labManifest`、`detectMonthlyDrawsFromStored`（月檢識別）、CSV exporter。由 `sync-patterns.js` 內嵌進 HTML 的 groups 標記區塊。
- **sync-patterns.js** — 從 sibling repo `../hospital-lab-patterns/` 同步 patterns 區塊 + groups 區塊到 HTML。執行 `node sync-patterns.js` 後重新整理瀏覽器即可載入新版本。
- **fetcher.js / server.js / cache.js / patients.js / csv-compiler.js / lab-mapping.js** — Server-side stack（Node.js）。目前使用者實際 flow 走的是 client-side（HTML 內嵌），這些檔案是早期版本殘留或備用，**非主要執行路徑**。
- **package.json** — Node dependencies for sync-patterns.js.

### UI 結構

三個分頁（Tab）：

1. **病患清單** — 表格列出所有透析病患（病歷號、姓名、性別、生日、透析頻率）。可新增、編輯、刪除。點擊病歷號查看該病患檢驗資料。「全部更新」按鈕批次抓取所有病患的最新資料。
2. **檢驗資料** — 選定病患後顯示完整歷史表格：橫軸為日期、縱軸為檢驗項目（依分類群組：血液、腎功能、電解質、肝功能、血脂肪、鐵代謝、其他、計算值）。異常值以紅色（高）/藍色（低）標示。
3. **設定** — API 伺服器網址、操作人員代號 (OPSID)。

### API 整合

- **Base URL**: `http://ernode.vghb12.vhtt.gov.tw:8000`
- **Endpoint**: `/order/get_lab_orders?chartno={chartno}&opsid={opsid}`
- **回傳格式**: HTML 頁面（非 JSON），以 DOMParser 解析。
- **分頁處理**: 偵測頁面中的 `>>` 連結，自動抓取後續頁面直到無更多資料。
- **病歷號格式**: 9 位數字 + 1 個英文字母（如 `000810385G`）。輸入時自動補零、大寫。
- **日期系統**: 民國年（如 115/04/14 = 2026/04/14），解析函數 `parseDateTaiwan()` 與 `parseDateResdttm()`。

### 檢驗項目 (LAB_TESTS)

37 項檢驗，定義集中於 [hospital-lab-patterns](https://github.com/Yuchunchen/hospital-lab-patterns) repo (`patterns/reporter.js`)，由 `sync-patterns.js` 同步進 HTML。每項定義包含：`id`, `cat`, `label`, `pattern` (regex), `unit`, `ref`, `hi`, `lo`, `filter`（可選）。

**Note:** 下表為 2026-05-05 快照；2026-05-07 後所有 numeric capture group 已改成 `([<>]?\s*[\d.]+)` 支援偵測下限值。以 catalog.js 為準。

主要項目與 regex pattern：

| 分類 | 項目 | Pattern | 備註 |
|------|------|---------|------|
| 血液 | WBC | `WBC:\s*([\d.]+)` | 負向前瞻排除尿液 WBC |
| 血液 | RBC | `RBC:\s*([\d.]+)` | |
| 血液 | Hb | `(?:Hb\|HGB):\s*([\d.]+)` | 兩種標籤 |
| 血液 | Hct | `(?:Hct\|HCT):\s*([\d.]+)` | |
| 血液 | MCV | `MCV:\s*([\d.]+)` | |
| 血液 | Platelet | `(?:Platelet\|PLT):\s*([\d.]+)` | |
| 腎功能 | BUN (洗前) | `BUN:\s*([\d.]+)` | filter: composite |
| 腎功能 | BUN (洗後) | `BUN:\s*([\d.]+)` | filter: standalone_bun |
| 腎功能 | Creatinine | `Creatinine\(serum\):\s*([\d.]+)\|CREAT:\s*([\d.]+)` | 排除 Urine |
| 腎功能 | Uric Acid | `Uric acid:\s*([\d.]+)` | |
| 電解質 | Na | `NA\(Serum\):\s*([\d.]+)` | |
| 電解質 | K | `K\s*\(Serum\):\s*([\d.]+)` | |
| 電解質 | Cl | `Cl\(Serum\):\s*([\d.]+)` | |
| 電解質 | Ca | `Calcium\(Serum\):\s*([\d.]+)` | |
| 電解質 | P | `Phosphorus:\s*([\d.]+)` | |
| 肝功能 | AST | `(?:GOT\|AST).*?:\s*([\d.]+)` | |
| 肝功能 | ALT | `(?:GPT\|ALT).*?:\s*([\d.]+)` | |
| 肝功能 | ALP | `ALP:\s*([\d.]+)` | |
| 肝功能 | T-BIL | `T-BIL:\s*([\d.]+)` | |
| 血脂肪 | Cholesterol | `Cholesterol.*?:\s*([\d.]+)` | |
| 血脂肪 | LDL | `LDL.*?:\s*([\d.]+)` | |
| 血脂肪 | TG | `(?:TG\|Triglyceride).*?:\s*([\d.]+)` | |
| 營養 | Total Protein | `Total protein\(serum\):\s*([\d.]+)` | |
| 營養 | Albumin | `Albumin\(serum\):\s*([\d.]+)` | |
| 血糖 | Glucose AC | `(?:Glucose\(AC-serum\)\|GLU\|GLU-AC\|Sugar\|飯前血糖).*?:\s*([\d.]+)` | |
| 血糖 | HbA1c | `(?:HbA1c\|Hemoglobin A1c\|GLYCATED).*?:\s*([\d.]+)` | |
| 鐵代謝 | Fe | `FE:\s*([\d.]+)` | |
| 鐵代謝 | TIBC | `TIBC:\s*([\d.]+)` | |
| 鐵代謝 | TSAT | `SAT:\s*([\d.]+)` | |
| 鐵代謝 | Ferritin | `(?:Ferritin\|FERRITIN):\s*([\d.]+)` | |
| 其他 | i-PTH | `i-PTH:\s*([\d.]+)` | |
| 其他 | AFP | `(?:AFP\|α-Fetoprotein).*?:\s*([\d.]+)` | |
| 感染 | HBsAg | `HBsAg.*?:\s*([\d.]+)` | 定性+定量 |
| 感染 | Anti-HBs | `Anti-HBs.*?:\s*([\d.]+)` | |
| 感染 | Anti-HCV | `(?:HCV\|Anti-HCV).*?:\s*([\d.]+)` | |
| 感染 | HIV | `HIV.*?:\s*([\d.]+)` | |
| 感染 | RPR | `RPR.*?:\s*([\d.]+)` | |

### BUN 洗前/洗後邏輯

這是本專案最重要的設計決策之一：

- **洗前 BUN**: `filter: 'composite'` — 只從 orderName 包含逗號的複合醫囑中擷取（如「BUN, Creatinine, Na, K...」）。這些是常規透析前的整套抽血。
- **洗後 BUN**: `filter: 'standalone_bun'` — 只從 orderName 為獨立的 BUN 醫囑中擷取（不含逗號，或 orderName 就是 "BUN"）。透析後單獨抽的 BUN 通常數值很低（6–7），用於計算 URR。

extractLabValues() 函數中根據 filter 欄位過濾 order：
```javascript
if (test.filter === 'composite' && !order.orderName.includes(',')) continue;
if (test.filter === 'standalone_bun' && order.orderName.includes(',')) continue;
```

### 計算值 (COMPUTED_TESTS)

| 項目 | 公式 | 說明 |
|------|------|------|
| URR (尿素清除率) | `(1 - BUN洗後/BUN洗前) × 100` | 配對同日期的洗前洗後 BUN，目標 ≥ 65% |
| Ca×P (鈣磷乘積) | `Ca × P` | 配對同日期，目標 < 55 |

### Sub-page enrichment (manifest-driven, 2026-05-07)

`fetchAndStore()` 在 `extractLabValues()` 之前跑通用 `enrichMissingValues()`：
對 catalog 帶 `subpage.orderNameMatch` opt-in 的 test，若該 order 主
reportText 抓不到主 regex，就 fetch opdweb `OpdOrderReport.aspx` 子頁面
補值。子頁面文字以 `ordapno` 為 key 持久化進 localStorage `enrichCache_dialysis`
（lab 報告簽收後不變動，無 TTL；體積小，保留 localStorage 不遷 IndexedDB）。Strict opt-in：
non-subpage missing 的 test **不會** brute-fetch（避免一個 globally-missing
test 拖累全 order 被 fetch）。機制細節見
`hospital-lab-patterns/PROJECT_CONTEXT.md` §4。

**`file://` CORS 限制**：直接雙擊開啟 HTML 時 origin 是 `null`，opdweb
沒設 `Access-Control-Allow-Origin` → 所有 sub-page fetch 全 CORS blocked。
Aluminum 透過 catalog 主 regex 同時匹配 `Al鋁:`（in-house）與外送
單位 `BALR0101:` 解決，沒踩到此限制。**未來若有真的 sub-page-only
test**，需把 HTML 移到 localhost server（如 `python -m http.server`）
或裝 CORS bypass extension；viewer Chrome MV3 extension 不受影響。

### Detection-limit values (`<N` / `>N`, 2026-05-07)

`extractLabValues()` 對主 regex capture group 開頭是 `<` 或 `>` 時，
trim 後保留為 string（如 `"<2"`），不走 parseFloat。下游全自動相容：
table 渲染走 `parseFloat → NaN → 跳 alarm color → 顯示原字串`、CSV
`csvCell` 字串化、URR/Ca×P/classifyBUN 既有 `Number()` + `isFinite`
跳過 NaN。Aluminum `<2`（外送單位低於偵測下限 = 抽了、安全）是這條
的主要驅動 case。

### 資料儲存

- **localStorage** — 病患清單 (`dialysis_patients`)、檢驗資料 (`dialysis_lab_data`)、設定 (`dialysis_settings`)、sub-page enrichment cache (`enrichCache_dialysis`)。
- **IndexedDB** `LabReporterOrdersCache` (DB_VER=1, store `orders`, keyPath=chartno) — incremental fetch 用的 raw orders cache。每位病患存完整 orders 陣列 + timestamp，不受 localStorage 5MB 限制。移除病人時 `ordersCacheDelete(chartno)` 清除對應 entry。
- **JSON 匯出/匯入** — 供團隊成員間分享資料。匯出產生 `.json` 檔案下載，匯入從檔案讀入並合併。

### Incremental fetch (stable-frontier, 2026-05-07)

`fetchAndStore()` 對有 IndexedDB raw-orders cache 的病患走增量更新：
ernode API 回傳 newest-first，用 `Map(ordseq → status)` 比對 cached
orders，新醫囑 prepend、status 變動（未執行→正式報告）in-place overwrite、
整頁 ALL ordseq known + status 不變 → STOP。常見情況（無新醫囑）= 每位
病患 1 個 API call。30 位病患批次更新從 150–450 call 降到 ~30 call。
無 cache 或 IndexedDB 錯誤 → graceful fall back 到 full fetch。

### Key Functions

<!-- 行號會隨 sync 變動，以下為 2026-05-07 快照 — 用 grep 確認 -->

| 函數 | 大約行號 | 說明 |
|------|---------|------|
| `LAB_TESTS` (= resolved manifest) | ~1211 | 檢驗項目定義（由 patterns 區塊 resolve） |
| `COMPUTED_TESTS` | ~1212 | 計算值定義 |
| `extractLabValues()` | ~2005 | Regex 擷取檢驗值（含 BUN filter） |
| `computeDerivedValues()` | ~2207 | 計算 URR、Ca×P |
| `renderPatientList()` | ~2447 | 渲染病患清單表格（含 sort/filter） |
| `viewPatientLab()` | ~2417+ | 渲染完整歷史檢驗表格 |

**Note:** Line numbers shift after every `sync-patterns.js` run. Use
`grep -n <functionName> hospital-lab-data.html` to find current positions.

### Build

<!-- 不需 build — 開 HTML 就能用；改 pattern 時跑 sync -->

無需建置步驟，雙擊開啟 `hospital-lab-data.html` 即可。

**Pattern 更新流程**：

1. 在 patterns repo 修改 catalog / reporter manifest / computed
2. `cd hospital-lab-patterns && npm run release`（validate + build-json）
3. `git commit && git push`（patterns repo）
4. `cd hospital-lab-reporter && node sync-patterns.js`（同步 patterns + groups 區塊）
5. 重新整理瀏覽器中的 `hospital-lab-data.html`

詳見 patterns repo 的 `docs/learning-workflow.md` 與 `docs/sop-claude-code-guide.md`。

### Related Project

姊妹專案 `hospital-lab-viewer` 是 Chrome 擴充功能，用於門診病患報告產生。兩者共用相同的 ernode API 但用途不同：
- **hospital-lab-viewer**: 門診報告列印（Chrome Extension）
- **hospital-lab-reporter**: 洗腎室檢驗資料管理（獨立網頁）

---

## 工作協定（給 Claude — Cowork 與 Code 模式皆適用）

本 repo 正在從「僅支援透析」擴展為「多疾病 group 框架」（dialysis / CKD /
DM / COPD），各 group 各自維護病人清單。Disease 模組將位於 `groups/`，
透過 `// __HOSPITAL_LAB_GROUPS_BEGIN__ / END__` 標記內嵌進
`hospital-lab-data.html`（與目前 patterns 區塊相同手法）。

### 每次修改後必做（順序不可顛倒）

1. **若需要新 pattern**：先到 `hospital-lab-patterns` 修改 → push →
   再回本 repo `node sync-patterns.js`。**不要**手改
   `hospital-lab-data.html` 裡標記之間的 pattern 區塊。
2. **若改到 `groups/<disease>.js`**：跑 sync 重新打包進 HTML。
3. **驗收**：直接用瀏覽器開 `hospital-lab-data.html` →
   - 既有病人清單仍然正常
   - 至少測一筆病人 chartNo 抓 lab → 渲染 → 匯出 CSV
   - 開檔比對 CSV 內容（refactor 階段必須與 refactor 前一致）
4. **更新 WORKLOG.md**：在最頂端新增條目，**繁體中文**。格式見下方。
   一定要標明影響哪個 group（`dialysis | ckd | dm | copd | shell | core`）。
5. **提示提交**：

   > 變更已完成，sync 已跑、瀏覽器手動測過。
   > 建議 commit message：`<scope>: <一句話說明>`
   > 例：`dialysis: extract group module (Step 1)`
   > 要我現在 git add + commit + push 嗎？

不要自動 push。

### WORKLOG.md 條目範本（繁體中文）

```markdown
## YYYY-MM-DD — 一句話摘要

- 作者：claude（與 YC 共同）
- 範圍：<dialysis | ckd | dm | copd | shell | core | sync-script>
- 變更：<新增 | 修改 | 移除>
- 檔案：<相對路徑>
- 原因：<為什麼這麼做>
- 測試：<開哪一筆 chartNo / 看到什麼結果 / CSV 是否與 refactor 前一致>
- 相依：<是否需要 hospital-lab-patterns 先發版？是否影響其他 disease group？>
```

日期取得：

- PowerShell：`Get-Date -Format yyyy-MM-dd`
- bash：`date +%Y-%m-%d`

### CSV 匯出格式（revision 1, 2026-05-04 版）

**Long format**：1 row = (chartNo × YYYYMM)。Wide-format（1 row/draw）
已不採用。

欄位順序：
```
id, YYYYMM,
<TestId>.value, <TestId>.unit, <TestId>.lower, <TestId>.higher,
... 4 cols per test, in labManifest order ...,
URR.value, URR.unit, URR.lower, URR.higher
```

每個 test 的 4-tuple 順序為 **value / unit / lower / higher**
（`lower` 在 `higher` 之前，符合自然閱讀方向）。

`lower` / `higher` 來自 catalog entry 的 `lo` / `hi`。空值就保持空格，
不要塞 `N/A` 或前一個月的值。

唯一一個匯出按鈕：「匯出 CSV」。**不再有 JSON 匯出/匯入。**

### Demographics 自動填入

ernode lab-orders 頁面開頭格式：`全部醫囑 <chartNo> <name> <sex> <age> 歲 ...`

每次 fetch 都重新解析這行，更新 patient record 的 `name` / `sex` / `age`。
這三個欄位**不在 UI 上手動編輯**。

使用者可手動編輯的兩個欄位（皆預設 `未設定`）：
- `dialysisDays`：未設定 / 一三五 / 二四六
- `shift`：未設定 / 上午 / 下午 / 夜班

### 兩個資料動作按鈕 + 大顆 匯出 CSV（hotfix 2026-05-04）

Action bar 由左到右：

```
[ ID input textarea ]
[新增清單]                       ... [更新資料] [大顆 匯出 CSV]
```

- **`新增清單`** — 從輸入框拿 chartNo（單一或列表），加進清單並 fetch
  labs + demographics。輸入框內容用完清空。
- **`更新資料`** — 不看輸入框；針對清單中**現有的**所有病人，重新
  fetch labs + demographics。執行時顯示進度（例 `更新中... 3 / 5`）。
- **`匯出 CSV`** — 視覺上明顯大顆（primary action），跟 `更新資料` 形成
  一組「對現有清單動作」。

三者共用同一個 fetch / parse / store pipeline。差別只在處理對象從哪來。

### Patient list 表格：sort + filter + per-row actions（hotfix v2 2026-05-04）

每個 column header **可點擊排序**（asc → desc → off，箭頭指示）；header
下面有 filter input：

- text 欄位（chartNo / name / age）：`<input type=text>` 子字串配對
- enum 欄位（sex / 洗腎日期 / 班別）：`<select>` 含 `(全部)` 預設
- `未設定` 永遠排在 asc 末尾（不擋首頁畫面）

Sort + filter 狀態存 localStorage（`patients_dialysis_sort` /
`patients_dialysis_filters`），網頁重整會還原。

每個 row **最右邊一欄** 有兩個 icon button：

- `↻` — 單筆病人更新（reuse 同一個 fetch pipeline，只跑這個 chartNo）
- `✕` — 從 `patients_dialysis` + `labs_dialysis` 移除，刪除前
  `confirm()` 確認

### BUN 前/後分類邏輯（hotfix v1 2026-05-04，目前實作）

vhyl 把洗後 BUN 跟 CR 一起開（`BUN洗後分開印(YL),CR洗後分開印(YL)`），
orderName 含逗號 → legacy `composite/standalone_bun` filter 判錯。
目前實作改用以下兩段式分類，parser 跑完後做一次 post-processing pass：

**主要：Method A（dateObj 排序）**

對同一日期的 BUN entries，依 `dateObj` 升冪排序：

- 1 筆 → BUN_pre，post = null
- 2 筆 distinct dateObj → 早=BUN_pre、晚=BUN_post
- 3+ 筆 全部 distinct → min/max 取兩端、中間棄置 + `console.warn`

**備援：Method B（orderName 字樣）**

當 dateObj 缺失或同日有 tie 時觸發 B：

- orderName 含 `洗後`（含 `洗後分開印` / `(洗後)`）→ BUN_post
- orderName 含 `洗前` → BUN_pre
- 都沒 → 預設 BUN_pre + `console.warn`

每次 B 觸發都會 `console.warn`，方便長期追蹤 parser 是否該修。

存儲層 `BUN_pre[]` / `BUN_post[]` 經 post-processing 後**不會有重複**，
每筆 entry 在 canonical 那邊只出現一次。

### 病人資料分離原則（重要）

每個疾病 group 的病人清單**完全分離儲存**：

```
localStorage（或 chrome.storage.local）：
  patients_dialysis: { chartNo → patient }
  patients_ckd:      { chartNo → patient }
  patients_dm:       { ... }
  patients_copd:     { ... }

  labs_dialysis:     { chartNo → [labRows] }
  labs_ckd:          { chartNo → [labRows] }
  ...
```

同一位病人若同時在兩個 group（例如 DM + CKD），他在兩邊**各被輸入一次**。
這是使用者明確的需求 — 不要自作主張改成「單一名單 + 標籤」。

### 月檢識別邏輯（透析 group — revision 1, 2026-05-04 版）

報告每月一次，邏輯如下：

1. **叢集鍵 = 完全相同的 `生效時間`**（同一張醫囑下開出來的 labs 共享同
   一個 `生效時間` —— 那就是抽血事件的錨點）。不再用 ±2 天 orderDate
   window。
2. 對每個叢集判斷是否為「常規月檢」：
   - 叢集內 test ids 與 **monthly required items** 重疊比例
     ≥ `minMonthlyOverlapRatio`（預設 0.5）。
   - monthly required items = `labManifest` 中 `periodicity` 為
     `'monthly'` 或無 `periodicity` 欄位的項目。
   - 叢集內必須出現 BUN（任一形式：`BUN` / `BUN_pre` / `BUN_post`）。
3. BUN 前 / 後判定 — **依 `簽收時間`**：
   - 同叢集內 ≥ 2 筆 BUN：依 `簽收時間` 排序，最早 = 洗腎前，
     最晚 = 洗腎後。
   - 只有 1 筆：預設為洗腎前（post = null）。
   - 不再用 `reportDateTime` —— 簽收時間是 lab 真正完成的時間，
     臨床上 pre 一定比 post 早簽收。
4. **同月多次月檢取最早**：若一位病人在同一個日曆月份（YYYYMM）有 ≥ 2
   個常規月檢，CSV 輸出取**最早的那筆**（生效時間最小的）。理由：月初的
   抽血更接近「常規月檢」時間點。

其他疾病 group 會有自己的識別邏輯（不同間隔、不同必要欄位）— 各自實作在
`groups/<id>.js` 的 `detectDraws()`。

### 不要做的事

- 不要自動 `git push`
- 不要刪除 WORKLOG.md 既有條目
- 不要手改 `hospital-lab-data.html` 內
  `__HOSPITAL_LAB_PATTERNS_BEGIN/END__` 之間的內容（sync 會覆蓋）
- 將來 groups 區塊上線後也不要手改
  `__HOSPITAL_LAB_GROUPS_BEGIN/END__` 之間的內容
- 不要將不同 disease group 的病人清單合併儲存
- 不要 commit 真實病人 HTML / JSON 匯出檔
- 不要在 refactor 階段（Step 1〜3）改變現有透析行為 — 必須 byte-identical
  或差異有清楚理由
