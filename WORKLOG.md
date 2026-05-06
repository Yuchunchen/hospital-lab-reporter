# WORKLOG

## 2026-05-07 — 補齊 CLAUDE.md 檔案地圖、新建 README.md

- 作者：claude（與 YC 共同 — Cowork 模式）
- 範圍：core（repo 文件，不影響執行邏輯）
- 變更：修改 + 新增
- 檔案：
  - `CLAUDE.md`：
    - Architecture 區補上 `groups/dialysis.js` 條目（labManifest /
      detectMonthlyDrawsFromStored / CSV exporter），並標明它由
      `sync-patterns.js` 內嵌進 HTML 的 groups 標記區塊。
    - 把 `__HOSPITAL_LAB_PATTERNS_BEGIN/END__` 與
      `__HOSPITAL_LAB_GROUPS_BEGIN/END__` 兩段標記區塊明列出來，附
      2026-05-07 當下的大約行號（patterns ~322–1213，groups ~1215–）。
    - 新增 server-side stack 條目（`fetcher.js` / `server.js` /
      `cache.js` / `patients.js` / `csv-compiler.js` / `lab-mapping.js`），
      標註「目前使用者實際 flow 走的是 client-side，這些檔案非主要
      執行路徑」— 避免未來 Claude 誤改 server-side code 以為會生效
      （與 2026-05-06 BUN(AD) bug 同樣的誤判）。
    - 修正 Key Functions 表中已過時的行號區間：原表是 refactor
      前（patterns/groups 還沒拆出來時）的行號，現在 sync 之後位置
      整個位移，且 `exportAllLabData()` / `importPatients()` 已隨
      JSON 匯出移除而不存在。改成「大約行號」並補一條 Note
      提醒每次 `sync-patterns.js` 之後行號會位移，請用
      `grep -n <functionName> hospital-lab-data.html` 定位。
    - Pattern 更新流程補上 `npm run release` 步驟（validate +
      build-json），並提到 sync 同時更新 patterns + groups 兩段標記。
  - `README.md`（新建）：repo 對外簡介 — 用途、檔案清單（標出
    server-side 非主要執行路徑）、pattern source、quick start、
    feature list、隱私守則。給未進 Claude Code 的人看。
- 原因：
  - 2026-05-06 修 BUN(AD) bug 時發現 CLAUDE.md 沒提到
    `groups/dialysis.js` 的存在，也沒提到 server-side stack 是備用的，
    以致初步 debug 時誤往 `csv-compiler.js` 找 root cause；實際 bug
    在 client-side `groups/dialysis.js` 的 `detectMonthlyDrawsFromStored`。
    這次補齊檔案地圖，避免下次再走冤枉路。
  - Key Functions 表的行號過時太久 — patterns/groups 內嵌之後，
    主程式的 LAB_TESTS 從 line 363 漂到 ~1211，差將近 850 行，誤導
    性比有用性高。改成「大約行號 + 用 grep 確認」更實用。
  - README.md 此前不存在；GitHub repo 首頁直接顯示「No description」，
    不利協作。
- 測試：
  - 純文件修改，無程式碼變更，未跑 `node sync-patterns.js`。
  - 用 `grep -n` 抽查 CLAUDE.md 新表中的行號（LAB_TESTS、
    extractLabValues、computeDerivedValues、renderPatientList）皆
    對得上 `hospital-lab-data.html` 當下的位置，誤差 ≤ 5 行。
  - `hospital-lab-data.html` 未動，瀏覽器行為不變。
- 相依：
  - 不需 patterns repo 發版。
  - 不影響其他 disease group（目前只有 dialysis）。

## 2026-05-06 — 修復 CSV BUN(AD) 為空 root cause（drawDateIso 時區漂移）

- 作者：claude（與 YC 共同）
- 範圍：dialysis（前端 client-side CSV 匯出 — `groups/dialysis.js` 與
  `hospital-lab-data.html` 內 `__HOSPITAL_LAB_GROUPS__` 標記區）
- 變更：修改
- 檔案：
  - `groups/dialysis.js`：`detectMonthlyDrawsFromStored` 內
    `drawDateIso` 推導改成 local-time 格式（沿用 `getFullYear()` /
    `getMonth() / getDate()`），不再用 `bucket.effectiveTime.slice(0, 10)`。
  - `hospital-lab-data.html`：跑 `node sync-patterns.js` 重新打包
    inline groups 區塊，把上述修正同步進 HTML。
- 原因：
  - 使用者回報 `000006658A` 的 BUN(AD) 在 reporter 報表畫面正常顯示，
    但「匯出 CSV」產生的 `dialysis_export_*.csv` 中所有
    `BUN (AD) value / lower / higher` 全空，只有 `BUN (AD) unit` 有值
    （unit 從 catalog 直接抓）。BUN(BD) 全部正常。
  - 「匯出 CSV」按鈕完全跑在 client side
    （`hospital-lab-data.html:2940-2955` `exportCombinedCSV` →
    `loadLabData()` → `GROUP.exporter.formatAll`，再進
    `groups/dialysis.js` 的 `detectMonthlyDrawsFromStored`），
    本 repo 內 `fetcher.js / server.js / csv-compiler.js` 那條
    server-side stack 跟使用者實際 flow 無關。
  - root cause 在 `detectMonthlyDrawsFromStored`：
    1. `bucket.effectiveTime` 是用 `Date.toISOString()` 產生的 UTC ISO
       字串（`parseOrdersPage` line 1920 `effectiveDt.toISOString()`）。
    2. `drawDateIso = bucket.effectiveTime.slice(0, 10)` 直接砍前 10
       字元 → 在 TPE (UTC+8) 拿到的是「**前一天**」的 UTC date。
       例：Taiwan local 2026-04-14 00:00 → ISO `2026-04-13T16:00:00Z`
       → slice(0,10) = `2026-04-13`。
    3. `bunIdx.post[drawDateIso]` 卻是用 entry `e.date` 當 key，而
       `e.date = toSortableDate(dateObj)` 用的是 local 的
       `getFullYear()/getMonth()/getDate()` → key 是 `2026-04-14`。
    4. UTC `2026-04-13` ≠ local `2026-04-14` → 永遠 miss → CSV 的
       `BUN (AD) value` 全空（unit / lower / higher 三欄是從 catalog
       直接抓的，所以 unit 還在）。
  - 為什麼 BUN(BD) 沒事：`pre` lookup 有 fallback
    `bucket.byTestId.BUN_pre[0]`（pre entry 跟 panel 在同一個
    effectiveTime 叢集），所以 `bunIdx.pre[drawDateIso]` miss 了還能
    從 bucket 裡撿回來；`post` lookup **沒有 fallback**，因為 post 是
    自己的 effectiveTime 叢集，不在 pre bucket 內。
  - 為什麼 labview 螢幕顯示是對的：螢幕走的是
    `resolveBunClustersFromStored`（line 1549–1582），它用
    `_indexBunByDate` 直接拿 `e.date` 做 key、`Object.keys(preIdx ∪ postIdx)`
    迭代，pair 邏輯不依賴 `effectiveTime` 推算的 drawDateIso，所以時區
    漂移不影響它。
- 測試：
  - 用 `node -e` 確認時區行為：在 TPE，`new Date(2026, 3, 14).toISOString().slice(0,10)`
    = `2026-04-13`，但 local 格式為 `2026-04-14` — 完全符合假設。
  - 修法只動 drawDateIso 的推導路徑（同一個 Date 物件改用 local
    accessors），不變更 bucket 邏輯也不動 BUN_pre/BUN_post 陣列內容。
  - 手動驗證（瀏覽器）由使用者：
    1. 重新整理 `hospital-lab-data.html`（拿到新版 inline groups）。
    2. 不需要重抓資料 — 修法只影響 reader 端。
    3. 點「匯出 CSV」→ 開啟 CSV，確認 `BUN (AD) value` 欄位有值。
    4. 比對 `000006658A` 螢幕 vs CSV 的 BUN(AD)，應一致。
- 相依：
  - `hospital-lab-patterns` 不需動。
  - `hospital-lab-viewer` 不需動。
  - 不影響其他 disease group。
  - 不影響 cache，不需重抓資料。

## 2026-05-06 — Sync EarlyCKD 非 CKD 時回傳「正常」(Phase C)

- 作者：claude（與 YC 共同）
- 範圍：sync-script
- 變更：修改（純 sync timestamp，不動 reporter 自身邏輯）
- 檔案：
  - 重跑 `node sync-patterns.js`，從 sibling repo `hospital-lab-patterns`
    （commit `437683c` — `EarlyCKD` 非 CKD 時改回傳 `'正常'`）拉取最新
    來源。
  - `hospital-lab-data.html`：本輪只有兩處 timestamp 刷新
    （`__HOSPITAL_LAB_PATTERNS_*__` 與 `__HOSPITAL_LAB_GROUPS_*__`），
    inline 內容無 catalog/manifest 變動。新版
    `Synced at: 2026-05-05T22:04:10.016Z`。
- 原因：
  - patterns repo 的 Phase A 改動只動到 `patterns/computed.js`
    （`EarlyCKD()` 第二個 return 由 `null` 改成 `'正常'`），catalog 與
    reporter manifest 都沒動。
  - reporter 的 `sync-patterns.js` 只 inline `catalog.js` /
    `normalizers.js` / `reporter.js`，**沒有 inline `computed.js`**，
    所以 patterns 端的 `EarlyCKD()` 函式本來就不在 reporter HTML 內。
  - 即使 inline，也無作用 — `REPORTER_MANIFEST`（line 1083–1155）並未
    列入 `EarlyCKD` / `TaiwanCKD` / `UACR*` / `UPCR*` / `KDIGORisk` /
    `GFRStage`，`_resolveManifest()` 解析後的 `LAB_TESTS` 不會包含這些
    早期 CKD 分期 id；reporter UI 表格不會渲染這欄。
  - reporter 自身的 `computeDerivedValues()`（line 2195–2234）也只處理
    `URR` 與 `CaxP` 兩個透析專用 computed，沒有 client-side render
    EarlyCKD 的迴圈 — 對應 task brief Phase C step 2 的「如無，純 sync
    即可」分支。
- 測試：
  - `git diff hospital-lab-data.html`：2 inserts / 2 deletes，僅兩處
    sync timestamp，inline catalog / manifest / groups 內容
    byte-identical。
  - 用 grep 確認 reporter HTML 內仍只有一處 `EarlyCKD` 出現（catalog
    entry line 643），沒有任何 reporter manifest 或 client-side render
    引用。
  - 預期效果：reporter UI 行為與本輪 sync 前完全一致（不會渲染
    EarlyCKD 欄；亦不受 patterns 端「非 CKD 時顯示正常」邏輯影響）。
  - 瀏覽器手測：本輪 claude 端無法直接開瀏覽器，由使用者重整
    `hospital-lab-data.html` 後快速確認既有透析病人列表與檢驗表格無
    異常即可（不期待出現新欄位）。
- 相依：
  - 需要 `hospital-lab-patterns@437683c` 已 push（已確認 origin/main
    在 437683c，本地 sync 已成功讀到）。
  - Phase A（patterns computed.js）+ Phase B（viewer report.js +
    patterns-computed.js sync）為前置；本 phase 為三 repo 連動最後
    一棒，本次 reporter 端為 no-op sync 留底以保 timestamp 一致性。
  - 不影響其他 disease group（CKD / DM / COPD）。

## 2026-05-06 — Sync 肝炎顯示集中化 (Item B Phase 3)

- 作者：claude（與 YC 共同）
- 範圍：sync-script
- 變更：修改（純 sync，不動 reporter 自身邏輯）
- 檔案：
  - 重跑 `node sync-patterns.js`，從 sibling repo `hospital-lab-patterns`
    拉取最新 catalog（含 Item B 肝炎顯示集中化）。
  - `hospital-lab-data.html`：HTML inline pattern block
    （`__HOSPITAL_LAB_PATTERNS_*__`）新增 5 條 catalog entry、修改
    1 條既有 entry，並把既有 HCV computed wrapper 補上 `needs`：
    - 新：`HBsAgTiter`（`HBsAg:\s*([\d.]+)`）— viewer computed 用的
      raw 數值滴度。
    - 新：`AntiHBsTiter`（`Anti-HBs:\s*([\d.]+)`）— 同上。
    - 新：`AntiHCVTiter`（`(?:HCV Ab|Anti-HCV):\s*([\d.]+)`）— 同上。
    - 新：`HBsAgDisplay`（`computed:'HBsAgDisplay'`,
      `needs:['HBsAg','HBsAgTiter']`）— viewer 顯示用 wrapper。
    - 新：`AntiHBsDisplay`（`computed:'AntiHBsDisplay'`,
      `needs:['AntiHBs','AntiHBsTiter']`）— 反向 polarity wrapper
      （Reactive=有抗體=normal）。
    - 改：既有 `AntiHBs` raw 條目同步對齊 vhyl 樣式
      `Anti-HBs\s*(?:\((?:TT|YL)\))?:\s*([^\s\d]\S*)`（Issue 2 順手
      帶進來）。
    - 改：既有 `HCV` computed 條目補上 `needs:['AntiHCV','AntiHCVTiter']`。
  - Groups block（`__HOSPITAL_LAB_GROUPS_*__`）僅 timestamp 刷新，
    內容無變動。
- 原因：
  - Item B Phase 1（patterns）、Phase 2（viewer）已完成；Phase 3
    要求 reporter 只跑 `node sync-patterns.js`，不改 code。
  - sync 腳本是 inline 整份 catalog（不只 reporter manifest 內條目），
    所以 5 條新 entry 都會進 inline block。但 `_resolveManifest()`
    只 resolve `REPORTER_MANIFEST` 列出的 id → reporter UI 仍只渲染
    raw `HBsAg` / `AntiHBs` / `AntiHCV`，新加的 Titer / Display 條目
    不會出現在表格。
  - 跟 Phase 3 第 7 節「reporter 不變」的設計一致。
- 測試：
  - `git diff hospital-lab-data.html`：47 inserts / 4 deletes，全部
    集中在 catalog block 內肝炎區段 + 兩處 sync timestamp。沒有任何
    reporter 邏輯（`extractLabValues` / `viewPatientLab` /
    `parseOrdersPage` 等）被動到。
  - reporter manifest（patterns/reporter.js）沒列入 `HBsAgDisplay` /
    `AntiHBsDisplay` / `*Titer`，所以 `_resolveManifest()` resolve 出
    的 `LAB_TESTS` 仍只含舊有 raw 條目，UI 表格不會多欄。
  - 瀏覽器手測（由 YC 執行）：fetch vhyl `000151649A`，確認 HBsAg /
    Anti-HBs / Anti-HCV 表格欄位仍顯示 raw `Non-Reactive` /
    `Reactive`，沒有被誤套成 viewer 的「正常 (HBsAg 0.21)」格式。
- 相依：
  - 需要 `hospital-lab-patterns` Phase 1 已 push（包含 5 條新
    catalog entry + computed.js 三個顯示函式）— 本次 sync 已成功
    讀到，視為已 push。
  - 不影響其他 disease group（CKD / DM / COPD）。
  - 不影響 reporter 的任何既有行為（pure sync）。

## 2026-05-06 — Sync GPT/RGT/BUN/CREAT/UA gender-aware hiM/hiF (Phase C)

- 作者：claude（與 YC 共同）
- 範圍：sync-script
- 變更：修改（純 sync，不動 reporter 自身邏輯）
- 檔案：
  - 重跑 `node sync-patterns.js`，從 sibling repo `hospital-lab-patterns`
    （commit `4a1a0b9`）拉取最新 catalog。
  - `hospital-lab-data.html`：HTML inline pattern block
    （`__HOSPITAL_LAB_PATTERNS_*__` 標記區）刷新，GPT / RGT / BUN /
    CREAT / UA 共 5 個 entry 各加上 `hiM` / `hiF` 兩個欄位（BUN 另
    多一行 `notes` 說明 fallback 25.7 的設計緊縮）。Groups block
    （`__HOSPITAL_LAB_GROUPS_*__`）僅 timestamp 刷新。新版
    `Synced at: 2026-05-05T20:59:51.004Z`。
- 原因：
  - patterns repo 於 2026-05-05 push commit `4a1a0b9` 把 Issue 1
    backlog 第 1 條收尾 — 5 條原本 `hi` 鎖男性、女性中段值漏 alarm
    的 catalog entry 補上 gender-aware threshold。
  - 跨 repo 副作用清單第 3 步：reporter 是 inline pattern block，
    沒有 runtime fetch 機制，必須靠 `sync-patterns.js` 重打包。
  - 2026-05-05 Phase 3 已把 `viewPatientLab()` 的 alarm 計算改成
    gender-aware（line ~2864–2869，依 `patient.sex` 挑 `hiM/hiF` 或
    `loM/loF`，未知性別退回 `lo/hi`）。本輪 5 條新欄位會自動被
    既有邏輯吃進，**不需改 reporter code**。
- 測試：
  - `git diff hospital-lab-data.html`：5 條 entry 全部正確帶入
    `hiM/hiF`，兩處 timestamp 刷新，無其他變動（18 inserts / 7
    deletes，全部集中在 catalog block + 兩個 sync timestamp）。
  - 用 grep 確認 inline pattern block 已含 `hiM:45, hiF:34`（GPT,
    line 453）、`hiM:55, hiF:38`（RGT, 462）、`hiM:20.6, hiF:18.7`
    （BUN, 551）、`hiM:1.2, hiF:1.0`（CREAT, 584）、`hiM:7.7, hiF:6.2`
    （UA, 594）。Phase 3 既有的 6 條 RBC/Hb/HCT/Fe/TIBC/Ferritin
    `loM/hiM/loF/hiF` 仍在原處（line 378/387/397/710/719/736）。
  - 預期效果：
    - 女性病人 GPT 40 → 紅（女 hi 34）；男性 GPT 40 → 黑（男 hi 45）
    - 女性 BUN 19 → 紅（女 hi 18.7）；男性 BUN 19 → 黑（男 hi 20.6）；
      未知性別 BUN 19 → 黑（fallback hi 25.7）
    - CREAT / UA / RGT 同模式
  - 瀏覽器手測：本輪 claude 端無法直接開瀏覽器，由使用者重整
    `hospital-lab-data.html` 後肉眼確認男女病人的肝腎功能列。
- 相依：
  - 需要 `hospital-lab-patterns@4a1a0b9` 已 push（已確認 origin/main
    在 4a1a0b9）。
  - Phase A（patterns）+ Phase B（viewer sync）為前置；本 phase
    為三 repo 連動最後一棒。
  - 只動 dialysis pattern 區塊；CKD / DM / COPD groups block 內容
    無變動。

## 2026-05-05 — reporter 對齊性別感知 threshold (Phase 3)

- 作者：claude（與 YC 共同）
- 範圍：dialysis（reporter 端 alarm 邏輯）+ sync-script
- 變更：
  - 重跑 `node sync-patterns.js`，把 `hospital-lab-patterns` 最新
    catalog 的 6 條 gender-aware 欄位（`loM` / `hiM` / `loF` / `hiF`）
    拉進 `hospital-lab-data.html` 的 inline pattern block。
  - 修改 `viewPatientLab()` 內部表格渲染處（line ~2845 附近）的數值
    alarm 計算：依 `patient.sex`（`'M'` / `'F'`）挑選對應的
    `loM/hiM` 或 `loF/hiF`；性別未知時退回 `lo` / `hi`（在這 6 條
    對應的是 manifest `hi:null lo:null`，等同維持原本不亮 alarm）。
- 檔案：
  - `hospital-lab-data.html`
    - inline pattern block（`__HOSPITAL_LAB_PATTERNS_*__` 標記區）
      重 sync；6 條 entry（RBC / Hb / HCT / Fe / TIBC / Ferritin）
      resolved 後的形狀為 `lo:null hi:null`（manifest override）
      + `loM/hiM/loF/hiF`（catalog 新欄位，manifest 沒這個 key 所以
      `Object.assign({},catalog,manifest)` 不會覆蓋掉）。
    - `viewPatientLab()`：alarm 計算分支加 gender pick + fallback
      註解，邏輯與 TASK_BRIEF 第 7 節範例對齊。
- 原因：
  - vhyl 000151649A（女）Fe 58 被 viewer 誤判過低 → patterns repo
    引入 `loM/hiM/loF/hiF` 後，viewer 已修；本 phase 把 reporter
    也同步上去。
  - 使用者選擇 (α) 方案：接受 reporter 透析表開始亮 RBC / Hb / HCT /
    Fe / TIBC / Ferritin 6 條 gender-aware alarm，**不在 manifest
    補 `loM/hiM/loF/hiF:null`** 蓋掉 catalog 新欄位。即:這 6 條
    在 reporter 從「永遠不亮 alarm」→「依性別亮 alarm」是有意的
    視覺變更，不是 regression。
- 驗證：
  - sync 後肉眼檢查 inline pattern block：6 條 catalog entry 都帶
    `loM/hiM/loF/hiF`（line 372-398, 693-727），manifest 那邊保留
    `hi:null lo:null` 不動（line 1032-1089），合併後 resolved
    entry 同時有兩組（catalog 新欄位活的、manifest 把舊欄位 null）。
  - 用 node 跑 standalone 模擬 resolver + 新 alarm 邏輯，跑完
    TASK_BRIEF 第 8 節 11 個樣本 + 額外 6 個 RBC/HCT/TIBC 樣本
    （共 17 個），全部 pass：
    - 女 Fe 58 → normal（F lo:50）✓
    - 男 Fe 58 → val-lo（M lo:65）✓
    - 女 Hb 13 → normal、男 Hb 13 → val-lo ✓
    - 女 Ferritin 250 → val-hi（F hi:204）✓
    - unknown 性別 Fe 58 → normal（reporter 在這 6 條 fallback
      到 `lo:null hi:null`，不亮 alarm；對「不誤判」目標仍成立）。
  - 瀏覽器手測：本輪 claude 端無法直接開瀏覽器，由使用者重整
    `hospital-lab-data.html` 後肉眼確認男女病人的鐵代謝列。
- 相依：
  - 需要 `hospital-lab-patterns` 已 push（catalog.js 包含
    `loM/hiM/loF/hiF` 6 條欄位）。Phase 1 + Phase 2 已完成，
    本 phase 為三 repo 連動的最後一棒。
  - 其他 disease group（CKD / DM / COPD）尚未上線；本變更只動
    dialysis 渲染路徑，groups block 內容無變動。
  - Backlog（不在本輪）：GOT / GPT / RGT / BUN / CREAT / UA 6 個
    test 的 `hi` 鎖男性、女性中段值漏 alarm，等使用者實際遇到再
    開新 brief。

## 2026-05-05 — Sync vhyl 5 條 regex 放寬（HBsAg / AntiHCV / AFP / TSAT / Fe）

- 作者：claude（與 YC 共同）
- 範圍：sync-script
- 變更：重 sync（不改 reporter 自身邏輯）
- 檔案：
  - 重跑 `node sync-patterns.js`，從 sibling repo
    `hospital-lab-patterns`（commit `58eed17`）拉取最新 catalog。
  - `hospital-lab-data.html`：HTML inline pattern block
    （`__HOSPITAL_LAB_PATTERNS_*__` 標記區）刷新，HBsAg、AntiHCV、AFP、
    TSAT、Fe 共 5 個 entry 的 `pattern` 已替換（每條上方帶
    `// vhyl sample (2026-05-05): ...` 註解）。Groups block
    （`__HOSPITAL_LAB_GROUPS_*__`）也刷新時間戳，內容無實質變動。
    新版 `Synced at: 2026-05-05T15:09:27.196Z`。
- 原因：
  - 使用者回報 vhyl 病人 000151649A 的 HBsAg / Anti-HCV / AFP、
    000051055E 的 Fe 在 reporter 漏顯示；連帶發現 TSAT 舊 regex
    `/SAT:/` 對 vhyl 的 `TS:` label 不命中。
  - patterns repo 已於 2026-05-05 push commit `58eed17`，依跨 repo
    副作用清單，reporter 必須重 sync（reporter 是 inline pattern block，
    沒有 runtime fetch 機制，所以只能靠 sync + 使用者拿新 HTML）。
- 驗證：
  - `git diff hospital-lab-data.html` 確認 5 條 pattern 全部正確替換、
    `// vhyl sample (...)` 註解都已帶入。
  - patterns repo 端的 `npm run release` + spot-check（18/18 pass）已
    覆蓋 regex 行為驗證；reporter 端只是純粹 re-bundle，無新 logic。
  - 預期：reporter 重 fetch 000151649A 後，HBsAg / Anti-HCV / AFP / TSAT
    在表格與 CSV 都會出值（`Non-Reactive` / `Non-Reactive` / `< 2.00` /
    `22`）；000051055E 的 Fe 若仍漏 → 表示該病人未抽 Fe，另案。
- 相依：
  - `hospital-lab-patterns@58eed17`、`hospital-lab-viewer` 已同步在
    2026-05-05 sync + push。三個 repo 一起推完才完整覆蓋 vhyl 修正。

## 2026-05-05 — Milestone 收尾：revision 1 + hotfix v1 + hotfix v2 全數驗證合併

- 作者：claude（與 YC 共同）
- 範圍：dialysis、core、docs
- 變更：修改（純文件補完 + sync timestamp 刷新；不動 logic）
- 檔案：
  - `CLAUDE.md`：補完截至 2026-05-04 為止的設計決策段落 — CSV 匯出
    格式（long format, value/unit/lower/higher 4-tuple）、demographics
    自動填入規則、action bar 三鈕配置、patient list sort/filter+per-row
    actions、BUN 前/後分類（Method A dateObj + Method B orderName
    fallback）、月檢識別新邏輯（叢集鍵=完全相同 `生效時間`、依 `簽收時間`
    排前後、同月多次取最早）。
  - `hospital-lab-data.html`：重新跑 `node sync-patterns.js`，刷新
    `__HOSPITAL_LAB_PATTERNS_*__` 與 `__HOSPITAL_LAB_GROUPS_*__` 兩個
    標記區塊的 `Synced at:` 時間戳。Patterns 與 groups 內容本身未變
    （patterns repo 在這個 milestone 沒有新發版）。
- 原因：
  - 透析 reporter 從 revision 1（2026-05-04 落地）→ hotfix v1（同日
    BUN(AD) 修復＋action bar 重排）→ hotfix v2（patient list sort/filter
    + per-row ↻/✕）已連續 merged 並由 YC 在實機驗證行為符合預期。
  - 距離上次 push 已累積三筆 commit，把 working tree 收乾淨並把這段時間
    的設計決策定影到 CLAUDE.md，方便日後追溯。
- 測試：
  - 不改 logic，所以本次無新增測試。
  - 行為驗證已記錄在前述三筆 entries（revision 1 / hotfix v1 / hotfix v2）。
  - 程式內**無殘留 `console.debug`**（grep 確認；只剩 hotfix v1 已知的
    `[BUN]` `console.warn` Method B fallback，預期保留）。
- 相依：
  - 不需要 `hospital-lab-patterns` 先發版（內容未變，僅刷新 sync 時間戳）。
  - 與 `hospital-lab-viewer` 互不影響（兩者各自從 patterns 拉 mapping，
    不互相 import）。
- 行政：
  - 把 `TASK_revision1_hotfix2_BRIEF.md` rename 成 `_done.md`，與
    `TASK_revision1_BRIEF_done.md` / `TASK_revision1_hotfix_BRIEF_done.md`
    對齊。`TASK_BRIEF_step2.md` 為未來工作 parking lot，保留原檔名。

## 2026-05-05 — Revision 1 hotfix v2：按鈕重排 ＋ 列內動作 ＋ 可排序可篩選表頭

- 作者：claude（與 YC 共同）
- 範圍：ui
- 變更：新增、修改
- 檔案：
  - 修改 `hospital-lab-data.html`（純 UI 層；不動 fetcher / parser /
    exporter / storage shape）：
    - **動作列重排**：`更新資料` 從左群組（`新增清單` 旁）移到右群組
      `匯出 CSV` 左側。語意上把「對既有清單操作」的兩個動作收攏到右邊，
      左邊只剩唯一的「丟新 ID 進清單」動作。`更新資料` 維持原本中等大小，
      只有 `匯出 CSV` 仍是放大主要動作。
    - **列內動作（per-row actions）**：每列新增 `↻`（單筆重抓）按鈕在
      既有 `✕`（移除）按鈕旁。`↻` handler `refreshOnePatient(chartno, btn)`
      共用 top-level `fetchAndStore()` pipeline；fetch 期間 button disable
      並把字符換成 `⟳`，完成後重繪整列；失敗時還原按鈕並顯示 toast。
    - **可排序 / 可篩選表頭**：`<thead>` 改為 JS 渲染（`#patientHead`），
      由新 `buildPatientColumns()` 設定每欄的 sort/filter 屬性：
        - `chartno` / `name`：text 篩選 + `localeCompare('zh-TW')` 排序
        - `sex`：enum 篩選（全部 / M / F）+ string 排序
        - `age`：text 篩選 + numeric 排序（NaN 永遠排在尾部）
        - `dialysisDays` / `shift`（由 `GROUP.patientFields` 動態產生）：
          enum 篩選（全部 / 各 option）+ `enumUnsetLast` 排序
          （`未設定` 不論方向都在最底）
        - `最後更新`：numeric 排序（無篩選）
        - `動作`：無篩選、無排序
      表頭兩列：第一列為可點擊欄名（含 `▲ / ▼ / 無` 指標），第二列為
      篩選輸入框（text input 或 enum select，第一個選項固定 `(全部)`）。
    - **狀態持久化**：新增 `STORAGE_KEYS.patientSort`（`patients_dialysis_sort`）
      與 `STORAGE_KEYS.patientFilters`（`patients_dialysis_filters`），
      用 `loadSortState` / `saveSortState` / `loadFilterState` /
      `saveFilterState` 包裝。`cyclePatientSort(col)` 點擊欄頭循環
      `unsorted → asc → desc → unsorted`；`setPatientFilter(col, val)`
      在每次輸入時持久化＋重繪 tbody，並把 focus 與 caret 位置還原回
      原本正在輸入的 input（避免重繪時 input 失去焦點 / 游標）。
    - **`renderPatientList()` 重構**：原本一個函式同時處理 head + body，
      拆成 `renderPatientHead(cols, sort, filters)`、
      `renderPatientBody(visible, cols, labData, totalCount)` 與
      orchestrator `renderPatientList()`。orchestrator 流程：
      `loadPatients → applyPatientFilters → applyPatientSort →
       renderPatientHead → renderPatientBody`。
    - 新增 CSS：`th.sortable` hover、`.sort-ind`、`tr.filter-row` 樣式，
      與 `.row-actions .btn` 緊湊化（3px 8px / font-size 12px）。
- 原因：
  - `更新資料` 與 `匯出 CSV` 在實際使用流程上是「先重抓清單再匯出」的
    連續動作，放在一起符合視線移動方向；`新增清單` 在輸入新 ID 時才用，
    與右側兩個動作觸發頻率不同。
  - 一次只想更新某一位（例如剛新增、或剛改完那位的 dialysisDays）時，
    跑全清單 batch 太重；列內 `↻` 給的是低成本的單筆重抓。
  - 5–50 筆規模的清單，排序與篩選用 vanilla JS 即可；引入 table library
    對這個 single-file HTML 是過度工程。
  - 把 sort / filter 狀態存進 localStorage 是因為使用者通常會重複開同一
    台機器，每次都重設一次篩選很煩。
- 測試：
  - `new Function(inlineScript)` parse 通過（沒有語法錯誤）。
  - Headless smoke（把 pure helper 抽出來在 Node 跑）：
    1. 排序 — `name` zh-TW asc/desc 正確；`age` numeric asc/desc 正確；
       `dialysisDays` `enumUnsetLast` 兩個方向 `未設定` 都在尾部；
       `shift` asc 顯示 `上午 | 下午 | 夜班 | 未設定`；`_lastUpdate`
       desc 把 `_lastUpdate=0` 排到尾部。
    2. 篩選 — enum `sex=M` 命中 2 筆；enum `dialysisDays=未設定` 命中 1
       筆；text `name=林`、`chartno=105` 各命中 1 筆；text + enum 複合
       `sex=F & shift=未設定` 命中 1 筆；空字串 / `(全部)` 視為無篩選。
  - **尚待 YC 在實機瀏覽器手動驗證：**
    1. 重新整理 → 動作列順序為
       `[新增清單]                 [更新資料] [匯出 CSV]`。
    2. 隨機點任一欄頭 → 出現 `▲`，再點變 `▼`，第三點消失（無排序）。
       同時只能有一欄是 active sort。
    3. 在 `姓名` 篩選輸入框打字 → 列表即時過濾，輸入框 focus 不會掉、
       游標位置正確。`性別` select 切到 `M` → 只剩男性病人。
    4. 重整頁面 → 上次的 sort + filter 狀態還在（檢查
       `localStorage.patients_dialysis_sort` /
       `localStorage.patients_dialysis_filters`）。
    5. 列內 `↻` → 只重抓那筆病人，按鈕變 `⟳` + disable，完成後該列
       `最後更新` 時間更新；其他列不動。失敗時 toast + 按鈕還原。
    6. 列內 `✕` → 仍走原本 confirm modal，確定後該列消失。
    7. 上方 `新增清單` / `更新資料` / `匯出 CSV` 既有流程仍正常。
    8. DevTools console 乾淨（除 hotfix v1 已知的 `[BUN]` 警告）。
- 相依：
  - 不需要 `hospital-lab-patterns` 先發版（patterns block 內容未變）。
  - 不影響 `groups/dialysis.js`（純 UI 層改動）。
  - 不影響 storage shape：`patients_dialysis` / `labs_dialysis` 結構與
    內容不變；新增的兩個 key（`_sort` / `_filters`）為純 UI 偏好。
- 已知/刻意保留：
  - `confirmRemovePatient` 仍走既有的 custom modal（brief 允許 `confirm()`
    或 modal — 既有 modal 已驗證可用，不換）。
  - `setPatientFilter` 不做 debounce — 5–50 筆規模重繪成本可忽略；
    必要時未來再加（debounce 反而會讓打字延遲感變強）。

## 2026-05-05 — Revision 1 hotfix：UI 微調 ＋ BUN(AD) 修復

- 作者：claude（與 YC 共同）
- 範圍：dialysis、shell、ui
- 變更：新增、修改
- 檔案：
  - 修改 `hospital-lab-data.html`（皆在 `__PATTERNS__` / `__GROUPS__`
    標記區塊外）：
    - 病人清單分頁 UI 重排：textarea 下方改為 flex 行 — 左側
      `[新增清單]` `[更新資料]`，右側放大版 `匯出 CSV`（warning 橘、
      `padding:12px 32px; font-size:1.15em; box-shadow`，視覺上明顯為主要
      動作）。原 card-header 右上角的 CSV 按鈕移除。
    - 既有按鈕 id `btnUpdate` → `btnAddToList`，文字 `更新` → `新增清單`。
      `addAndUpdateFromInput()` 完成且全部成功後清空 textarea，狀態列字串
      改為「新增清單中… N/M」「新增完成」。
    - 新增按鈕 `btnRefreshList`（`更新資料`），handler
      `refreshExistingPatients()`：忽略 textarea，逐筆對 `loadPatients()`
      內現有病人重抓 labs + demographics（共用 `fetchAndStore()` pipeline），
      狀態列顯示「更新中... N / M (chartno)」。執行期間兩個按鈕 disable。
    - 修正空清單提示文字（「請按更新」→「請按新增清單」）以及 lab view
      無資料提示（「請點選更新」→「請點選新增清單或更新資料」）。
    - **BUN(AD) 修復** — `extractLabValues()` 結尾新增
      `classifyBUNPrePost()` post-processing pass。原本兩個 BUN regex
      (`BUN_pre` / `BUN_post`) 都比對到同一段 `BUN:\s*(\d+)`，每筆 BUN
      被同時推進兩個 array → `BUN_post[]` 與 `BUN_pre[]` 完全相同，
      `BUN(AD)` 永遠空白。新 pass 步驟：
        1. 合併兩 array → 以 `(value, signOffTime/dateObj/reportDateTime,
           orderName)` 為 key 去重。
        2. 依 `e.date` (YYYY-MM-DD) 分組。
        3. **Method A（預設、跨醫院安全）**：同日 entries 依
           `signOffTime → dateObj → reportDateTime` 升冪排序，
           最早 = pre、最晚 = post。3+ 筆 console.warn 並取頭尾。
        4. **Method B（fallback）**：當 A 模糊（缺 timestamp 或 tie）時，
           依 `orderName` 字串：含 `洗後` → post、含 `洗前` → pre、
           無標記預設 pre。每次 fallback 都 console.warn。
        5. 重建 `results.BUN_pre` / `results.BUN_post`，每日各最多一筆。
       fix 為 idempotent：使用者下次按「更新資料」即會被清乾淨，無須清
       localStorage。
  - 修改 `groups/dialysis.js`（隨後 `node sync-patterns.js` 重新內嵌）：
    - 新增 `_indexBunByDate(labDataForPatient)` helper：把已清理過的
      `BUN_pre[]` / `BUN_post[]` 轉成 `{date → entry}` 的兩張查表。
    - **重寫 `detectMonthlyDrawsFromStored()`** 的 BUN 配對：原來只在
      effectiveTime cluster 內 `resolveBUN(bunEntries)` 來決定 pre/post，
      但實際資料中 `BUN洗前(YL),...` 與 `BUN洗後分開印(YL)` 是兩張不同的
      醫囑 → 不同的 `生效時間` → 落在不同 cluster，cluster-內配對永遠拿
      不到 post。新邏輯：找到月檢 cluster 後，post 改用
      `bunIdx.post[drawDateIso]` 跨 cluster 以 date 查表。pre 仍偏好
      cluster 內的 `BUN_pre[0]`（fallback 用查表）。
    - **重寫 `resolveBunClustersFromStored()`** 為 date-based：直接從
      `_indexBunByDate()` 結果產出 `{date → {pre, post, urr,
      preDate, postDate, effectiveTime}}`，與 lab-table override map 形狀
      相容。
    - `resolveBUN()` / `resolveBUNByLegacyOrderName()` 保留但已成 dead
      code（沒有 caller），用作將來備援。
- 原因：
  - 使用者測試 patient `000105069H` 後發現 `BUN(AD)` 仍空白；DevTools
    探查顯示 `localStorage.labs_dialysis['000105069H'].BUN_pre` 與
    `.BUN_post` 內容**完全相同**（每筆 BUN 同時出現在兩個 bucket）。
  - 根因：revision 1 把 catalog 層的 `composite` / `standalone_bun`
    filter 移除了（兩個 testId 共用同一個 regex），但**沒有補上後製
    分流邏輯**。同時，`BUN洗前` 與 `BUN洗後` 是兩張不同醫囑，`生效時間`
    不同，所以原本依 cluster 內 `resolveBUN()` 配對的策略也失效。
  - UI 上「新增清單」與「更新資料」拆成兩顆按鈕，是為了避免每次 batch
    update 都得手動清空 textarea；同時讓「重抓既有清單」這個高頻動作
    一鍵可達。CSV 按鈕放大置右是因為它是流程最後輸出（貼清單 → 更新
    → 匯 CSV → 上傳「下一個系統」），需要視覺上明確的主要動作。
- 測試：
  - `node sync-patterns.js` 乾淨（patterns + groups blocks 皆更新）。
  - `new Function(inlineScript)` parse 通過。
  - Headless smoke：以模擬資料（同日 BUN_pre cluster effA 03:30 +
    BUN_post cluster effB 08:00 + 完整月檢面板）跑
    `DIALYSIS_GROUP.detectMonthlyDrawsFromStored(labData)` →
    `draws=1, BUN_pre=62, BUN_post=19, URR=69.4`。
    `resolveBunClustersFromStored(labData)` → `2026-04-08: pre=62
    post=19 urr=69.4`。確認跨 cluster 配對成立。
  - Headless smoke (`classifyBUNPrePost`)：
    1. 兩 array 完全重複（stale state） → 1 pre + 1 post，值正確。
    2. 缺 signOffTime + orderName 含 `洗前/洗後` → Method B 正確分流。
    3. 單筆 entry → 預設 pre，post=null。
    4. 三個月份各一對 → 三 pre + 三 post，date 排序正確。
  - **尚待 YC 在實機瀏覽器手動驗證：**
    1. 重新整理 `hospital-lab-data.html` → 病人清單頁應看到三個按鈕
       （`新增清單` 綠、`更新資料` 藍、`匯出 CSV` 大顆橘）。
    2. 點 `更新資料` 一次（清單已有 `000105069H`）→ 狀態列顯示
       「更新中... N / M」、按鈕 disable。
    3. 完成後點 `000105069H` 進入 lab view → `BUN (BD)` 與 `BUN (AD)`
       兩列在 2026-04-08 應分別顯示 62 / 19，URR 應 ≈ 69.4。
    4. DevTools console：
       `JSON.parse(localStorage.labs_dialysis)['000105069H'].BUN_pre.length`
       應與 `BUN_post.length` 接近（≈18-20），且
       `pre.filter(r=>r.date==='2026-04-08')[0].value === 62`，
       `post.filter(r=>r.date==='2026-04-08')[0].value === 19`。
    5. 按 `匯出 CSV` → 開檔確認 `000105069H, 202604` 那 row 的
       `BUN (BD) value=62`、`BUN (AD) value=19`、`URR value≈69.4`。
- 相依：
  - 不需要 `hospital-lab-patterns` 先發版（patterns block 內容未變）。
  - 不影響其他 disease group（目前只有 dialysis）。
  - **idempotent 升級**：舊 stored data 仍是「兩 array 重複」狀態，
    使用者按一次 `更新資料` 就會被新 `classifyBUNPrePost()` 清乾淨；
    無須清 localStorage。
- 已知/刻意保留：
  - `resolveBUN()` / `resolveBUNByLegacyOrderName()` 變成 dead code，
    暫不刪以保留未來「cluster 內配對」備援可能性。
  - `computeDerivedValues()` 中的 URR 計算仍存在（lab table 與 CSV 都
    走 dialysis group resolver），維持 dead-code 狀態。

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
