## Hospital Lab Reporter

<!-- 多 disease 院內檢驗案管系統 — Phase 1 build pipeline，Phase 3 起多 HTML 並存 -->

院內檢驗資料管理系統。供 2–5 人小團隊使用，管理某 disease 病患名單並
自動抓取 ernode API 檢驗數據。每個 disease 一個 standalone HTML：

- **`hospital-lab-dialysis.html`** — 洗腎室透析病人案管 + KiDiTi 匯出
- **`hospital-lab-ckd.html`** — 初期慢性腎臟病門診案管 + 腎臟病平台 xlsx 匯出（Phase 3, 2026-05-08）
- Phase 4+ 規劃：DM / ESRD（再加 group + export-format + 一行 build config）

Legacy `hospital-lab-data.html`（單檔 monolith）保留作 reference，仍由
`sync-patterns.js` 維護 markers，但**不再是 end-user 對象**。

架構與設計參考（目錄結構、UI、API、檢驗項目、儲存、增量抓取、Key Functions、匯出格式、按鈕、BUN 與月檢辨識）見 [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)。本檔只放建置指令、修改流程與禁止事項。

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

### Coding behavior contract（Cowork + Claude Code 寫程式時皆適用）

> 三個 repo AGENTS.md 共用同一份;改動請同步 patterns/viewer/reporter。Cowork 端思考規則見 `hospital-lab-patterns/docs/cowork-project-instructions.md` § 思考規則。

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
