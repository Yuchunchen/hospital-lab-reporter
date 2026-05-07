// ─── date-utils.js ───────────────────────────────────────────────
// Taiwan / Gregorian / 民國 date helpers + todayStr
//
// Extracted verbatim from hospital-lab-data.html (Phase 1 restructure,
// 2026-05-08). Functions stay top-level; the build concatenates every
// core/*.js into a single <script> block, so cross-module calls Just Work
// the way they did in the monolith.

// ═══════════════════════════════════════════════════════════════════════════════
// DATE UTILITIES
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Parse RESDTTM: "20260414203800" -> Date (with HH:MM:SS retained when present).
 * Step 2 needs the time-of-day suffix to sort BUN_pre vs BUN_post by report time.
 */
function parseDateResdttm(str) {
  if (!str || str.length < 8) return null;
  const y  = +str.slice(0, 4),
        m  = +str.slice(4, 6) - 1,
        d  = +str.slice(6, 8),
        hh = str.length >= 10 ? +str.slice(8, 10) : 0,
        mm = str.length >= 12 ? +str.slice(10, 12) : 0,
        ss = str.length >= 14 ? +str.slice(12, 14) : 0;
  return new Date(y, m, d, hh, mm, ss);
}

/**
 * Parse Taiwan calendar date: "115/04/14 19:36" -> Date (with HH:MM[:SS] retained).
 * Step 2 needs the time-of-day suffix when RESDTTM is missing.
 */
function parseDateTaiwan(str) {
  if (!str) return null;
  const match = str.match(/^(\d+)\/(\d+)\/(\d+)(?:\s+(\d+):(\d+)(?::(\d+))?)?/);
  if (!match) return null;
  return new Date(
    +match[1] + 1911,
    +match[2] - 1,
    +match[3],
    +(match[4] || 0),
    +(match[5] || 0),
    +(match[6] || 0)
  );
}

/** Format Date to Taiwan calendar string: "115/04/14" */
function toTaiwanDate(d) {
  if (!d) return '';
  const y = d.getFullYear() - 1911;
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}/${m}/${day}`;
}

/** Format Date to short display: "04/14" */
function toShortDate(d) {
  if (!d) return '';
  return `${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')}`;
}

/** Format Date as YYYY-MM-DD for sorting */
function toSortableDate(d) {
  if (!d) return '';
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

/** YYYY-MM-DD → 民國年 7 碼 RRRMMDD (e.g. 2025-05-07 → "1140507"). */
function toMinguoDate(isoDate) {
  if (!isoDate) return '';
  const m = String(isoDate).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return '';
  const y = (parseInt(m[1], 10) - 1911);
  return `${y}${m[2]}${m[3]}`;
}

/** YYYYMMDD for filenames. */
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;
}
