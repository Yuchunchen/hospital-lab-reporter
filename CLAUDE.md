## Hospital Lab Reporter

<!-- 多 disease 院內檢驗案管系統 — Phase 1 build pipeline，Phase 3 起多 HTML 並存 -->

院內檢驗資料管理系統。供 2–5 人小團隊使用，管理某 disease 病患名單並
自動抓取 ernode API 檢驗數據。每個 disease 一個 standalone HTML：

- **`hospital-lab-dialysis.html`** — 洗腎室透析病人案管 + KiDiTi 匯出
- **`hospital-lab-ckd.html`** — 初期慢性腎臟病門診案管 + 腎臟病平台 xlsx 匯出（Phase 3, 2026-05-08）
- Phase 4+ 規劃：DM / ESRD（再加 group + export-format + 一行 build config）

Legacy `hospital-lab-data.html`（單檔 monolith）保留作 reference，仍由
`sync-patterns.js` 維護 markers，但**不再是 end-user 對象**。

### Architecture

<!-- core 是共用 shell；groups/ 是疾病模組；build.js 串起來 -->

```
hospital-lab-reporter/
├── core/
│   ├── shell.html              ← HTML template（{{TITLE}} {{STYLES}} {{BODY_HTML}}
│   │                              {{PATTERNS}} {{GROUPS}} {{DISEASE_INIT}}
│   │                              {{CORE_JS}} {{LIB}} {{EXPORT_FORMATS}}）
│   ├── body.html               ← <body> markup with {{HEADER_TITLE}}
│   │                              + {{ACTION_BUTTONS}} placeholders
│   ├── styles.css              ← 從 monolith <style> 抽出
│   └── 16 個 *.js              ← storage / fetch / indexeddb-cache /
│                                   enrichment / lab-extract / compute /
│                                   date-utils / ui-tabs / ui-patient-list /
│                                   ui-patient-crud / ui-remove-patient /
│                                   ui-lab-view / ui-settings / export-utils /
│                                   chart-format / init
├── groups/
│   ├── dialysis.js             ← 透析 (labManifest + detectMonthlyDraws
│   │                              + 透析-specific CSV exporter; UNCHANGED
│   │                              across all phases)
│   └── early-ckd.js            ← 初期慢性腎臟病（Phase 3, 2026-05-08）：
│                                   寬鬆 detectDrawsFromStored、
│                                   無 BUN pre/post、無 URR/CaxP
├── export-formats/
│   ├── kiditi-csv.js           ← KiDiTi 58 欄 positional CSV（Phase 2）
│   └── renal-platform-xlsx.js  ← 腎平台 23 欄 xlsx（Phase 3，含 normalizeQualitative）
├── lib/
│   └── xlsx.mini.min.js        ← SheetJS 0.18.5（CDNJS，僅 ckd build 注入）
├── build.js                    ← 讀 shell + 串 patterns / groups / core /
│                                   {{LIB}} / export-formats → 產出
│                                   hospital-lab-<id>.html
├── sync-patterns.js            ← 維護 legacy markers + 順手呼叫 buildOne()
├── hospital-lab-dialysis.html  ← BUILT — 透析病房（167 KB，end-user）
├── hospital-lab-ckd.html       ← BUILT — CKD 門診（412 KB 含 SheetJS，end-user）
└── hospital-lab-data.html      ← LEGACY monolith（過渡期保留）
```

**關鍵設計**：core/*.js 都是頂層 function 宣告，build 時 concat 進單一
`<script>` — 透過 hoist 跨模組可見，**沒有** IIFE / bundler / namespace。
與 legacy monolith 行為 1:1 對齊（風險最低）。`groups/dialysis.js` 不動。

**Active group 切換**：`build.js` 在 `{{DISEASE_INIT}}` 注入
`window.ACTIVE_GROUP_ID = '<id>';`，shell.html 把 `{{DISEASE_INIT}}` 排
在 `{{CORE_JS}}` 之前。`core/storage.js` 的 `const ACTIVE_GROUP_ID =
window.ACTIVE_GROUP_ID || 'dialysis';` 讀進來（fallback 給 legacy
HTML）。`window.ACTIVE_GROUP` 也跟著存好，給 `export-formats/*.js` 讀。

**早期 server-side 殘留**（`fetcher.js / server.js / cache.js /
patients.js / csv-compiler.js / lab-mapping.js`）非主要執行路徑，可忽略。

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

### 檢驗項目 (LAB_TESTS / CKD_MANIFEST)

**Dialysis HTML**：41 項（2026-05-08 加 FreeCa / Mg / UIBC 給 KiDiTi），
定義在 [`hospital-lab-patterns`](https://github.com/Yuchunchen/hospital-lab-patterns)
的 `patterns/reporter.js`，build 時 resolve 成 `LAB_TESTS`。

**CKD HTML**：16 項（CREAT/BUN/UA/HCT/GluAC/HbA1c/CHOL/TG/LDL/Albumin
+ 4 個尿液 [UrineOB/UrineGlucose/UrineCr/UrineProtein] + UPCR/UACR），
定義在 `groups/early-ckd.js` 的 `labManifest` — 各 disease 自包含、
不需動 `patterns/reporter.js`。

每項定義包含：`id`, `cat`, `label`, `pattern` (regex), `unit`, `ref`,
`hi`, `lo`, `filter`（可選）, `qualitative`（可選），catalog 共享 80 條
（2026-05-08 加 4 條尿液）。

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
補值。子頁面文字以 `ordapno` 為 key 持久化進 localStorage `enrichCache`
（disease-neutral 共用，2026-05-08 從 `enrichCache_dialysis` 改名 +
migration IIFE — sub-page text 跟 disease 無關，未來 CKD/DM HTML 共用
不重複 fetch；lab 報告簽收後不變動，無 TTL；體積小，保留 localStorage
不遷 IndexedDB）。Strict opt-in：non-subpage missing 的 test **不會**
brute-fetch（避免一個 globally-missing test 拖累全 order 被 fetch）。
機制細節見 `hospital-lab-patterns/PROJECT_CONTEXT.md` §4。

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

- **localStorage** — 病患清單 (`patients_dialysis`)、檢驗資料 (`labs_dialysis`)、設定 (`hd_settings`)、sub-page enrichment cache (`enrichCache`，2026-05-08 改名為 disease-neutral，未來 CKD/DM HTML 共用)。
- **IndexedDB** `LabReporterOrdersCache` (DB_VER=1, store `orders`, keyPath=chartno) — incremental fetch 用的 raw orders cache。每位病患存完整 orders 陣列 + timestamp，不受 localStorage 5MB 限制。移除病人時 `ordersCacheDelete(chartno)` 清除對應 entry。
- **JSON 匯出/匯入** — 供團隊成員間分享資料。匯出產生 `.json` 檔案下載，匯入從檔案讀入並合併。

### Incremental fetch (stable-frontier, 2026-05-07)

`fetchAndStore()` 對有 IndexedDB raw-orders cache 的病患走增量更新：
ernode API 回傳 newest-first，用 `Map(ordseq → status)` 比對 cached
orders，新醫囑 prepend、status 變動（未執行→正式報告）in-place overwrite、
整頁 ALL ordseq known + status 不變 → STOP。常見情況（無新醫囑）= 每位
病患 1 個 API call。30 位病患批次更新從 150–450 call 降到 ~30 call。
無 cache 或 IndexedDB 錯誤 → graceful fall back 到 full fetch。

### Key Functions（找原始檔，不要找 build 產出）

要看 / 改某個函數的實作，到 `core/<module>.js`（或 `export-formats/`、
`groups/dialysis.js`），不要改 `hospital-lab-dialysis.html`（每次 build
會被覆寫）。

| 函數 | 所在檔 | 說明 |
|---|---|---|
| `LAB_TESTS` / `COMPUTED_TESTS` | resolver in `build.js` 注入的 patterns 區塊 | 由 `_resolveManifest(REPORTER_MANIFEST, CATALOG)` resolve |
| `loadPatients` / `savePatients` / `loadLabData` / `saveLabData` | `core/storage.js` | localStorage helpers |
| `formatChartNo` | `core/chart-format.js` | 9 位數 + 1 字母正規化 |
| `parseDateTaiwan` / `parseDateResdttm` / `toMinguoDate` / `todayStr` | `core/date-utils.js` | 日期工具（含民國年） |
| `fetchAllOrders` / `fetchIncremental` / `parseOrdersPage` | `core/fetch.js` | ernode HTML 抓取 + stable-frontier 增量 |
| `openOrdersDB` / `ordersCacheGet/Put/Delete` | `core/indexeddb-cache.js` | IndexedDB raw orders cache |
| `enrichMissingValues` | `core/enrichment.js` | 通用 sub-page 補值（含 enrichCache localStorage） |
| `extractLabValues` | `core/lab-extract.js` | regex 擷取 + BUN A/B 後處理 + `<N>` 字串保留 |
| `computeDerivedValues` | `core/compute.js` | URR、Ca×P |
| `switchTab` / `showToast` | `core/ui-tabs.js` | tab 切換 + toast |
| `selectedPatients` Set + `toggleSelectAll` / `togglePatientSelect` / `updateSelectState` / `updateSelectUI` / `getSelectedChartNos` | `core/ui-patient-list.js`（Phase 1.5 段） | 病患勾選機制 |
| `buildPatientColumns` / `renderPatientList` / `renderPatientHead` / `renderPatientBody` / `cyclePatientSort` / `setPatientFilter` | `core/ui-patient-list.js` | 病患清單渲染 + sort + filter |
| `confirmRemovePatient` / `closeConfirm` | `core/ui-remove-patient.js` | 移除病患（含 IndexedDB + selection 清理） |
| `addAndUpdateFromInput` / `refreshExistingPatients` / `refreshOnePatient` / `fetchAndStore` | `core/ui-patient-crud.js` | CRUD + ID-list 解析 |
| `viewPatientLab` | `core/ui-lab-view.js` | 病患歷史 lab table |
| `loadSettingsUI` / `saveSettings` | `core/ui-settings.js` | 設定 tab |
| `exportCombinedCSV` / `downloadBlob` | `core/export-utils.js` | long-format CSV 匯出（delegate to `groups/dialysis.js` exporter） |
| `exportKiDiTiCSV` / `_kdt*` helpers | `export-formats/kiditi-csv.js` | KiDiTi 58 欄 positional CSV |

### Build

**End-user**：雙擊開啟 `hospital-lab-dialysis.html` 即可（build 產出）。
Legacy `hospital-lab-data.html` 仍能開但不建議再用（改用 dialysis）。

**改完 core / groups / export-formats 之後**：

```powershell
node build.js dialysis           # → hospital-lab-dialysis.html
# 或一次重產所有 disease（目前只有 dialysis）：
node build.js
```

**Pattern 更新流程**（patterns repo 改了 catalog / reporter manifest / computed）：

1. 在 patterns repo 修改 → `npm run release` → commit + push
2. 回 reporter repo 跑 `node sync-patterns.js`：
   - 重產 legacy `hospital-lab-data.html` 的 `__PATTERNS__` / `__GROUPS__` 區塊
   - **接著自動呼叫 `buildOne()` 重產所有 disease HTML**（sync 內部 chain 到 build）
3. 重新整理瀏覽器（`hospital-lab-dialysis.html`）

**npm scripts**：

```json
"build":           "node build.js",
"build:dialysis":  "node build.js dialysis",
"sync":            "node sync-patterns.js",
"sync-and-build":  "node sync-patterns.js"   // 即 sync 已 chain build
```

詳見 patterns repo 的 `docs/learning-workflow.md` 與 `docs/sop-claude-code-guide.md`。

### Related Project

姊妹專案 `hospital-lab-viewer` 是 Chrome 擴充功能，用於門診病患報告產生。兩者共用相同的 ernode API 但用途不同：
- **hospital-lab-viewer**: 門診報告列印（Chrome Extension）
- **hospital-lab-reporter**: 洗腎室檢驗資料管理（獨立網頁）

---

## 工作協定（給 Claude — Cowork 與 Code 模式皆適用）

本 repo 已過 Phase 1（2026-05-08）：單檔 monolith → `core/` 模組 +
`build.js` pipeline。Phase 3+ 將加 CKD / DM / ESRD（各 group 各自維護
病人清單，core/* 不需動）。

### 每次修改後必做（順序不可顛倒）

1. **若需要新 pattern**：先到 `hospital-lab-patterns` 修改 → `npm run release`
   → commit + push → 回本 repo `node sync-patterns.js`（會自動 chain
   到 `build.js`，順手重產 `hospital-lab-dialysis.html`）。**不要**手改
   `hospital-lab-data.html` 裡標記之間的 pattern 區塊（sync 會覆蓋），
   也**不要**手改 `hospital-lab-dialysis.html`（每次 build 會被覆寫）。
2. **若改到 `groups/<disease>.js`**：跑 `node sync-patterns.js` 重新打包
   進兩個 HTML（legacy + built）。
3. **若改到 `core/*.js` / `core/*.html` / `core/styles.css` / `export-formats/*.js`**：
   跑 `node build.js dialysis` 重產 built HTML（不影響 legacy）。
4. **驗收**：用瀏覽器開 `hospital-lab-dialysis.html`（**主要驗收對象**） →
   - 既有病人清單仍然正常（localStorage 不丟）
   - 至少測一筆病人 chartNo 抓 lab → 渲染 → 匯出 CSV / 匯出 KiDiTi
   - 勾選部分病患匯出，確認只匯出勾選的
   - 開檔比對 CSV / KiDiTi 內容（refactor 階段必須 byte-identical 或
     差異有清楚理由）
5. **更新 WORKLOG.md**：在最頂端新增條目，**繁體中文**。格式見下方。
   一定要標明影響哪個 group / 範圍（`dialysis | ckd | dm | esrd | shell |
   core | export-formats | sync-script | build`）。
6. **提示提交**：

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

### CSV 匯出格式（revision 1, 2026-05-04 版 — long format）

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
不要塞 `N/A` 或前一個月的值。按鈕：「匯出csv」。**不再有 JSON 匯出/匯入。**

### KiDiTi 檢驗記錄匯出（Phase 2, 2026-05-08）

獨立按鈕「匯出KiDiTi資料」產出 KiDiTi 平台規格的 58 欄 positional CSV。
程式碼在 `export-formats/kiditi-csv.js`：

- UTF-8 with BOM、CRLF、**無 header row**、逗號分隔、檔名
  `KiDiTi_檢驗記錄_YYYYMMDD.csv`
- 58 個 positional 欄位（順序固定，索引對應規格表）
- 日期欄位民國年 7 碼 RRRMMDD（如 `1140507` = 2025-05-07）
- HBsAg / Anti-HCV：Reactive→`Y`、Non-Reactive→`N`、缺值→`O`（未做）
- 數值欄位 `N x.y` → `toFixed(y)`；缺值 / 非數值 → 空字串（**不可填 0**，
  KiDiTi 規格「填 0 會列入統計」）
- UIBC = TIBC − Fe、Ca×P = Ca × P 在 export 函式 inline 計算（不污染
  `computeDerivedValues`，不影響 viewer）
- 月檢辨識重用 `DIALYSIS_GROUP.detectMonthlyDrawsFromStored` +
  `pickEarliestPerMonth` — KiDiTi 與 long-format CSV 日期對齊
- 規格 xls 在 `docs/format-specs/dialysis/dialysis資料轉入格式說明.xls`

### 病患勾選匯出（Phase 1.5, 2026-05-08）

病患清單表最左加 `_select` checkbox 欄（width 36px、不參與 sort/filter）。
程式碼在 `core/ui-patient-list.js`（Phase 1.5 段）：

- `selectedPatients = new Set()` 在 in-memory（**不**持久化 — 重整即清
  是預期行為）
- 5 個 helper：`toggleSelectAll`（只動可見列）、`togglePatientSelect`、
  `updateSelectState`（同步 master checkbox 的 checked / indeterminate）、
  `updateSelectUI`（按鈕文字加 `(N)` 提示）、`getSelectedChartNos`（回
  array 或 null）
- `exportKiDiTiCSV` / `exportRenalPlatformXlsx` / `exportCombinedCSV` 都
  先呼叫 `getSelectedChartNos()`：null → 全部、array → 只匯這些
- `confirmRemovePatient` 順手 `selectedPatients.delete(chartno)`
- `renderPatientList` 渲染後呼叫 `updateSelectState()`（filter / sort 後
  勾選狀態維持）

### 腎臟病平台檢驗數據匯出（Phase 3, 2026-05-08）

CKD HTML 獨立按鈕「匯出腎平台資料」產出腎臟病平台規格的 23 欄 `.xlsx`。
程式碼在 `export-formats/renal-platform-xlsx.js`，依賴 `lib/xlsx.mini.min.js`
（SheetJS 0.18.5，build 時注入到 `{{LIB}}`）。檔名
`腎平台檢驗數據_YYYYMMDD.xlsx`。

- 單一工作表「工作表1」、3 行 header（key / label / unit）
- 4 行起每筆 `(patient × draw cluster)` 一列（不 collapse 月份）
- 日期欄位西元年 `yyyy/mm/dd`（**不**民國年 — 那是 KiDiTi 專屬）
- OB / 尿糖過 `normalizeQualitative`：`-`/`+/-` → `[-]`、`1+` → `[+]`、
  `2+` → `[++]`、`4+` → `[++++]`、`+++` → `[+++]`、缺值 → 空字串
  （**不**填 `[-]`，平台會區分「未做」與「陰性」）
- Col 15 (Urine Total Protein 24hr) 一律留空（門診不做，84 病患驗證）
- Phase 1.5 勾選機制全自動 reuse — `getSelectedChartNos()` 控制 scope
- SheetJS 用 `XLSX.utils.aoa_to_sheet` + `book_append_sheet` + `XLSX.write`
  → ArrayBuffer → Blob → `downloadBlob()`（reuse core helper）

### Button bar 三顆按鈕（Phase 2 + 1.5 + 3）

各 disease 的右組第三顆按鈕不同；body.html 用 `{{ACTION_BUTTONS}}`
placeholder，`build.js` 各 disease config 自填 markup：

**Dialysis HTML**：
```
[新增清單(綠)]   [全部更新(藍, 大)] gap [匯出KiDiTi資料(橘, 大)] [匯出csv(橘, 大)]
```

**CKD HTML**：
```
[新增清單(綠)]   [全部更新(藍, 大)] gap [匯出腎平台資料(橘, 大)] [匯出csv(橘, 大)]
```

「全部更新」（原「更新資料」改名）放大成 primary action 級別；右組三顆
同 size。勾選病患後按鈕文字加 `(N)` 計數。

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

### CKD 抽血辨識邏輯（early-ckd group — Phase 3, 2026-05-08）

CKD 門診 1–3 個月不等抽血一次，沒有透析的固定每月節奏。`groups/early-ckd.js`：

1. **叢集鍵 = `生效時間`**（同 dialysis）
2. **qualifying check**：叢集內含 `CREAT` 或 `BUN` 任一個就算（透析的
   ≥50% 重疊比例 + 必須 BUN 規則對 CKD 太嚴）
3. **無 BUN pre/post**：CKD 只有通用 `BUN`（不是 `BUN_pre`/`BUN_post`）
4. **同月多次取最早**：與 dialysis 一致 — 月初的抽血更接近常規檢查
5. **匯出粒度**：腎平台 xlsx 每筆 cluster 一列（不 collapse 月份）；
   long-format CSV 收斂到 `(chartno × YYYYMM)` 一列

CKD `computed: []` — eGFR/GFRStage/TaiwanCKD 等已在 `patterns/computed.js`，
但 lab-view 表格的 computed pipeline 尚未串接 catalog computed entries
（Phase 3 不在範圍）。

### Coding behavior contract（Cowork + Claude Code 寫程式時皆適用）

> 三個 repo CLAUDE.md 共用同一份;改動請同步 patterns/viewer/reporter。Cowork 端思考規則見 `hospital-lab-patterns/docs/cowork-project-instructions.md` § 思考規則。

- **A. 外科手術式修改**:只改必須改的;不順手「最佳化」相鄰程式碼、註釋、格式;不重構沒壞掉的東西;保持與該檔現有風格一致。
- **B. 矛盾模式不混用**:同一 repo 內若已有兩種模式衝突(例如錯誤處理、命名、儲存後端、regex 風格),選一條 + 說明理由,另一條標 cleanup,不要寫「同時滿足兩套」的平均程式碼。歷史教訓:5/8 對 vhtt RATIO 的誤判就是試圖讓 vhyl/vhtt 兩套行為「自動分流」沒先選一條。
- **C. 新增程式碼前先讀**:該檔 exports、直接呼叫方、相關共享工具(reporter 端的 `core/storage.js` / `core/compute.js` / `core/lab-extract.js` / `patterns-computed.js`;sibling repo 同名模組)。不理解現有組織就先問;「在我看來不相關」是這個 codebase 最危險的話。歷史教訓:Notion #3 IndexedDB migration 之前若沒先讀 `core/indexeddb-cache.js` 已遷移 `ordersCache`、會誤以為 labs_&lt;group&gt; 也已遷;5/13 FreePSA orderNameFilter brief 是 patterns 端但同類問題。

來源:Forrest Chang 12-rule CLAUDE.md(blocktempo 2026-05-14 中文版整理,原規則 3 / 7 / 8);只挑出對應本專案實際踩過坑的條目。

### 不要做的事

- commit 後自動 `git push`；破壞性改動才先問
- 不要刪除 WORKLOG.md 既有條目
- **不要手改 `hospital-lab-dialysis.html` 或 `hospital-lab-ckd.html`** —
  每次 `node build.js <disease>` 會被覆寫；改原始檔（`core/*.js` /
  `groups/*.js` / `export-formats/*.js` / `core/{shell,body}.html` /
  `core/styles.css` / `lib/*`）然後 build
- 不要手改 `lib/xlsx.mini.min.js`（vendor，從 cdnjs 抓的；要更新版本就
  整個重新下載）
- 不要手改 `hospital-lab-data.html` 內
  `__HOSPITAL_LAB_PATTERNS_BEGIN/END__` 之間的內容（sync 會覆蓋）
- 不要手改 `__HOSPITAL_LAB_GROUPS_BEGIN/END__` 之間的內容（sync 會覆蓋）
- 不要刪 legacy `hospital-lab-data.html`（過渡期保留 reference）
- 不要在 `core/*.js` 加 IIFE / module wrapper — 設計就是頂層宣告 + concat，
  加 wrapper 會破壞 hoist 行為與 monolith 的 byte-identical 對齊
- 不要把不同 disease group 的病人清單合併儲存（`patients_<id>` /
  `labs_<id>` 各自獨立是設計需求）
- 不要把 `enrichCache` 改回 per-disease（2026-05-08 已 disease-neutral，
  CKD/DM HTML 共用同一份 sub-page text 是正確的）
- 不要 commit 真實病人 HTML / JSON 匯出檔
- 不要在 refactor 階段改變現有透析行為 — 必須 byte-identical 或差異有
  清楚理由
