# WORKLOG

## 2026-05-05 — Revision 1：UI 簡化 + 長格式合併 CSV 匯出

- 作者：claude（與 YC 共同）
- 範圍：dialysis、shell、ui、sync-script
- 變更：新增、修改、移除
- 檔案：
  - 修改 `hospital-lab-data.html`（皆在 `__PATTERNS__` / `__GROUPS__`
    標記區塊外）：
    - `parseOrdersPage()`：每筆 order 新增 `effectiveTime`（cells[4] 生效時間
      ISO 字串）與 `signOffTime`（cells[5] 簽收時間 ISO 字串）兩個具名欄位。
      `orderDate` / `receiveDate` 原始字串保留作 back-compat。
    - `extractLabValues()`：每筆 entry 額外保存 `effectiveTime` 與
      `signOffTime`。去重 key 改為優先用 `signOffTime`，退回
      `reportDateTime`，最終退回 `date+value`。`reportDateTime` 暫時保留作
      過渡期。
    - 病人清單分頁：移除「+ 新增病患」、「更新全部資料」、「匯出 JSON」、
      「匯入 JSON」、「匯出檢驗資料」5 個按鈕；改為「病歷號清單」textarea
      ＋「更新」按鈕（批次抓取）＋「匯出 CSV」按鈕（合併長格式）。
    - 病人列表欄位由 `洗腎頻率/時段` 改為 `洗腎日期/班別`，兩者均為
      inline `<select>`，`onchange` 直接持久化。預設 `未設定`。
    - 病人列「操作」由「更新／編輯／刪除」三按鈕改為單一 ✕（移除追蹤＋
      刪除檢驗資料）。
    - 移除整個 `#patientModal`（新增/編輯病患的 modal）與隱藏的
      `<input type="file" id="importFile">`。
    - 檢驗資料分頁：移除右上角「匯出 CSV」按鈕（改由病人清單頁的單一
      合併匯出取代）。`viewPatientLab()` header 改顯示
      `性別 ｜ 年齡歲 ｜ 洗腎日期 ｜ 班別`。
    - 移除函式：`showAddPatient`、`showEditPatient`、`closeModal`、
      `savePatient`、`_editIndex`、`confirmDeletePatient`、
      `updatePatient`（單筆）、`updateAllPatients`、`exportPatients`、
      `importPatients`、`exportAllLabData`、`exportPatientLabCSV`、
      `CURRENT_LAB_CHARTNO`。
    - 新增函式：`escAttr`（select option 值跳脫）、`updatePatientField`
      （inline select 持久化）、`confirmRemovePatient`、`parseChartNoList`
      （split + formatChartNo + dedupe）、`fetchAndStore`、
      `addAndUpdateFromInput`（更新按鈕主邏輯：parse → 加入新追蹤 →
      逐筆 fetch → demographics 自動填入）、`exportCombinedCSV`。
    - Demographics 自動填入策略：每次 fetch 都覆寫 `name` / `sex` / `age`
      （`sex` 取代舊的 `gender` / `genderCode`，存單一字母 M / F）；
      不再可由 UI 手動編輯。舊 `genderCode` 仍會被讀取作 fallback。
  - 重寫 `groups/dialysis.js`：
    - `patientFields` 縮為 `dialysisDays` + `shift` 兩項；丟棄
      `startDate / frequency / access / primaryDx / note`（舊資料留在
      localStorage 但 UI 忽略）。
    - `monthlyDetection` 改為 `{ minMonthlyOverlapRatio: 0.5,
      requireBUN: true }`。原 `clusterDayWindow` / `minTestsForMonthly`
      移除 — 月檢的 cluster key 直接是 exact `effectiveTime`。
    - `resolveBUN()` 改為依 `signOffTime` 排序（早 = 前、晚 = 後）；
      tie-break 規則保留（值較大 = pre）；3+ 筆 / 缺 signOffTime 仍
      console.warn；全部缺 signOffTime 才退回 legacy orderName 規則。
    - 新增 `_flattenEntriesByCluster()`：把 stored 結構 bucket 為
      `{effectiveTime → {byTestId → entries}}`，後續所有 cluster 邏輯共用。
    - 新增 `detectMonthlyDrawsFromStored(labDataForPatient)`：依
      effectiveTime cluster → 過 overlap 與 requireBUN 門檻 → resolveBUN →
      計算 URR。回傳 `[{ effectiveTime, drawDate, yyyymm, labs, computed }]`。
    - 新增 `pickEarliestPerMonth(monthlyDraws)`：每個 YYYYMM 取
      effectiveTime 最早者（per user 2026-05-04）。
    - 重寫 `resolveBunClustersFromStored()`：cluster key 改用
      effectiveTime，shape 與 lab table 既有 override map 相容
      （`{drawDate → {pre, post, urr, preDate, postDate, effectiveTime}}`）。
    - 重寫 `exporter`：移除 `buildDraws` / `format`（per-patient wide），
      改為單一 `formatAll(patients, allLabData, opts)`。輸出長格式：
      `id, YYYYMM, <test>.value, <test>.unit, <test>.lower, <test>.higher,
       ..., URR value, URR unit, URR lower, URR higher`。每測試 4-tuple
      順序為 value / unit / lower / higher（lower 在 higher 之前，符合
      brief）。`filename()` 預設 `dialysis_export_YYYYMMDD.csv`。
    - 移除 `DIALYSIS_FLAGS`（revision 1 一律走 signOffTime；不需 flag）。
  - 修改 `.gitignore`：新增 `TASK_revision*_BRIEF.md` 規則
    （原 `TASK_BRIEF*.md` 不會 match `TASK_revision1_BRIEF.md`）。
- 原因：
  - 透析室實際工作流程是「護理師每月拿到一份病歷號清單去追資料」，
    與舊 UI 的「逐筆 CRUD + JSON 互傳」差距很大。Revision 1 把 UI 對
    齊使用情境：貼清單 → 更新 → 匯 CSV → 上傳「下一個系統」。
  - ±2 天 cluster window 太鬆 — 同一張醫囑的 labs 共享 exactly equal
    生效時間，這比日期視窗更精確。
  - BUN 前/後依「簽收時間」最可靠：洗腎前的 BUN 上午簽收，洗腎後的
    BUN 下午/傍晚簽收。先前 Step 2 用的是 `reportDateTime`（從 RESDTTM
    解析），但臨床語意上 `簽收時間 (cells[5] receiveDate)` 才是正確欄位。
  - 同月多筆月檢取「最早」：月初的抽血更接近常規月檢時間點。
- 測試：
  - `node sync-patterns.js` 乾淨（patterns + groups blocks 皆更新）。
  - `new Function(inlineScript)` parse 通過。
  - 內嵌 smoke test 10 / 10 全綠：
    1. patientFields 縮為 2 項
    2. monthlyDetection 新形狀，clusterDayWindow 已移除
    3. resolveBUN 依 signOffTime 排序（亂序輸入仍正確判 pre/post）
    4. 同筆 BUN 在 BUN_pre + BUN_post 兩 testId 重複時 dedupe 為單筆
    5. detectMonthlyDrawsFromStored 對完整月檢 draw 偵測成功，URR 計算
       正確（pre=78, post=18 → URR ≈ 76.9）
    6. pickEarliestPerMonth 在同月兩 draw 中取較早 effectiveTime
    7. 只抽 2 項（Na, K, BUN）的 sparse cluster 因 overlap < 50% 被拒
    8. 完整月檢但缺 BUN 因 requireBUN 被拒
    9. CSV header 為 `id,YYYYMM,...,WBC value,WBC unit,WBC lower,WBC higher,
       ...,URR value,URR unit,URR lower,URR higher`，4-tuple 順序正確
    10. filename 符合 `dialysis_export_YYYYMMDD.csv` pattern
  - **尚待 YC 在實機瀏覽器手動驗證：**
    1. 開啟 `hospital-lab-data.html` → 病人清單分頁 UI 已是新樣貌
       （textarea + 更新 + 匯出 CSV，列表含 dialysisDays / shift selects
       與 ✕）；舊 JSON 按鈕全部消失。
    2. 貼一個已知 chartNo（如 `000810385G`）→ 按「更新」→ 出現該病患
       row，name / sex / age 自動填入；dialysisDays / shift = 未設定。
    3. 貼三筆 newline-separated chartNos → 更新 → 三筆 row，皆自動填入。
    4. 點選 chartNo → 檢驗資料表渲染，BUN(BD) / BUN(AD) / URR 顯示正確。
    5. 按「匯出 CSV」→ 開檔確認：`id,YYYYMM,...` 表頭、4 cols/test、
       一 row per (chartNo×YYYYMM)、空 cell 留白、同月多月檢取較早一筆。
    6. ✕ 移除 → 確認 modal 出現 → 確定 → 該 row 與 lab data 一併消失。
    7. DevTools console 除可預期的 `[dialysis.resolveBUN]` 警告（3+ 筆
       或缺 signOffTime 的叢集）外應乾淨。
- 相依：
  - 不需要 `hospital-lab-patterns` 先發版（patterns block 內容未變）。
  - 不影響其他 disease group（目前只有 dialysis）。
  - localStorage migration 路徑（`hd_*` → `patients_dialysis` /
    `labs_dialysis`）保留。舊 `gender` / `genderCode` 仍會被讀作 fallback；
    重抓一次後即進入 `sex` 路徑。
  - 舊 stored entries 沒有 `effectiveTime` / `signOffTime`，會 fallback
    到 date-bucket（一次 console.warn）+ legacy BUN 規則。重抓一次後即
    進入 revision 1 路徑。
- 已知/刻意保留：
  - `computeDerivedValues()` 的 URR 計算仍存在（lab table 與 CSV 都已
    改走 dialysis group resolver），目前是 dead code，未來步驟再清。
  - `parsePatientInfo()` 仍輸出 `gender`（中文「男/女」）+ `genderCode`
    （M/F），新程式只取 `genderCode → sex`。這個轉換在 fetchAndStore
    內處理。

## 2026-05-04 — BUN 前/後判定切換為報告時間制（Step 2，驗證待補）

- 作者：claude（與 YC 共同）
- 範圍：dialysis、shell
- 變更：修改
- 檔案：
  - 修改 `hospital-lab-data.html`（`__PATTERNS__` 標記區塊外）：
    - `parseDateResdttm()` / `parseDateTaiwan()` 改為保留 HH:MM(:SS)。
      原本只取年月日 → 同日抽血的前 / 後 BUN 永遠 reportDateTime 相同，
      新規則會退化為 tie-break。修完之後同日 BUN 可比較時間先後。
    - `extractLabValues()`：移除 BUN-specific filter（`composite` /
      `standalone_bun` 字串路徑），因為（a）catalog 已改用
      `orderNameFilter` 正則，那條路徑早就失效，（b）Step 2 的策略是
      在 parser 層不做 pre/post 分類，留給 dialysis group 依
      reportDateTime 重新判定。
    - `extractLabValues()`：每筆 entry 額外保存 `reportDateTime`
      （ISO 字串）與 `orderName`，供 resolveBUN 使用。
    - `extractLabValues()`：去重 key 改為 `(reportDateTime + value)`，
      讓同日不同時間的兩筆 BUN 都保留。
    - `viewPatientLab()` 新增 BUN_pre / BUN_post / URR 三列的 cell
      override：呼叫 `GROUP.resolveBunClustersFromStored(labData)`，
      把每個叢集的 pre / post / URR 結果分配到對應日期欄。所有 BUN
      叢集起始日 / pre 日 / post 日都加入欄位集合，避免純 BUN 抽血日
      被漏掉。`hasAny()` 也納入 override map 判斷。
  - 修改 `groups/dialysis.js`：
    - 新增 `DIALYSIS_FLAGS = { useReportTimeBUN: true }` 旗標（code-only，
      留作緊急回滾用）。亦掛在 `DIALYSIS_GROUP.flags` 上。
    - `resolveBUN()` 由 TODO 狀態改為實作完整版：
      - 先以 `(reportDateTime + value)` 去重
      - 0 / 1 筆按舊規則處理
      - 2+ 筆依 reportDateTime 排序：早 = pre、晚 = post
      - 同 reportDateTime 但值不同 → 較大者 = pre、較小者 = post
        （post 通常 6–25 mg/dL，遠低於 pre 60–90）
      - 3+ 筆 → console.warn，仍取 min/max
      - 部分缺 reportDateTime → console.warn，缺 time 的視為 0 排到最前
      - 全部缺 reportDateTime 或 flag=false → fallback 到 legacy
        `resolveBUNByLegacyOrderName()`：orderName 含逗號 = pre、
        orderName == "BUN" = post
    - 新增 `resolveBunClustersFromStored(labDataForPatient)`：給 shell
      呼叫的高階介面。把 `BUN_pre` + `BUN_post` + `BUN` 三個 testId 的
      stored entries 合併、依 `clusterDayWindow` 叢集，每叢套用
      `resolveBUN()`，回傳 `{ startDate: { pre, post, urr, preDate,
      postDate } }`。lab table 與 CSV exporter 共用同一個來源，避免雙
      頭真相。
    - `exporter.buildDraws()` 改為呼叫 `resolveBunClustersFromStored`
      取代原本 inline 的 URR 計算。同時略過 `BUN_pre` / `BUN_post` /
      `BUN` 三個 testId 的 dateToLabs 收集（避免 stored 重複條目誤
      變成 cell value）；改由 resolver 結果回填 `c.labs.BUN_pre` /
      `c.labs.BUN_post`。BUN cluster 起始日不在其他測試日期集合中時
      也會補上一筆 draw。
- 原因：
  - 原 filter-based 方案（orderName 含逗號 = pre、orderName="BUN" = post）
    依賴特定醫囑命名習慣。跨醫師、跨醫院、或同一病人有非月檢 composite
    醫囑時都會出錯。
  - 改為依報告時間判定 — 早抽 = 洗腎前、晚抽 = 洗腎後 — 直接對應臨床
    現實，與醫囑命名脫鉤。
  - Step 1 v3 baseline 的數據顯示 filter 路徑事實上失效（每筆 BUN(BD) =
    BUN(AD)、URR = 0），所以這個切換同時也是 bug 修復。
- 測試：
  - `node sync-patterns.js` 乾淨。
  - `node tmp/smoke-step2.js` 25/25 全綠（含去重、tie-break、3+ 筆、
    缺時間、flag=false、`resolveBunClustersFromStored` 端到端、
    `exporter.buildDraws()` 端到端）。
  - `new Function(inlineScript)` 解析通過。
  - **Side-by-side 驗證 (TASK_BRIEF 接收條件 #3) 尚未完成。** YC 已
    同意先 commit 實作版本作 checkpoint，待後續再做 baseline / after
    diff。預期：對於 Step 1 v3 baseline 中所有 BD = AD 的 row，新版會
    產生不同的 BD / AD 與真正的 URR%；其他非 BUN 欄位應與 baseline
    完全相同。
  - **尚待 YC 在實機瀏覽器手動驗證：**
    1. 重新整理 → 更新全部資料（讓新的 reportDateTime 寫進 storage）
    2. 開 000105069H 檢驗資料表 → BUN(BD) 與 BUN(AD) 應為不同數字、
       URR 不再永遠 0
    3. DevTools console 除了預期的 `[dialysis.resolveBUN]` warning
       （3+ 筆或缺 reportDateTime 的叢集）外應乾淨
    4. 匯出 CSV → 比對 baseline，BUN / URR 欄與其他欄變化是否合理
- 相依：
  - 無 patterns repo 變更。
  - 無資料遷移需求 — 舊 storage（無 reportDateTime）會走 legacy
    fallback；重抓一次後即進入新路徑。
  - `extractLabValues()` 的 `computeDerivedValues()` URR 計算保留為
    無效的 dead code（lab table 與 CSV 都改走 resolver），日後 Step 3
    再清。

## 2026-05-04 — 修復 normalizer 字串名稱解析（WBC / Platelet TypeError）

- 作者：claude（與 YC 共同）
- 範圍：sync-script、shell
- 變更：修改
- 檔案：
  - 修改 `sync-patterns.js`：把 `patterns/normalizers.js` 一併打包進
    `__HOSPITAL_LAB_PATTERNS__` 區塊（接在 catalog.js 之後、reporter.js
    之前）。原本未打包，所以 HTML 內沒有 `NORMALIZERS` 表。
  - 修改 `hospital-lab-data.html`（位於 `__PATTERNS__` 標記區塊外）：
    `extractLabValues()` 對 `test.normalize` 改為「先看是否為函式 → 否則
    當字串名稱在 `NORMALIZERS` 表查詢」。函式型寫法仍接受，向後相容。
- 原因：
  - patterns repo 將 normalize 從 inline 函式改成具名查表（`normalize:
    'wbcCount'` / `'plateletCount'`），讓 catalog 可被 JSON 序列化。
  - 但 sync-patterns.js 沒同步打包 normalizers.js，且 extractLabValues
    仍然把 test.normalize 當函式直接呼叫，導致任何 reportText 含 WBC 或
    Platelet 的醫囑，更新時都會丟出
    `TypeError: test.normalize is not a function`，整個病患更新失敗。
  - 此 bug 在今天 Step 1 v3 sync 時被觸發（先前的 sync 結果還是函式型
    catalog；今天重新 sync 後變成字串型）。
- 測試：
  - `node sync-patterns.js` 乾淨；NORMALIZERS / wbcCount / plateletCount
    都出現在 HTML 內。
  - `new Function(inlineScript)` 解析通過。
  - Node 直接呼叫 `wbcCount(6700)=6.7`、`wbcCount(6.7)=6.7`、
    `plateletCount(250000)=250`、`plateletCount(250)=250` 行為正確。
  - **尚待 YC 在實機瀏覽器手動驗證：** 重新整理 → 更新全部資料 → 確認
    DevTools console 不再出現 `test.normalize is not a function`。
- 相依：
  - 無資料遷移；不影響其他 disease group。
  - 阻擋 Step 2 baseline 匯出 — 修完才能開始 Step 2 驗證流程。

## 2026-05-04 — 透析 group 模組與紙本對齊；新增 form-aware CSV 匯出（Step 1 v3）

- 作者：claude（與 YC 共同）
- 範圍：dialysis、shell
- 變更：修改、新增
- 檔案：
  - 修改 `groups/dialysis.js`：
    - `labManifest` 重排為紙本（vhtt 病人定期檢查記錄，2019.11.07）順序，
      改為混用字串與物件兩種型式。物件可帶 `displayLabel`（讓表頭與 CSV
      使用紙本字樣）與 `periodicity`（`monthly | annual | on-admission`）。
    - 對應紙本字樣但 catalog id 不同者，採 catalog 標準 id + displayLabel
      覆寫：AST→`GOT`、ALT→`GPT`、TBili→`TBIL`、TCho→`CHOL`、
      Anti-HCV→`AntiHCV`；BUN_pre / BUN_post 顯示為 `BUN (BD)` / `BUN (AD)`；
      AntiHBs→`Anti-HBS`、AFP→`α-FP`、RPR→`VDRL/RPR`。
    - HBsAg / AntiHBs / AntiHCV / AFP 標記為 `annual`；HIV / RPR 標記為
      `on-admission`；其餘預設 `monthly`。
    - `computed` 由 `['URR','CaxP']` 縮為 `['URR']`。CaxP 在本步移出
      （TASK_BRIEF v3 的 CSV 規格不含 CaxP）。
    - 新增 `resolveManifestEntry()` helper：把字串 / 物件項目正規化為物件，
      預設 `periodicity:'monthly'`。
    - `exporter` 改寫為 form-aware wide format：
      - 新增 `exporter.buildDraws(labDataForPatient)`：把 localStorage
        `{testId: [{date, value}, ...]}` 結構依 `clusterDayWindow` 叢集，
        每叢一個 draw；同叢若有 BUN_pre + BUN_post 即計算 URR。
      - `exporter.format()` 輸出：`chartNo,name,drawDate`，接著 manifest
        每項 4 欄（`<label> value/unit/hi/lo`，label 採 displayLabel
        覆寫；若無則退回 catalog `shortLabel`），最後附 URR 4 欄。
        ref 範圍由 catalog 提供；該 draw 未抽到的項目 cell 留空（呼應紙本
        斜線，不向前帶值）。CSV cell 含逗號 / 引號 / 換行時加雙引號跳脫。
    - Kt/V 與 Aluminum 依使用者 2026-05-04 決定本步刻意延後，未列入
      manifest，CSV 也不會出現對應欄位。Mg / HDLC 因紙本未列亦不列入。
    - module CommonJS export 改為具名匯出 `{ DIALYSIS_GROUP,
      resolveManifestEntry }` 以利 headless 測試。
  - 修改 `hospital-lab-data.html`（皆在 `__GROUPS__` / `__PATTERNS__`
    標記區塊外）：
    - 檢驗資料分頁標題列新增「匯出 CSV」按鈕（未選病患時 disabled）。
    - `viewPatientLab(chartno)` 把目前病患 chartno 暫存於
      `CURRENT_LAB_CHARTNO`，啟用 CSV 按鈕。表格渲染由「全部 LAB_TESTS」
      改為「`GROUP.labManifest` 過濾後的子集」，並用 `resolveManifestEntry()`
      取出 `displayLabel` 覆寫項目名稱。category 分組維持不變（避免大幅
      UI 變動），空 category 自動跳過。
    - 新增 `exportPatientLabCSV(chartno)`：呼叫
      `GROUP.exporter.buildDraws()` + `GROUP.exporter.format()`，下載 UTF-8
      含 BOM 的 CSV（讓 Excel 正確顯示中文表頭）。檔名來自
      `GROUP.exporter.filename(patient)`，預設 `dialysis_<chartno>.csv`。
- 原因：
  - 與紙本對齊：紙本表格決定哪些檢驗每月做、哪些一年做、哪些只在入院做；
    CSV 必須能直接套進透析室既有工作流程，所以採紙本的順序與字樣，並
    保留紙本的「未抽就留白」斜線語意。
  - Kt/V 與 Aluminum 的延後是為了等 ground truth 資料：vhyl 的 000105069H
    探查顯示 0 筆 Aluminum 紀錄，先不收。若日後在 patterns repo 把它們加回
    reporter manifest，再重啟並把對應紙本欄位接回即可（重啟條件記錄在
    patterns repo 的 `TASK_BRIEF.md`）。
- 測試：
  - `node sync-patterns.js` 乾淨：`✓ Updated patterns block` +
    `✓ Updated groups block (1 file)`。
  - `node tmp/smoke-step1-v3.js` 38 個 assertion 全綠（含 manifest
    periodicity / displayLabel 對應、buildDraws 叢集行為、URR 計算、
    format 表頭欄位數 = 3 + manifest×4 + URR×4 = 155、Kt/V 與 Aluminum
    確認不在 header 等）。
  - `new Function(inlineScript)` 解析內嵌 JS 通過。
  - **尚待 YC 在實機瀏覽器手動驗證：**
    1. 開啟 `hospital-lab-data.html`，舊有病患清單仍顯示
    2. 點選 chartNo `000810385G` → 檢驗資料表渲染（採 manifest 過濾，
       BUN(BD)/BUN(AD) 等紙本字樣出現）
    3. 點「匯出 CSV」→ 開啟 .csv，確認：
       - 表頭採紙本字樣（`BUN (BD)`、`Anti-HBS`、`α-FP`、`VDRL/RPR` 等）
       - 每項 4 欄（value / unit / hi / lo）
       - 該月未抽的項目 value 為空
       - URR 在最末 4 欄
       - 沒有 Kt/V、Aluminum 欄
    4. DevTools console 無錯誤、無警告
- 相依：
  - 不需要 `hospital-lab-patterns` 先發版。
  - 不影響其他 disease group（目前只有 dialysis）。
  - `sync-patterns.js` 沒改（既有路徑已能 bundle `groups/*.js`）。
- 已知/刻意保留問題（不在本步處理）：
  - 月檢叢集偵測仍只用 `orderDate`（exporter.buildDraws 從現有 stored
    格式重建）；Step 2 的 reportDateTime BUN 前 / 後切換仍未啟動，
    `resolveBUN()` 維持休眠。
  - 月檢「至少 N 項才算月檢」門檻（`minTestsForMonthly: 8`）目前由
    `detectMonthlyDraws()` 使用，但 `exporter.buildDraws()` 為了不誤刪
    部分抽血未過門檻的 draw（例如只有電解質、單做 BUN 等），目前每個
    叢集都產出 row。如需後續用 minTestsForMonthly 過濾，等 Step 2/3
    決定。
  - 操作性病人欄位（體重、血流量、透析時間、A-K、EPO）仍未在 modal
    渲染；`patientFields` 仍只在 dialysis.js 中宣告，UI 改造留給後續步驟。

## 2026-05-04 — 透析模組從 single-file HTML 抽出為 groups/dialysis.js（Step 1）

- 作者：claude（與 YC 共同）
- 範圍：dialysis、shell、sync-script
- 變更：新增、修改
- 檔案：
  - 新增 `groups/dialysis.js`：DIALYSIS_GROUP 物件，含 id/label、storageKey、
    patientFields、labManifest、computed、monthlyDetection、resolveBUN（休眠）、
    detectMonthlyDraws（休眠）、CSV exporter、helpers。透過
    `window.GROUPS = window.GROUPS || {}; window.GROUPS.dialysis = ...`
    暴露為 registry 模式（為 Step 4–6 加入 CKD / DM / COPD 預留）。
  - 修改 `hospital-lab-data.html`：
    - 在 `__HOSPITAL_LAB_PATTERNS_END__` 後加入新標記對
      `__HOSPITAL_LAB_GROUPS_BEGIN__ / __HOSPITAL_LAB_GROUPS_END__`，由 sync 填入。
    - `STORAGE_KEYS.patients` / `.labData` 改為從 `window.GROUPS.dialysis.storageKey`
      取得（patients_dialysis / labs_dialysis）；settings 仍為 shell-global
      (`hd_settings`)。
    - 新增 `migrateLegacyStorage()` IIFE：若新 key 為空但 `hd_patients` /
      `hd_labData` 存在則複製過去；舊 key 保留作為一個版本的 fallback。
    - `ACTIVE_GROUP_ID = 'dialysis'` 硬編碼，等 Step 3 加上分頁 UI 後再切換。
  - 修改 `sync-patterns.js`：除原本的 patterns block sync 外，新增掃描
    `groups/*.js`（alpha-sorted）並寫入 GROUPS 標記之間的流程，包含 banner +
    每檔分隔線。
- 原因：
  - `hospital-lab-reporter` 將從「僅支援透析」擴展為多疾病 group 框架
    （dialysis / CKD / DM / COPD）。Step 1 是純 refactor，把所有透析專屬邏輯
    抽進獨立模組，不改變使用者可見行為。抽出後的模組將成為 CKD / DM / COPD
    模組的範本。
  - 採 registry (`window.GROUPS.dialysis`) 而非單一全域 (`window.GROUP_DIALYSIS`)
    是 YC 確認的選擇 — 為 Step 3 多 group 並存做準備。
- 測試：
  - `node sync-patterns.js` 乾淨執行：`✓ Updated patterns block` +
    `✓ Updated groups block (1 file)`。
  - 解析 inline JS（用 `new Function`）通過。
  - Headless smoke test（mock window/localStorage）驗證：
    - `window.GROUPS.dialysis` 註冊成功，id / storageKey 正確
    - 預先放入 `hd_patients` / `hd_labData` 後，`patients_dialysis` /
      `labs_dialysis` 被自動複製
    - 舊 key 保留為 fallback
    - 病人陣列內容（chartno=000810385G）byte-identical
  - **尚待 YC 在實機瀏覽器手動驗證：**
    1. 開啟 `hospital-lab-data.html`，舊有病患清單仍存在
    2. 點選一筆病患 → 檢驗資料表渲染外觀與 refactor 前一致
    3. 「匯出 JSON」內容與 refactor 前一致（檢驗 patients + labData）
    4. DevTools console 無錯誤、無警告
- 相依：
  - 不需要 `hospital-lab-patterns` 先發版（patterns block 內容未變）。
  - 不影響其他 disease group（目前只有 dialysis）。
- 已知/刻意保留問題（不在本步處理）：
  - `hospital-lab-data.html` 的 `extractLabValues()` 仍走
    `test.filter === 'composite'` / `'standalone_bun'` 字串路徑；但同步進來的
    REPORTER_MANIFEST 對 BUN_pre / BUN_post 設的是 `orderNameFilter` 正則，
    不是 `filter` 字串。此分支已實質失效（BUN_pre 與 BUN_post 都收到所有 BUN）。
    Step 1 維持 byte-identical 行為，不修；`groups/dialysis.js` 的
    `resolveBUN()`（reportDateTime-based）已寫好但休眠，Step 2 會切換並驗證。
  - `labManifest` 中 TASK_BRIEF 原列的 `Mg` / `HDL` 不在現行 reporter
    manifest，已暫時略；`ALT` / `TBili` / `TCho` / `HDL` 已對齊 catalog 標準
    id（`GPT` / `TBIL` / `CHOL` / `HDLC`）。要把 `Mg` / `HDLC` 加回 manifest
    需先在 `hospital-lab-patterns/patterns/reporter.js` 收錄。
  - `patientFields`（startDate / frequency / access / primaryDx / note）已定義
    但 modal UI 仍硬編碼 chartno / name / schedule / shift。Step 2+ 會把
    modal 改成從 patientFields 渲染。
  - CSV exporter 已寫好但無 UI 按鈕接上；`exportAllLabData()` 仍輸出 JSON。
