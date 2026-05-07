// ─── ui-patient-list.js ───────────────────────────────────────────────
// Patient list table: columns, sort/filter, render, selection (Phase 1.5)
//
// Extracted verbatim from hospital-lab-data.html (Phase 1 restructure,
// 2026-05-08). Functions stay top-level; the build concatenates every
// core/*.js into a single <script> block, so cross-module calls Just Work
// the way they did in the monolith.

// ═══════════════════════════════════════════════════════════════════════════════
// UI - PATIENT LIST  (hotfix v2: sortable + filterable, per-row actions)
// ═══════════════════════════════════════════════════════════════════════════════

// ─── Patient selection (Phase 1.5) ───────────────────────────────────────────
// In-memory Set of chartnos the user has ticked. Intentionally NOT persisted
// to localStorage — refresh = clear is the documented expected behavior.
// Export functions consult getSelectedChartNos() to decide scope; null means
// "all visible patients" (i.e. nothing ticked → export everyone).

const selectedPatients = new Set();

function toggleSelectAll(checked) {
  // Only flip what's currently visible (after sort/filter), per brief §1.3.
  document.querySelectorAll('.patient-select').forEach(cb => {
    cb.checked = checked;
    if (checked) selectedPatients.add(cb.value);
    else         selectedPatients.delete(cb.value);
  });
  // Also repaint the row backgrounds without a full re-render.
  document.querySelectorAll('#patientBody tr').forEach(tr => {
    const cb = tr.querySelector('.patient-select');
    if (!cb) return;
    if (cb.checked) { tr.classList.add('row-selected'); tr.style.background = '#eaf4fd'; }
    else            { tr.classList.remove('row-selected'); tr.style.background = ''; }
  });
  updateSelectUI();
}

function togglePatientSelect(chartno, checked) {
  if (checked) selectedPatients.add(chartno);
  else         selectedPatients.delete(chartno);
  // Lightweight row repaint without a full re-render.
  const cb = document.querySelector(`.patient-select[value="${CSS.escape(chartno)}"]`);
  const tr = cb ? cb.closest('tr') : null;
  if (tr) {
    if (checked) { tr.classList.add('row-selected'); tr.style.background = '#eaf4fd'; }
    else         { tr.classList.remove('row-selected'); tr.style.background = ''; }
  }
  updateSelectState();
}

// Sync the header's master checkbox (checked / indeterminate / clear) and
// refresh the export-button labels. Called after every patient render and
// after every individual toggle.
function updateSelectState() {
  const all     = document.querySelectorAll('.patient-select');
  const checked = document.querySelectorAll('.patient-select:checked');
  const master  = document.getElementById('selectAll');
  if (master) {
    master.checked       = all.length > 0 && checked.length === all.length;
    master.indeterminate = checked.length > 0 && checked.length < all.length;
  }
  updateSelectUI();
}

function updateSelectUI() {
  // Append `(N)` to export button labels when the user has narrowed scope.
  // Empty selection → revert to plain label (= 全部).
  const n = selectedPatients.size;
  const setLabel = (id, base) => {
    const btn = document.getElementById(id);
    if (!btn) return;
    btn.textContent = n > 0 ? `${base} (${n})` : base;
  };
  setLabel('btnExportKiDiTi', '匯出KiDiTi資料');
  setLabel('btnExportCSV',    '匯出csv');
}

// null = export all tracked patients; array = only those.
function getSelectedChartNos() {
  return selectedPatients.size > 0 ? Array.from(selectedPatients) : null;
}


// Column config drives header rendering, sort, and filter widgets.
// Built once per render so dynamic patientFields (dialysisDays/shift) stay
// in sync with whatever the active group declares.
function buildPatientColumns() {
  const cols = [
    // Phase 1.5: leftmost selection checkbox column. Width-fixed,
    // no sort, no filter — renderPatientHead/Body special-case `_select`.
    { key: '_select',     label: '',         filter: null, sort: null },
    { key: 'chartno',     label: '病歷號',   filter: 'text', sort: 'localeZh' },
    { key: 'name',        label: '姓名',     filter: 'text', sort: 'localeZh' },
    { key: 'sex',         label: '性別',     filter: 'enum', enumOptions: ['M', 'F'], sort: 'string' },
    { key: 'age',         label: '年齡',     filter: 'text', sort: 'numeric' },
  ];
  for (const f of (GROUP.patientFields || [])) {
    cols.push({
      key: f.key, label: f.label,
      filter: 'enum',
      enumOptions: (f.options || []).slice(),
      sort: 'enumUnsetLast',
    });
  }
  cols.push({ key: '_lastUpdate', label: '最後更新', filter: null, sort: 'numeric' });
  cols.push({ key: '_actions',    label: '動作',     filter: null, sort: null });
  return cols;
}

function loadSortState() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEYS.patientSort)) || null; }
  catch { return null; }
}
function saveSortState(s) {
  if (s) localStorage.setItem(STORAGE_KEYS.patientSort, JSON.stringify(s));
  else   localStorage.removeItem(STORAGE_KEYS.patientSort);
}
function loadFilterState() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEYS.patientFilters)) || {}; }
  catch { return {}; }
}
function saveFilterState(f) {
  localStorage.setItem(STORAGE_KEYS.patientFilters, JSON.stringify(f || {}));
}

// Read the value used for sort/filter (handles synthetic _lastUpdate +
// sex fallback for legacy genderCode-only records).
function patientCellValue(p, key, labData) {
  if (key === '_lastUpdate') return labData[p.chartno]?._lastUpdate || 0;
  if (key === 'sex')         return p.sex || p.genderCode || '';
  return p[key] != null ? p[key] : '';
}

function compareForColumn(va, vb, sortType, dir) {
  const sign = dir === 'desc' ? -1 : 1;
  if (sortType === 'numeric') {
    const na = Number(va), nb = Number(vb);
    const aNan = !Number.isFinite(na), bNan = !Number.isFinite(nb);
    if (aNan && bNan) return 0;
    if (aNan) return 1;          // missing values always last
    if (bNan) return -1;
    return (na - nb) * sign;
  }
  if (sortType === 'enumUnsetLast') {
    const aUnset = !va || va === '未設定';
    const bUnset = !vb || vb === '未設定';
    if (aUnset && !bUnset) return 1;   // 未設定 always at the bottom
    if (!aUnset && bUnset) return -1;
    return String(va).localeCompare(String(vb), 'zh-TW') * sign;
  }
  if (sortType === 'localeZh') {
    return String(va || '').localeCompare(String(vb || ''), 'zh-TW') * sign;
  }
  return String(va || '').localeCompare(String(vb || '')) * sign;
}

function applyPatientFilters(list, filters, labData, cols) {
  const colByKey = new Map(cols.map(c => [c.key, c]));
  const active = Object.entries(filters).filter(([, v]) => v != null && String(v).trim() !== '' && v !== '(全部)');
  if (active.length === 0) return list;
  return list.filter(p => active.every(([key, val]) => {
    const col = colByKey.get(key);
    if (!col) return true;
    const cell = patientCellValue(p, key, labData);
    if (col.filter === 'enum') return String(cell) === String(val);
    return String(cell).toLowerCase().includes(String(val).toLowerCase());
  }));
}

function applyPatientSort(list, sort, labData) {
  if (!sort || !sort.column) return list;
  const cols = buildPatientColumns();
  const col = cols.find(c => c.key === sort.column);
  if (!col || !col.sort) return list;
  return [...list].sort((a, b) => compareForColumn(
    patientCellValue(a, sort.column, labData),
    patientCellValue(b, sort.column, labData),
    col.sort, sort.dir
  ));
}

function renderPatientHead(cols, sort, filters) {
  const head = document.getElementById('patientHead');
  if (!head) return;
  const sortInd = (key) => {
    if (!sort || sort.column !== key) return '';
    return `<span class="sort-ind">${sort.dir === 'asc' ? '▲' : '▼'}</span>`;
  };
  const headerCells = cols.map(c => {
    if (c.key === '_select') {
      return `<th style="width:36px;text-align:center"><input type="checkbox" id="selectAll" title="全選/全不選 (僅作用於目前可見列)" onchange="toggleSelectAll(this.checked)"></th>`;
    }
    const sortable = !!c.sort;
    const cls = sortable ? 'sortable' : '';
    const onClick = sortable ? ` onclick="cyclePatientSort('${c.key}')"` : '';
    return `<th class="${cls}"${onClick}>${escHtml(c.label)}${sortInd(c.key)}</th>`;
  }).join('');
  const filterCells = cols.map(c => {
    if (!c.filter) return '<th></th>';
    const cur = filters[c.key] != null ? filters[c.key] : '';
    if (c.filter === 'enum') {
      const opts = ['(全部)', ...(c.enumOptions || [])].map(o => {
        const val = o === '(全部)' ? '' : o;
        return `<option value="${escAttr(val)}"${String(cur) === String(val) ? ' selected' : ''}>${escHtml(o)}</option>`;
      }).join('');
      return `<th><select data-col="${escAttr(c.key)}" onchange="setPatientFilter('${c.key}', this.value)">${opts}</select></th>`;
    }
    return `<th><input type="text" data-col="${escAttr(c.key)}" value="${escAttr(cur)}" placeholder="篩選..." oninput="setPatientFilter('${c.key}', this.value)"></th>`;
  }).join('');
  head.innerHTML = `<tr>${headerCells}</tr><tr class="filter-row">${filterCells}</tr>`;
}

function renderPatientBody(visible, cols, labData, totalCount) {
  const tbody = document.getElementById('patientBody');
  if (!tbody) return;
  const colspan = cols.length;
  if (totalCount === 0) {
    tbody.innerHTML = `<tr><td colspan="${colspan}" class="text-center text-muted" style="padding:24px">尚未追蹤任何病患。請在上方輸入病歷號後按「新增清單」。</td></tr>`;
    return;
  }
  if (visible.length === 0) {
    tbody.innerHTML = `<tr><td colspan="${colspan}" class="text-center text-muted" style="padding:24px">沒有符合目前篩選條件的病患。</td></tr>`;
    return;
  }
  const fields = (GROUP.patientFields || []);
  const fieldKeys = new Set(fields.map(f => f.key));

  tbody.innerHTML = visible.map(p => {
    const isSelected = selectedPatients.has(p.chartno);
    const rowAttrs = isSelected ? ' class="row-selected" style="background:#eaf4fd"' : '';
    const cells = cols.map(c => {
      if (c.key === '_select') {
        return `<td style="text-align:center"><input type="checkbox" class="patient-select" value="${escAttr(p.chartno)}"${isSelected ? ' checked' : ''} onchange="togglePatientSelect('${p.chartno}', this.checked)"></td>`;
      }
      if (c.key === 'chartno') {
        return `<td><a href="#" onclick="viewPatientLab('${p.chartno}'); return false;" style="color:#2980b9;font-weight:600">${escHtml(p.chartno)}</a></td>`;
      }
      if (c.key === 'name') return `<td>${escHtml(p.name || '')}</td>`;
      if (c.key === 'sex')  return `<td>${escHtml(p.sex || p.genderCode || '')}</td>`;
      if (c.key === 'age')  return `<td>${escHtml(p.age != null ? String(p.age) : '')}</td>`;
      if (fieldKeys.has(c.key)) {
        const f = fields.find(x => x.key === c.key);
        const cur = p[c.key] != null && p[c.key] !== '' ? p[c.key] : (f.default || '');
        const opts = (f.options || []).map(o =>
          `<option value="${escAttr(o)}"${o === cur ? ' selected' : ''}>${escHtml(o)}</option>`
        ).join('');
        return `<td><select onchange="updatePatientField('${p.chartno}','${f.key}',this.value)" style="padding:4px 6px;font-size:12px">${opts}</select></td>`;
      }
      if (c.key === '_lastUpdate') {
        const ts = labData[p.chartno]?._lastUpdate;
        const text = ts ? new Date(ts).toLocaleString('zh-TW') : '<span class="text-muted">未更新</span>';
        return `<td style="font-size:11px">${text}</td>`;
      }
      if (c.key === '_actions') {
        return `<td class="actions"><span class="row-actions">
          <button class="btn btn-primary" title="重新抓取此病患資料" data-row-refresh="${escAttr(p.chartno)}" onclick="refreshOnePatient('${p.chartno}', this)">↻</button>
          <button class="btn btn-danger" title="移除此病患" onclick="confirmRemovePatient('${p.chartno}')">✕</button>
        </span></td>`;
      }
      return '<td></td>';
    }).join('');
    return `<tr${rowAttrs}>${cells}</tr>`;
  }).join('');
}

function renderPatientList() {
  const cols     = buildPatientColumns();
  const patients = loadPatients();
  const labData  = loadLabData();
  const sort     = loadSortState();
  const filters  = loadFilterState();
  const filtered = applyPatientFilters(patients, filters, labData, cols);
  const sorted   = applyPatientSort(filtered, sort, labData);
  renderPatientHead(cols, sort, filters);
  renderPatientBody(sorted, cols, labData, patients.length);
  // Master checkbox + export-button labels reflect the surviving Set state.
  updateSelectState();
}

// Header click handler — cycles unsorted → asc → desc → unsorted.
function cyclePatientSort(column) {
  const cur = loadSortState();
  let next;
  if (!cur || cur.column !== column)      next = { column, dir: 'asc' };
  else if (cur.dir === 'asc')             next = { column, dir: 'desc' };
  else                                    next = null;
  saveSortState(next);
  renderPatientList();
}

// Filter input handler — text inputs call this on every keystroke. With
// ≤ ~50 patients the re-render cost is negligible, so no debounce needed.
// Re-rendering the whole table would steal focus from the input being
// typed into; we restore focus + caret position after the rebuild.
function setPatientFilter(column, value) {
  const filters = loadFilterState();
  if (value == null || String(value).trim() === '') delete filters[column];
  else                                              filters[column] = value;
  saveFilterState(filters);

  const active  = document.activeElement;
  const wasInput = active && active.tagName === 'INPUT' && active.dataset.col === column;
  const caret   = wasInput ? active.selectionStart : null;

  renderPatientList();

  if (wasInput) {
    const next = document.querySelector(`#patientHead input[data-col="${CSS.escape(column)}"]`);
    if (next) {
      next.focus();
      if (caret != null) try { next.setSelectionRange(caret, caret); } catch (_) {}
    }
  }
}

/**
 * Per-row refresh handler (hotfix v2). Re-fetches labs + demographics for
 * a single chartNo using the same pipeline as the top-level 更新資料.
 * The clicked button is disabled with a spinner glyph during the fetch.
 */
async function refreshOnePatient(chartno, btn) {
  const settings = loadSettings();
  if (!settings.opsid) {
    showToast('請先到「設定」填寫操作人員代號 (OPSID)', 'error');
    switchTab('settings');
    return;
  }
  const originalText = btn ? btn.innerHTML : null;
  if (btn) { btn.disabled = true; btn.innerHTML = '⟳'; }
  setStatus(`更新 ${chartno} 中...`, true);
  try {
    await fetchAndStore(chartno);
    renderPatientList();
    setStatus(`已更新: ${chartno}`);
    showToast(`已更新 ${chartno}`, 'success');
  } catch (err) {
    console.warn(`Failed to refresh ${chartno}:`, err);
    if (btn) { btn.disabled = false; btn.innerHTML = originalText; }
    setStatus(`更新失敗: ${chartno}`);
    showToast(`更新 ${chartno} 失敗`, 'error');
  }
}

function escHtml(s) {
  const d = document.createElement('div');
  d.textContent = s == null ? '' : s;
  return d.innerHTML;
}
function escAttr(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** Persist a user-editable field on a patient (dialysisDays / shift selects). */
function updatePatientField(chartno, key, value) {
  const patients = loadPatients();
  const idx = patients.findIndex(p => p.chartno === chartno);
  if (idx < 0) return;
  patients[idx][key] = value;
  savePatients(patients);
}
