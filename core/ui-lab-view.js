// ─── ui-lab-view.js ───────────────────────────────────────────────
// Per-patient lab history table renderer
//
// Extracted verbatim from hospital-lab-data.html (Phase 1 restructure,
// 2026-05-08). Functions stay top-level; the build concatenates every
// core/*.js into a single <script> block, so cross-module calls Just Work
// the way they did in the monolith.

// ═══════════════════════════════════════════════════════════════════════════════
// LAB DATA TABLE RENDERING
// ═══════════════════════════════════════════════════════════════════════════════

// Staging-string → colour class (KDIGO-aligned, 4 levels). Used by entries
// declared with `kind:'staging'` in REPORTER_COMPUTED (GFRStage / UACRStage /
// UPCRStage / KDIGORisk / TaiwanCKD / EarlyCKD). eGFR is numeric and uses the
// regular hi/lo path. Empty class = no colour applied.
const STAGING_CLASS = {
  // GFRStage
  '正常':       'val-stage-normal',
  'CKD2':       'val-stage-mild',
  'CKD3a':      'val-stage-mild',
  'CKD3b':      'val-stage-moderate',
  'CKD4':       'val-stage-severe',
  'CKD5':       'val-stage-severe',
  // UACRStage
  'A2':         'val-stage-mild',
  'A3':         'val-stage-moderate',
  // UPCRStage
  '輕度':       'val-stage-mild',
  '顯著':       'val-stage-moderate',
  '腎病範圍':   'val-stage-severe',
  // KDIGORisk
  '低風險':     'val-stage-normal',
  '中風險':     'val-stage-mild',
  '高風險':     'val-stage-moderate',
  '極高風險':   'val-stage-severe',
  // TaiwanCKD
  '第一期':     'val-stage-normal',
  '第二期':     'val-stage-mild',
  '第三期 3a':  'val-stage-mild',
  '第三期 3b':  'val-stage-moderate',
  '第四期':     'val-stage-severe',
  '第五期':     'val-stage-severe',
  // EarlyCKD
  'P1早期':     'val-stage-mild',
  'P2中晚期':   'val-stage-moderate',
};

function stagingClass(v) {
  return STAGING_CLASS[String(v)] || '';
}

/**
 * View lab data for a specific patient.
 * Switches to the labview tab and renders the full history table.
 */
async function viewPatientLab(chartno) {
  const patients = loadPatients();
  const patient = patients.find(p => p.chartno === chartno);
  const labData = (await loadLabData())[chartno];

  // Update header — sex/age come from auto-filled demographics; revision 1
  // dropped the schedule/frequency text in favor of the patient-row selects.
  document.getElementById('labPatientName').textContent = patient
    ? `${patient.name || ''} (${chartno})`
    : chartno;
  const sex = patient ? (patient.sex || patient.genderCode || '') : '';
  const age = patient && patient.age != null ? patient.age + '歲' : '';
  const dd  = patient ? (patient.dialysisDays || '') : '';
  const sh  = patient ? (patient.shift || '') : '';
  document.getElementById('labPatientMeta').textContent =
    [sex, age, dd, sh].filter(Boolean).join(' ｜ ');

  const wrapper = document.getElementById('labTableWrapper');

  if (!labData) {
    wrapper.innerHTML = '<p class="text-center text-muted" style="padding:24px">尚無檢驗資料，請先點選「新增清單」或「全部更新」按鈕擷取資料</p>';
    switchTab('labview');
    return;
  }

  // Restrict the table to the active group's manifest so dialysis-specific
  // form items render in form order; pick up any displayLabel overrides.
  const manifestEntries = (GROUP.labManifest || []).map(resolveManifestEntry);
  const manifestIds     = new Set(manifestEntries.map(e => e.id));
  const labelOverride   = new Map(
    manifestEntries.filter(e => e.displayLabel).map(e => [e.id, e.displayLabel])
  );
  const computedIds = new Set(GROUP.computed || []);
  const allTests = [
    ...LAB_TESTS.filter(t => manifestIds.has(t.id)),
    ...COMPUTED_TESTS.filter(t => computedIds.has(t.id)),
  ];

  // Step 2: BUN_pre / BUN_post / URR are now resolved per cluster via the
  // dialysis group's resolveBunClustersFromStored() — same source of truth
  // as the CSV exporter. The stored BUN_pre / BUN_post arrays now contain
  // every BUN occurrence twice (one per testId), so per-date dateMap reads
  // are no longer meaningful for those rows; we override them below.
  const bunSlots = (typeof GROUP.resolveBunClustersFromStored === 'function')
    ? GROUP.resolveBunClustersFromStored(labData) : {};
  const bunPreByDate  = {};
  const bunPostByDate = {};
  const urrByDate     = {};
  for (const startDate in bunSlots) {
    const slot = bunSlots[startDate];
    if (slot.pre  && slot.preDate)  bunPreByDate[slot.preDate]   = slot.pre.value;
    if (slot.post && slot.postDate) bunPostByDate[slot.postDate] = slot.post.value;
    if (slot.urr != null)           urrByDate[startDate]         = slot.urr;
  }
  const overrideMap = {
    BUN_pre:  bunPreByDate,
    BUN_post: bunPostByDate,
    URR:      urrByDate,
  };

  const dateSet = new Set();
  for (const test of allTests) {
    const entries = labData[test.id];
    if (!entries) continue;
    for (const e of entries) {
      dateSet.add(e.date);
    }
  }
  // Make sure every cluster start / pre date / post date appears as a column,
  // even if no other test was drawn on that exact date.
  for (const startDate in bunSlots) {
    dateSet.add(startDate);
    const slot = bunSlots[startDate];
    if (slot.preDate)  dateSet.add(slot.preDate);
    if (slot.postDate) dateSet.add(slot.postDate);
  }

  const dates = Array.from(dateSet).sort((a, b) => b.localeCompare(a)); // newest first

  if (dates.length === 0) {
    wrapper.innerHTML = '<p class="text-center text-muted" style="padding:24px">未找到任何檢驗數據</p>';
    switchTab('labview');
    return;
  }

  // Convert dates to Taiwan calendar for header display
  const dateHeaders = dates.map(d => {
    const parts = d.split('-');
    const twYear = +parts[0] - 1911;
    return `${twYear}/${parts[1]}/${parts[2]}`;
  });

  // Build table HTML
  let html = '<table class="lab-table">';

  // Header row with dates
  html += '<thead><tr>';
  html += '<th style="min-width:120px;position:sticky;left:0;z-index:3;background:#1a5276">檢驗項目</th>';
  html += '<th style="min-width:90px;position:sticky;left:120px;z-index:3;background:#1a5276">參考值</th>';
  dates.forEach((d, i) => {
    const cls = i === 0 ? ' class="latest-col"' : '';
    html += `<th${cls}>${dateHeaders[i]}</th>`;
  });
  html += '</tr></thead>';

  html += '<tbody>';

  const hasAny = id => {
    if (overrideMap[id] && Object.keys(overrideMap[id]).length > 0) return true;
    return labData[id] && labData[id].length > 0;
  };

  // Group tests by category — restricted to allTests (already manifest-filtered)
  for (const cat of LAB_CATEGORIES) {
    const testsInCat = allTests.filter(t => t.cat === cat.id);
    if (testsInCat.length === 0) continue;
    // Check if category has any data (includes Step 2 BUN/URR overrides)
    const hasData = testsInCat.some(t => hasAny(t.id));
    if (!hasData) continue;

    // Category header row
    html += `<tr class="row-category"><td colspan="${dates.length + 2}">${cat.label}</td></tr>`;

    for (const test of testsInCat) {
      if (!hasAny(test.id)) continue;
      const entries = labData[test.id] || [];

      // Build a date -> value map. For BUN_pre / BUN_post / URR (Step 2),
      // the override map IS the source of truth (resolveBUN per cluster);
      // ignore raw stored entries which now contain duplicates.
      const dateMap = overrideMap[test.id]
        ? Object.assign({}, overrideMap[test.id])
        : (() => {
            const m = {};
            for (const e of entries) {
              if (!(e.date in m)) m[e.date] = e.value; // first wins (newest if pre-sorted)
            }
            return m;
          })();

      const lbl = labelOverride.get(test.id) || test.label;
      html += '<tr class="row-item">';
      html += `<td>${lbl}</td>`;
      html += `<td>${test.ref || ''} ${test.unit ? '(' + test.unit + ')' : ''}</td>`;

      dates.forEach((d, i) => {
        const val = dateMap[d];
        const cls = i === 0 ? ' latest-col' : '';

        if (val == null) {
          html += `<td class="${cls}"></td>`;
          return;
        }

        // Determine color class
        let valCls = '';
        if (test.kind === 'staging') {
          // CKD staging strings (GFRStage / UACRStage / UPCRStage / KDIGORisk /
          // TaiwanCKD / EarlyCKD). No numeric hi/lo — colour via STAGING_CLASS.
          valCls = stagingClass(val);
        } else if (test.qualitative) {
          // Qualitative: Reactive/positive = red, Non-Reactive/negative = green
          const lower = String(val).toLowerCase();
          if (lower.includes('reactive') && !lower.includes('non')) {
            valCls = 'val-q-pos';
          } else if (lower.includes('non-reactive') || lower.includes('negative') || lower.includes('nonreactive')) {
            valCls = 'val-q-neg';
          }
        } else {
          const numVal = typeof val === 'number' ? val : parseFloat(val);
          if (!isNaN(numVal)) {
            // Gender-aware threshold: pick loM/hiM or loF/hiF when the
            // catalog entry provides them and patient sex is known
            // ('M'/'F' from genderCode). Falls back to lo/hi (wide envelope)
            // for unknown sex or non-gendered tests.
            const sex = patient && (patient.sex || patient.genderCode);
            let hi = test.hi, lo = test.lo;
            if (sex === 'M' && (test.hiM != null || test.loM != null)) {
              if (test.hiM != null) hi = test.hiM;
              if (test.loM != null) lo = test.loM;
            } else if (sex === 'F' && (test.hiF != null || test.loF != null)) {
              if (test.hiF != null) hi = test.hiF;
              if (test.loF != null) lo = test.loF;
            }
            if (hi != null && numVal > hi) valCls = 'val-hi';
            else if (lo != null && numVal < lo) valCls = 'val-lo';
          }
        }

        html += `<td class="${valCls}${cls}">${val}</td>`;
      });

      html += '</tr>';
    }
  }

  html += '</tbody></table>';
  wrapper.innerHTML = html;
  switchTab('labview');
}
