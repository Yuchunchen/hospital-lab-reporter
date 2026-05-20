// ─── ui-patient-crud.js ───────────────────────────────────────────────
// Patient CRUD pipeline: add / refresh-all / refresh-one + setStatus + parser
//
// Extracted verbatim from hospital-lab-data.html (Phase 1 restructure,
// 2026-05-08). Functions stay top-level; the build concatenates every
// core/*.js into a single <script> block, so cross-module calls Just Work
// the way they did in the monolith.

// ═══════════════════════════════════════════════════════════════════════════════
// DATA FETCHING — ID-LIST INPUT + BATCH UPDATE
// ═══════════════════════════════════════════════════════════════════════════════

function setStatus(msg, loading = false) {
  const bar = document.getElementById('statusBar');
  bar.innerHTML = (loading ? '<span class="spinner"></span>' : '') + escHtml(msg);
}

/**
 * Split a textarea blob into normalized chartNos.
 * Accepts newlines, commas, semicolons, pipes, or whitespace as separators.
 * Returns { chartnos: [...unique, normalized], errors: [...rejected raw tokens with reason] }.
 */
function parseChartNoList(text) {
  const result = { chartnos: [], errors: [] };
  if (!text) return result;
  const tokens = text.split(/[,;|\s]+/).map(s => s.trim()).filter(Boolean);
  const seen = new Set();
  for (const t of tokens) {
    try {
      const cn = formatChartNo(t);
      if (seen.has(cn)) continue;
      seen.add(cn);
      result.chartnos.push(cn);
    } catch (err) {
      result.errors.push(`${t}: ${err.message}`);
    }
  }
  return result;
}

/**
 * Fetch one chartNo end-to-end: hit the API, extract labs, persist to
 * storage, refresh demographics. Throws on network / parse error.
 *
 * Incremental path: if the raw-orders IndexedDB cache already has orders
 * for this chartno, we run fetchIncremental — typically 1 API call per
 * patient instead of 5–15. First fetch (or empty cache) falls back to
 * fetchAllOrders.
 */
async function fetchAndStore(chartno) {
  const cached = await ordersCacheGet(chartno);

  let orders, patientInfo;
  if (cached && Array.isArray(cached.orders) && cached.orders.length > 0) {
    // Clone cached orders so the in-place status overwrites in
    // fetchIncremental don't mutate the IndexedDB-derived array before
    // the final put writes the merged result.
    const baseline = cached.orders.map(o => ({ ...o }));
    const result = await fetchIncremental(chartno, baseline, (n, t) => {
      setStatus(`${chartno}: 增量更新 ${n} / ${t} 筆`, true);
    });
    orders = result.orders;
    patientInfo = result.patientInfo;
    console.log(`[incremental] ${chartno}: ${result.pagesChecked} page(s) checked, total ${orders.length}`);
  } else {
    const result = await fetchAllOrders(chartno, (n, t) => {
      setStatus(`${chartno}: 已擷取 ${n} / ${t} 筆`, true);
    });
    orders = result.orders;
    patientInfo = result.patientInfo;
  }

  // Sub-page enrichment: any manifest testId still missing → selectively
  // fetch the "請 Click「正式報告」" sub-pages within cutoff (cache-first).
  // LAB_TESTS = resolved REPORTER_MANIFEST, so adding a new sub-page-only
  // test now only requires a catalog/manifest change. enrichMissingValues
  // skips orders whose pattern already matches reportText, so previously
  // enriched cached orders aren't re-enriched.
  try {
    await enrichMissingValues(orders, chartno, LAB_TESTS, {
      onProgress: msg => setStatus(`${chartno}: ${msg}`, true),
    });
  } catch (e) {
    console.warn('[enrichMissingValues] failed:', e);
  }

  // Persist raw orders cache (post-enrichment so cached reportText already
  // includes any sub-page splices).
  try {
    await ordersCachePut(chartno, orders);
  } catch (e) {
    console.warn('[ordersCache] put failed:', e);
  }

  let labValues = extractLabValues(orders);
  labValues = computeDerivedValues(labValues);
  // 2026-05-13: 直接 per-chartno 寫 IDB，不再 load 全部 patients 再整批寫。
  try {
    await labDataPut(chartno, { ...labValues, _lastUpdate: Date.now() });
  } catch (e) {
    console.warn(`[labData] put failed for ${chartno}:`, e);
  }

  // Demographics refresh on every fetch (revision 1: not user-editable).
  if (patientInfo) {
    const patients = loadPatients();
    const idx = patients.findIndex(p => p.chartno === chartno);
    if (idx >= 0) {
      if (patientInfo.name)       patients[idx].name = patientInfo.name;
      if (patientInfo.genderCode) patients[idx].sex  = patientInfo.genderCode;
      if (patientInfo.age)        patients[idx].age  = patientInfo.age;
      savePatients(patients);
    }
  }
}

/**
 * Handler for the 新增清單 button: parses the textarea, adds any new chartNos
 * to the tracked list (with default field values), then batch-fetches each.
 * On completion the textarea is cleared (per revision 1 hotfix).
 */
async function addAndUpdateFromInput() {
  const ta  = document.getElementById('chartnoInput');
  const raw = ta ? ta.value : '';
  const { chartnos, errors } = parseChartNoList(raw);

  if (errors.length) {
    const head = errors.slice(0, 3).join('； ');
    showToast(`${errors.length} 筆無效病歷號已忽略：${head}${errors.length > 3 ? '…' : ''}`, 'error', 5000);
  }
  if (chartnos.length === 0) {
    if (!errors.length) showToast('請輸入至少一筆病歷號', 'error');
    return;
  }

  const settings = loadSettings();
  if (!settings.opsid) {
    showToast('請先到「設定」填寫操作人員代號 (OPSID)', 'error');
    switchTab('settings');
    return;
  }

  // Add any new chartNos to the tracked list with default field values.
  const patients = loadPatients();
  const fields = (GROUP.patientFields || []);
  let added = 0;
  for (const cn of chartnos) {
    if (!patients.find(p => p.chartno === cn)) {
      const fresh = { chartno: cn };
      for (const f of fields) fresh[f.key] = f.default || '';
      patients.push(fresh);
      added++;
    }
  }
  if (added > 0) {
    savePatients(patients);
    await renderPatientList();
  }

  const btnAdd = document.getElementById('btnAddToList');
  const btnRef = document.getElementById('btnRefreshList');
  if (btnAdd) btnAdd.disabled = true;
  if (btnRef) btnRef.disabled = true;
  let success = 0, fail = 0;
  for (let i = 0; i < chartnos.length; i++) {
    const cn = chartnos[i];
    setStatus(`新增清單中 (${i + 1}/${chartnos.length}): ${cn}...`, true);
    try {
      await fetchAndStore(cn);
      success++;
    } catch (err) {
      fail++;
      console.warn(`Failed to fetch ${cn}:`, err);
    }
  }
  await renderPatientList();
  if (btnAdd) btnAdd.disabled = false;
  if (btnRef) btnRef.disabled = false;
  if (ta && success > 0 && fail === 0) ta.value = '';
  setStatus(`新增完成: ${success} 成功${fail ? `, ${fail} 失敗` : ''}`);
  showToast(`新增完成: ${success} 成功${fail ? `, ${fail} 失敗` : ''}`, fail ? 'error' : 'success');
}

/**
 * Handler for the 更新資料 button: re-fetch labs + demographics for every
 * chartNo currently in the patient list (ignores the textarea contents).
 */
async function refreshExistingPatients() {
  const patients = loadPatients();
  if (patients.length === 0) {
    showToast('清單為空，請先用「新增清單」加入病人', 'error');
    return;
  }
  const settings = loadSettings();
  if (!settings.opsid) {
    showToast('請先到「設定」填寫操作人員代號 (OPSID)', 'error');
    switchTab('settings');
    return;
  }

  const btnAdd = document.getElementById('btnAddToList');
  const btnRef = document.getElementById('btnRefreshList');
  if (btnAdd) btnAdd.disabled = true;
  if (btnRef) btnRef.disabled = true;

  const total = patients.length;
  let success = 0, fail = 0;
  for (let i = 0; i < total; i++) {
    const cn = patients[i].chartno;
    setStatus(`更新中... ${i + 1} / ${total} (${cn})`, true);
    try {
      await fetchAndStore(cn);
      success++;
    } catch (err) {
      fail++;
      console.warn(`Failed to refresh ${cn}:`, err);
    }
  }
  await renderPatientList();
  if (btnAdd) btnAdd.disabled = false;
  if (btnRef) btnRef.disabled = false;
  setStatus(`更新完成: ${success} 成功${fail ? `, ${fail} 失敗` : ''}`);
  showToast(`更新完成: ${success} 成功${fail ? `, ${fail} 失敗` : ''}`, fail ? 'error' : 'success');
}
