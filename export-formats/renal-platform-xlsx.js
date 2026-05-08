// ─── renal-platform-xlsx.js ───────────────────────────────────────────────
// 腎臟病平台「檢驗數據」匯出 — 23 欄 .xlsx (single sheet 工作表1).
//   Row 1: English keys     (CID, Chk_Date, Creatinine, ...)
//   Row 2: Chinese labels   (病歷號, 檢查日期, ...)
//   Row 3: Units            ('', yyyy/mm/dd, mg/dl, ...)
//   Row 4+: data, one row per (patient × draw cluster)
//
// Date format: 西元年 yyyy/mm/dd (NOT 民國年 — that's KiDiTi only).
// Qualitative fields (OB / Urine Glucose) → bracket form `[-]` `[+]` `[++]`...
//   - `+/-` collapses to `[-]` (treated as negative).
//   - `1+` / `2+` / `3+` / `4+` → `[+]` / `[++]` / `[+++]` / `[++++]`.
//   - `+`, `++`, `+++`, `++++` (multi-plus) → `[+]` / `[++]` / ... by count.
//   - missing → blank string (NOT `[-]`; the platform distinguishes 未做).
//
// SheetJS (lib/xlsx.mini.min.js) is inlined by build.js; this module
// references the global `XLSX`. Filename: 腎平台檢驗數據_YYYYMMDD.xlsx.

// Normalise raw qualitative capture from catalog regex to bracket form.
// Exposed for unit testing if ever needed.
function normalizeQualitative(raw) {
  if (raw == null) return '';
  const s = String(raw).trim();
  if (!s) return '';
  if (s === '-' || s === '+/-') return '[-]';
  // "1+" / "2+" / "3+" / "4+"
  const m = s.match(/^(\d+)\+$/);
  if (m) return '[' + '+'.repeat(Number(m[1])) + ']';
  // "+", "++", "+++", "++++" multi-plus
  const plusCount = (s.match(/\+/g) || []).length;
  if (plusCount > 0) return '[' + '+'.repeat(plusCount) + ']';
  return '[-]';   // unknown captured token → conservative negative
}

// Format a numeric lab value cell. Detection-limit strings ("<2", ">100")
// pass through verbatim so Excel sees a string cell.
function _renalNumCell(value) {
  if (value == null || value === '') return '';
  const s = String(value).trim();
  if (s === '') return '';
  if (/^[<>]/.test(s)) return s;
  const n = parseFloat(s);
  return isFinite(n) ? n : s;
}

function _renalDateCell(isoDate) {
  if (!isoDate) return '';
  const m = String(isoDate).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}/${m[2]}/${m[3]}` : '';
}

// Pull one stored entry's value for a testId from a draw cluster.
function _renalVal(draw, id) {
  const e = draw && draw.labs && draw.labs[id];
  return e && e.value != null ? e.value : '';
}

/**
 * Export the active CKD group's tracked patients to a 腎臟病平台 xlsx.
 * Selection-aware: respects the Phase 1.5 patient-checkbox filter.
 */
function exportRenalPlatformXlsx() {
  if (typeof XLSX === 'undefined') {
    showToast('xlsx library 未載入', 'error');
    return;
  }
  const group = (typeof window !== 'undefined' && window.ACTIVE_GROUP) || GROUP;
  if (!group || !group.detectDrawsFromStored) {
    showToast('此疾病模組未提供 draw detection', 'error');
    return;
  }

  let patients = loadPatients();
  if (!patients.length) { showToast('尚無病患可匯出', 'error'); return; }

  const selected = getSelectedChartNos();
  if (selected) {
    const wanted = new Set(selected);
    patients = patients.filter(p => wanted.has(p.chartno || p.chartNo));
    if (!patients.length) { showToast('勾選的病患都不在清單中', 'error'); return; }
  }

  const allLabData = loadLabData();

  // 23-column schema. Row 1 keys / Row 2 labels / Row 3 units / Row 4+ data.
  // Source: TASK_BRIEF_phase3_early_ckd.md §3.2.
  const COLS = [
    { key: 'CID',                 label: '病歷號',          unit: ''          },
    { key: 'Chk_Date',            label: '檢查日期',        unit: 'yyyy/mm/dd' },
    { key: 'Creatinine',          label: 'Creatinine',      unit: 'mg/dl'     },
    { key: 'Urea_Nitrogen',       label: 'Urea Nitrogen',   unit: 'mg/dl'     },
    { key: 'Hct',                 label: 'Hct',             unit: '%'         },
    { key: 'HbA1C',               label: 'HbA1c',           unit: '%'         },
    { key: 'Uric_Acid',           label: 'Uric Acid',       unit: 'mg/dl'     },
    { key: 'Cholesterol',         label: 'Cholesterol',     unit: 'mg/dl'     },
    { key: 'Triglyceride',        label: 'Triglyceride',    unit: 'mg/dl'     },
    { key: 'Albumin',             label: 'Albumin',         unit: 'g/dl'      },
    { key: 'Urine_Proteine',      label: 'Urine Protein',   unit: 'mg/dl'     },
    { key: 'OB',                  label: 'OB',              unit: ''          },
    { key: 'Sugar_AC',            label: 'Sugar[AC]',       unit: 'mg/dl'     },
    { key: 'LDL_Cholesterol',     label: 'LDL-cholesterol', unit: 'mg/dl'     },
    { key: 'Urine_Total_Protein', label: 'Urine Total Protein', unit: 'mg/dl' },
    { key: 'Urine_creatinial',    label: 'Urine creatinial',unit: 'mg/dl'     },
    { key: 'Urine_PCR',           label: 'UPCR',            unit: 'mg/gm'     },
    { key: 'ACRatio',             label: 'UACR',            unit: 'μg/mg'     },
    { key: 'Urine_Glucose',       label: '尿糖',            unit: ''          },
    { key: 'Height',              label: 'Height',          unit: 'cm'        },
    { key: 'Weight',              label: 'Weight',          unit: 'kg'        },
    { key: 'BP1',                 label: '收縮壓',          unit: 'mmHg'      },
    { key: 'BP2',                 label: '舒張壓',          unit: 'mmHg'      },
  ];

  const headerRowKeys   = COLS.map(c => c.key);
  const headerRowLabels = COLS.map(c => c.label);
  const headerRowUnits  = COLS.map(c => c.unit);

  const dataRows = [];
  for (const p of patients) {
    const cn = p.chartno || p.chartNo || '';
    if (!cn) continue;
    const labData = allLabData[cn];
    if (!labData) continue;
    const draws = group.detectDrawsFromStored(labData);
    if (!draws.length) continue;

    // One row per draw cluster (NOT per month — the renal platform wants
    // every check date, not aggregated). Keep ascending order by drawDate.
    for (const draw of draws) {
      const row = [
        cn,                                                  // CID
        _renalDateCell(draw.drawDate),                       // Chk_Date
        _renalNumCell(_renalVal(draw, 'CREAT')),             // Creatinine
        _renalNumCell(_renalVal(draw, 'BUN')),               // Urea Nitrogen
        _renalNumCell(_renalVal(draw, 'HCT')),               // Hct
        _renalNumCell(_renalVal(draw, 'HbA1c')),             // HbA1c
        _renalNumCell(_renalVal(draw, 'UA')),                // Uric Acid
        _renalNumCell(_renalVal(draw, 'CHOL')),              // Cholesterol
        _renalNumCell(_renalVal(draw, 'TG')),                // Triglyceride
        _renalNumCell(_renalVal(draw, 'Albumin')),           // Albumin
        _renalNumCell(_renalVal(draw, 'UrineProtein')),      // Urine Protein
        normalizeQualitative(_renalVal(draw, 'UrineOB')),    // OB → [-/+/++/+++]
        _renalNumCell(_renalVal(draw, 'GluAC')),             // Sugar[AC]
        _renalNumCell(_renalVal(draw, 'LDL')),               // LDL-cholesterol
        '',                                                  // Urine Total Protein (24hr — 門診不做，留空)
        _renalNumCell(_renalVal(draw, 'UrineCr')),           // Urine creatinial
        _renalNumCell(_renalVal(draw, 'UPCR')),              // UPCR
        _renalNumCell(_renalVal(draw, 'UACR')),              // UACR
        normalizeQualitative(_renalVal(draw, 'UrineGlucose')), // 尿糖
        '', '', '', '',                                      // Height / Weight / BP1 / BP2 (non-lab)
      ];
      dataRows.push(row);
    }
  }

  if (!dataRows.length) {
    showToast('沒有可匯出的檢驗資料（請先「全部更新」）', 'error');
    return;
  }

  const aoa = [headerRowKeys, headerRowLabels, headerRowUnits, ...dataRows];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  // Column widths — make the labels comfortable to read.
  ws['!cols'] = COLS.map(c => ({ wch: Math.max(10, c.label.length + 2) }));

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '工作表1');

  const filename = `腎平台檢驗數據_${todayStr()}.xlsx`;
  // SheetJS write → ArrayBuffer → Blob → downloadBlob (re-uses core helper).
  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  downloadBlob(blob, filename);

  const scope = selected ? `${patients.length} 位勾選` : `${patients.length} 位全部`;
  showToast(`腎平台檢驗數據已匯出（${scope}，${dataRows.length} 列）`, 'success');
}
