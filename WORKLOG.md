# WORKLOG

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
