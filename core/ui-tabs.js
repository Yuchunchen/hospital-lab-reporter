// ─── ui-tabs.js ───────────────────────────────────────────────
// switchTab + showToast (toast container declared in body markup)
//
// Extracted verbatim from hospital-lab-data.html (Phase 1 restructure,
// 2026-05-08). Functions stay top-level; the build concatenates every
// core/*.js into a single <script> block, so cross-module calls Just Work
// the way they did in the monolith.

// ═══════════════════════════════════════════════════════════════════════════════
// UI - TABS
// ═══════════════════════════════════════════════════════════════════════════════

function switchTab(name) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('active', p.id === `tab-${name}`));
}


// ═══════════════════════════════════════════════════════════════════════════════
// UI - TOAST NOTIFICATIONS
// ═══════════════════════════════════════════════════════════════════════════════

function showToast(msg, type = 'info', duration = 3000) {
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = msg;
  document.getElementById('toastContainer').appendChild(el);
  setTimeout(() => el.remove(), duration);
}
