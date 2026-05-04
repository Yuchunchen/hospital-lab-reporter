'use strict';

/**
 * groups/dialysis.js — 透析（血液透析）疾病群組模組
 *
 * 透析個案管理：每月血液檢查資料的擷取、整理與輸出
 *
 * 與其他疾病不同處：
 *   - 期間：每月一次
 *   - 關鍵欄位：BUN（前/後）、URR、Ca×P
 *   - 月檢識別：同日（或差 1–2 天）大量項目同時開單，且必有 BUN
 *
 * 此檔案由 sync-patterns.js 自動內嵌進 hospital-lab-data.html 的
 * __HOSPITAL_LAB_GROUPS_BEGIN__ / __HOSPITAL_LAB_GROUPS_END__ 區塊。
 *
 * 在瀏覽器中暴露為 window.GROUPS.dialysis（registry 模式，方便未來
 * CKD / DM / COPD 模組共用同一個 namespace）。
 */

const DIALYSIS_GROUP = {
  id: 'dialysis',
  label: '透析',

  storageKey: {
    patients: 'patients_dialysis',
    labs:     'labs_dialysis',
  },

  // 病人欄位（除了 shell 提供的 chartNo / name / age / sex 之外的）
  //
  // 註：Step 1 尚未把 modal 改成從這裡渲染。目前 modal 仍是
  // 硬編碼 schedule / shift（沿用既有行為）。Step 2+ 會把 modal
  // 改成從 patientFields 動態渲染，到時這份清單會生效。
  patientFields: [
    { key: 'startDate', label: '開始透析日', type: 'date' },
    { key: 'frequency', label: '頻率',
      type: 'select', options: ['週三次', '週二次', '其他'] },
    { key: 'access',    label: '通路',
      type: 'select', options: ['AVF', 'AVG', '長期導管', '短期導管'] },
    { key: 'primaryDx', label: '原發病因', type: 'text' },
    { key: 'note',      label: '備註',     type: 'textarea' },
  ],

  // Lab manifest — IDs 採用 hospital-lab-patterns/catalog.js 的標準命名
  //
  // 註：原 TASK_BRIEF 列出的 ALT / TBili / TCho / HDL / Mg 不全對應
  // catalog 的標準 id。已調整為：
  //   ALT  → GPT
  //   TBili→ TBIL
  //   TCho → CHOL
  //   HDL  → HDLC
  //   Mg   → 暫時略（catalog 有 Mg 但 reporter manifest 未收錄）
  //   HDLC 同上（目前 reporter manifest 未收錄）
  // 未來若 patterns repo 把 Mg / HDLC 加入 reporter manifest，
  // 再把它們加回此清單即可。
  labManifest: [
    'BUN_pre', 'BUN_post',
    'CREAT', 'UA',
    'GluAC', 'HbA1c',
    'TP', 'Albumin',
    'Na', 'K', 'Ca', 'P', 'iPTH',
    'Hb', 'HCT', 'MCV', 'Platelet', 'WBC',
    'TIBC', 'TSAT', 'Ferritin',
    'GPT', 'ALP', 'TBIL',
    'CHOL', 'TG', 'LDL',
  ],

  // 衍生值 — 由 patterns repo 的 REPORTER_COMPUTED 提供
  computed: ['URR', 'CaxP'],

  // 月檢識別參數
  monthlyDetection: {
    clusterDayWindow: 2,       // 同次抽血容忍天數
    minTestsForMonthly: 8,     // 至少 8 項落在 labManifest 才算月檢
    requireBUN: true,          // 必有 BUN 才算月檢
  },

  // BUN 前/後判定（基於 reportDateTime）
  //   ≥2 筆 → 依時間排序，最早 = 洗腎前，最晚 = 洗腎後
  //   1 筆  → 預設為洗腎前
  //   0 筆  → 兩者皆 null
  //
  // TODO: activate in Step 2
  // 目前 hospital-lab-data.html 的 extractLabValues() 仍然用
  // composite/standalone_bun filter 字串路徑（即便該路徑因 manifest
  // 改用 orderNameFilter 已實質失效，仍維持 byte-identical）。
  // Step 2 會把 BUN 前/後判定切換到此 reportDateTime-based 路徑，
  // 並有獨立驗證。
  resolveBUN(bunEntries) {
    if (!bunEntries || bunEntries.length === 0) return { pre: null, post: null };
    if (bunEntries.length === 1) return { pre: bunEntries[0], post: null };
    const sorted = [...bunEntries].sort((a, b) => {
      const ta = new Date(a.reportDateTime || a.reportDate).getTime();
      const tb = new Date(b.reportDateTime || b.reportDate).getTime();
      return ta - tb;
    });
    return { pre: sorted[0], post: sorted[sorted.length - 1] };
  },

  // 月檢偵測主函式
  // 輸入：該病人所有 lab rows（已經過 pattern 解析的扁平陣列）
  //       row 格式：{ testId, orderDate, reportDateTime, value, unit, ... }
  // 輸出：[{ drawDate: 'YYYY-MM-DD', labs: { TESTID: row } }, ...]
  //
  // TODO: activate in Step 2
  // 目前 viewPatientLab() 仍然渲染所有 LAB_TESTS（不依 labManifest 過濾），
  // 也未使用月檢叢集邏輯。Step 2+ 會把它接上 UI 並驗證。
  detectMonthlyDraws(allLabs) {
    if (!allLabs || allLabs.length === 0) return [];

    // 1. 依 orderDate 排序
    const rows = [...allLabs].sort((a, b) => {
      const da = new Date(a.orderDate || a.reportDate);
      const db = new Date(b.orderDate || b.reportDate);
      return da - db;
    });

    // 2. 切叢集（gap > clusterDayWindow 開新叢集）
    const W = this.monthlyDetection.clusterDayWindow;
    const clusters = [];
    let cur = null;
    for (const row of rows) {
      const d = new Date(row.orderDate || row.reportDate);
      if (!cur || daysBetween(cur.endDate, d) > W) {
        cur = { startDate: d, endDate: d, rows: [] };
        clusters.push(cur);
      } else {
        cur.endDate = d;
      }
      cur.rows.push(row);
    }

    // 3. 對每個叢集判斷是否為月檢
    const manifestSet = new Set(this.labManifest);
    const out = [];
    for (const c of clusters) {
      const ids = new Set(c.rows.map(r => r.testId));
      const hits = [...ids].filter(id => manifestSet.has(id));
      const hasBUN = c.rows.some(r =>
        r.testId === 'BUN_pre' ||
        r.testId === 'BUN_post' ||
        r.testId === 'BUN'
      );
      if (hits.length < this.monthlyDetection.minTestsForMonthly) continue;
      if (this.monthlyDetection.requireBUN && !hasBUN) continue;

      // 4. 解析 BUN 前/後
      const bunEntries = c.rows.filter(r =>
        r.testId === 'BUN_pre' ||
        r.testId === 'BUN_post' ||
        r.testId === 'BUN'
      );
      const { pre, post } = this.resolveBUN(bunEntries);

      // 5. 組成單筆月檢紀錄
      const labs = {};
      for (const r of c.rows) {
        if (manifestSet.has(r.testId)) labs[r.testId] = r;
      }
      if (pre)  labs['BUN_pre']  = pre;
      if (post) labs['BUN_post'] = post;

      out.push({
        drawDate: isoDate(c.startDate),
        labs,
      });
    }
    return out;
  },

  // CSV 輸出
  //
  // 註：Step 1 尚未把任何 UI 按鈕接到此 exporter。目前
  // exportAllLabData() 仍然輸出 JSON（{ patients, labData }）。
  // 此 exporter 函式存在以供 Step 2+ 接 UI 與測試使用。
  exporter: {
    interval: 'monthly',
    filename: (patient, draw) =>
      `dialysis_${patient.chartNo || patient.chartno}_${draw.drawDate}.csv`,
    format(patient, draws) {
      const cols = [
        'chartNo', 'name', 'drawDate',
        ...DIALYSIS_GROUP.labManifest,
        'URR', 'CaxP',
      ];
      const lines = [cols.join(',')];
      for (const draw of draws) {
        const row = [
          patient.chartNo || patient.chartno,
          patient.name,
          draw.drawDate,
          ...DIALYSIS_GROUP.labManifest.map(id => draw.labs[id]?.value ?? ''),
          draw.computed?.URR  ?? '',
          draw.computed?.CaxP ?? '',
        ];
        lines.push(row.join(','));
      }
      return lines.join('\n');
    },
  },
};

// ─── helpers ─────────────────────────────────────────────────────────────────

function daysBetween(d1, d2) {
  return Math.abs((new Date(d2) - new Date(d1)) / 86400000);
}

function isoDate(d) {
  return new Date(d).toISOString().slice(0, 10);
}

// ─── exports ─────────────────────────────────────────────────────────────────
// Browser registry (preferred): window.GROUPS.dialysis
// Node CommonJS fallback for headless tests.

if (typeof window !== 'undefined') {
  window.GROUPS = window.GROUPS || {};
  window.GROUPS.dialysis = DIALYSIS_GROUP;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = DIALYSIS_GROUP;
}
