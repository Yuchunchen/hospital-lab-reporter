// ─── kiditi-csv.js ───────────────────────────────────────────────
// KiDiTi 檢驗記錄 CSV — 58 positional fields, no header, BOM + CRLF
//
// Extracted verbatim from hospital-lab-data.html (Phase 1 restructure,
// 2026-05-08). Functions stay top-level; the build concatenates every
// core/*.js into a single <script> block, so cross-module calls Just Work
// the way they did in the monolith.

// ═══════════════════════════════════════════════════════════════════════════════
// EXPORT — KiDiTi 檢驗記錄 (58-field positional CSV)
// ═══════════════════════════════════════════════════════════════════════════════
// KiDiTi 平台規格：
//   - UTF-8 with BOM, comma-delimited, NO header row.
//   - 58 fields by position; missing values MUST be empty (not 0 — 0 會被算進
//     統計). Numeric fields use toFixed(N) per `N x.y` spec; string fields are
//     emitted as-is (quoted only if they contain a comma or quote).
//   - 日期：民國年 7 碼 RRRMMDD（114→2025）。
//   - HBsAg / Anti-HCV: Reactive→Y、Non-Reactive→N、缺值→O（未做）。
// One row per (patient × monthly check). Reuses the same monthly draw detection
// as 匯出csv (生效時間叢集 + 月初優先) so both exports stay date-aligned.

function _kdtToMinguoDate(isoDate) {
  if (!isoDate) return '';
  const m = String(isoDate).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return '';
  const y = (parseInt(m[1], 10) - 1911);
  return `${y}${m[2]}${m[3]}`;
}

function _kdtFmtNum(value, decimals) {
  if (value == null || value === '') return '';
  const n = parseFloat(value);
  if (!isFinite(n)) return '';   // covers '<2' / 'N/A' / etc. — KiDiTi wants blank
  return n.toFixed(decimals != null ? decimals : 2);
}

function _kdtMapHepYNO(value) {
  if (value == null || value === '') return 'O';
  const s = String(value).trim().toLowerCase();
  if (s === 'reactive' || s === 'positive' || s === '+' || s === 'pos') return 'Y';
  if (s === 'non-reactive' || s === 'nonreactive' || s === 'negative' || s === '-' || s === 'neg') return 'N';
  return 'O';
}

function _kdtCsvCell(v) {
  if (v == null) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

// One value per (testId, draw): the lab entry stored at the draw cluster.
function _kdtVal(draw, id) {
  const e = draw && draw.labs && draw.labs[id];
  return e && e.value != null ? e.value : '';
}

/**
 * Export every tracked patient × monthly draw as a KiDiTi 檢驗記錄 CSV.
 * Field order and decimals follow TASK_BRIEF_phase2_dialysis_kiditi §3.5.
 */
async function exportKiDiTiCSV() {
  let patients = loadPatients();
  if (!patients.length) { showToast('尚無病患可匯出', 'error'); return; }

  // Phase 1.5: respect ticked subset; null = export everyone.
  const selected = getSelectedChartNos();
  if (selected) {
    const wanted = new Set(selected);
    patients = patients.filter(p => wanted.has(p.chartno || p.chartNo));
    if (!patients.length) {
      showToast('勾選的病患都不在清單中', 'error'); return;
    }
  }

  const allLabData = await loadLabData();
  const rows = [];
  for (const p of patients) {
    const cn = p.chartno || p.chartNo || '';
    if (!cn) continue;
    const labData = allLabData[cn];
    if (!labData) continue;
    const draws   = DIALYSIS_GROUP.detectMonthlyDrawsFromStored(labData);
    const byMonth = DIALYSIS_GROUP.pickEarliestPerMonth(draws);
    const months  = Object.keys(byMonth).sort();
    if (!months.length) continue;

    const idno    = (p.idno || p.idNo || '').toString().trim();
    const chartno = String(cn).padStart(10, '0');

    for (const yyyymm of months) {
      const draw = byMonth[yyyymm];

      // Inline computed: UIBC = TIBC − Fe, CaxP = Ca × P (per draw, by date).
      const tibc = parseFloat(_kdtVal(draw, 'TIBC'));
      const fe   = parseFloat(_kdtVal(draw, 'Fe'));
      const uibc = (isFinite(tibc) && isFinite(fe)) ? (tibc - fe) : '';
      const ca   = parseFloat(_kdtVal(draw, 'Ca'));
      const ph   = parseFloat(_kdtVal(draw, 'P'));
      const caxp = (isFinite(ca) && isFinite(ph)) ? (ca * ph) : '';

      const row = [
        idno,                                                  // 01 身份證號 (S 10)
        chartno,                                               // 02 病歷號 (S 10)
        _kdtToMinguoDate(draw.drawDate),                       // 03 日期 (S 7) RRRMMDD
        _kdtFmtNum(_kdtVal(draw, 'WBC')),                      // 04 W.B.C.
        _kdtFmtNum(_kdtVal(draw, 'RBC')),                      // 05 R.B.C.
        _kdtFmtNum(_kdtVal(draw, 'Hb')),                       // 06 Hb
        _kdtFmtNum(_kdtVal(draw, 'HCT')),                      // 07 Hct
        _kdtFmtNum(_kdtVal(draw, 'MCV')),                      // 08 MCV
        _kdtFmtNum(_kdtVal(draw, 'Platelet')),                 // 09 Platelet
        _kdtFmtNum(_kdtVal(draw, 'TP')),                       // 10 Total protein
        _kdtFmtNum(_kdtVal(draw, 'Albumin')),                  // 11 Albumin
        _kdtFmtNum(_kdtVal(draw, 'GOT')),                      // 12 AST/GOT
        _kdtFmtNum(_kdtVal(draw, 'GPT')),                      // 13 ALT/GPT
        _kdtFmtNum(_kdtVal(draw, 'ALP')),                      // 14 Alkaline-P
        _kdtFmtNum(_kdtVal(draw, 'TBIL')),                     // 15 Total Bilirubin
        _kdtFmtNum(_kdtVal(draw, 'CHOL')),                     // 16 Cholesterol
        _kdtFmtNum(_kdtVal(draw, 'TG')),                       // 17 Triglyceride
        _kdtFmtNum(_kdtVal(draw, 'GluAC')),                    // 18 Glucose AC
        '', '', '', '', '',                                    // 19–23 透析前/後 BP / 體重 / 透析時間 (空)
        _kdtFmtNum(_kdtVal(draw, 'BUN_pre')),                  // 24 透析前BUN
        _kdtFmtNum(_kdtVal(draw, 'BUN_post')),                 // 25 透析後BUN
        '', '',                                                // 26–27 下次透析前BUN / 兩次透析間隔 (空)
        _kdtFmtNum(_kdtVal(draw, 'CREAT')),                    // 28 Creatinine
        _kdtFmtNum(_kdtVal(draw, 'UA')),                       // 29 Uric acid
        _kdtFmtNum(_kdtVal(draw, 'Na')),                       // 30 Na
        _kdtFmtNum(_kdtVal(draw, 'K')),                        // 31 K
        _kdtFmtNum(_kdtVal(draw, 'Cl')),                       // 32 Cl
        _kdtFmtNum(_kdtVal(draw, 'Ca')),                       // 33 全鈣 Ca
        _kdtFmtNum(_kdtVal(draw, 'FreeCa')),                   // 34 離子鈣
        _kdtFmtNum(_kdtVal(draw, 'P')),                        // 35 P
        _kdtFmtNum(_kdtVal(draw, 'Fe')),                       // 36 Fe
        _kdtFmtNum(uibc),                                      // 37 UIBC = TIBC − Fe
        _kdtFmtNum(_kdtVal(draw, 'TIBC')),                     // 38 TIBC
        _kdtFmtNum(_kdtVal(draw, 'Ferritin')),                 // 39 Ferritin
        _kdtFmtNum(_kdtVal(draw, 'Aluminum')),                 // 40 Al
        _kdtFmtNum(_kdtVal(draw, 'Mg')),                       // 41 Mg
        _kdtFmtNum(_kdtVal(draw, 'iPTH')),                     // 42 intact-PTH
        '',                                                    // 43 CTR (N 7.3, 空)
        _kdtMapHepYNO(_kdtVal(draw, 'HBsAg')),                 // 44 HBsAg → Y/N/O
        _kdtMapHepYNO(_kdtVal(draw, 'AntiHCV')),               // 45 Anti-HCV → Y/N/O
        '',                                                    // 46 EKG (S 40, 空)
        '',                                                    // 47 身高 (N 7.3, 空)
        '', '', '', '', '', '',                                // 48–53 自訂一~六 (N 7.2, 空)
        '', '',                                                // 54–55 自訂七、八 (S 30, 空)
        _kdtFmtNum(caxp),                                      // 56 鈣磷乘積 = Ca × P
        '',                                                    // 57 HCV-RNA (IU/ML) (空 — ernode 無)
        '',                                                    // 58 HCV-RNA 定性 (空 — ernode 無)
      ];
      rows.push(row.map(_kdtCsvCell).join(','));
    }
  }

  if (!rows.length) {
    showToast('沒有可匯出的月檢資料（請先「全部更新」）', 'error');
    return;
  }

  // CRLF line endings — Windows-friendly and what the KiDiTi importer expects.
  const csv = rows.join('\r\n') + '\r\n';
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  downloadBlob(blob, `KiDiTi_檢驗記錄_${todayStr()}.csv`);
  const scope = selected ? `${patients.length} 位勾選` : `${patients.length} 位全部`;
  showToast(`KiDiTi CSV 已匯出（${scope}，${rows.length} 列）`, 'success');
}
