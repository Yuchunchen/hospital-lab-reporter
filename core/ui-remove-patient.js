// ─── ui-remove-patient.js ───────────────────────────────────────────────
// Confirm-modal patient removal (also clears IDB + selection Set)
//
// Extracted verbatim from hospital-lab-data.html (Phase 1 restructure,
// 2026-05-08). Functions stay top-level; the build concatenates every
// core/*.js into a single <script> block, so cross-module calls Just Work
// the way they did in the monolith.

// ═══════════════════════════════════════════════════════════════════════════════
// UI - REMOVE PATIENT FROM TRACKED LIST
// ═══════════════════════════════════════════════════════════════════════════════

function confirmRemovePatient(chartno) {
  const p = loadPatients().find(x => x.chartno === chartno);
  if (!p) return;
  document.getElementById('confirmMsg').textContent =
    `確定要從追蹤清單移除 ${p.name || ''} (${chartno}) 嗎？此病患的檢驗資料也會一併刪除。`;
  document.getElementById('confirmOkBtn').onclick = async () => {
    const patients = loadPatients().filter(x => x.chartno !== chartno);
    savePatients(patients);
    const labData = loadLabData();
    delete labData[chartno];
    saveLabData(labData);
    try { await ordersCacheDelete(chartno); } catch (e) { console.warn('[ordersCache] delete failed:', e); }
    selectedPatients.delete(chartno);
    closeConfirm();
    renderPatientList();
    showToast('已移除', 'info');
  };
  document.getElementById('confirmModal').classList.remove('hidden');
}

function closeConfirm() {
  document.getElementById('confirmModal').classList.add('hidden');
}
