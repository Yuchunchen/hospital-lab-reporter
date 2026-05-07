// ─── chart-format.js ───────────────────────────────────────────────
// formatChartNo (9-digit + 1-letter normalisation)
//
// Extracted verbatim from hospital-lab-data.html (Phase 1 restructure,
// 2026-05-08). Functions stay top-level; the build concatenates every
// core/*.js into a single <script> block, so cross-module calls Just Work
// the way they did in the monolith.

// ═══════════════════════════════════════════════════════════════════════════════
// CHART NUMBER FORMATTING
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Normalize chart number to 9-digit + 1-letter format (e.g. "810385G" -> "000810385G").
 */
function formatChartNo(raw) {
  const s = raw.trim();
  if (!s) throw new Error('請輸入病歷號');
  const last = s[s.length - 1];
  if (!/[a-zA-Z]/.test(last)) throw new Error('病歷號須以英文字母結尾 (如 810385G)');
  const letter = last.toUpperCase();
  const digitStr = s.slice(0, -1).replace(/\D/g, '');
  if (!digitStr) throw new Error('病歷號中未找到數字');
  if (digitStr.length > 9) throw new Error('數字部分最多 9 碼');
  return digitStr.padStart(9, '0') + letter;
}
