// ─── lab-extract.js ───────────────────────────────────────────────
// extractLabValues + BUN A/B post-processing.
// computeDerivedValues was split out into core/compute.js (Phase 1 restructure).
//
// Extracted verbatim from hospital-lab-data.html (Phase 1 restructure,
// 2026-05-08). Functions stay top-level; the build concatenates every
// core/*.js into a single <script> block, so cross-module calls Just Work
// the way they did in the monolith.

// ═══════════════════════════════════════════════════════════════════════════════
// LAB VALUE EXTRACTION
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Extract lab values from fetched orders.
 * Returns { testId: [{date, value, dateObj, reportDateTime, orderName}, ...], ... }
 *
 * Step 2: BUN pre/post is no longer pre-classified at the parser layer. Both
 * BUN_pre and BUN_post testIds match every BUN occurrence; the dialysis
 * group's resolveBUN() re-derives pre/post from reportDateTime per cluster.
 * The legacy `composite` / `standalone_bun` filter strings (which never
 * matched the catalog's actual orderNameFilter regex anyway) have been
 * removed.
 */
function extractLabValues(orders) {
  const results = {};
  LAB_TESTS.forEach(t => { results[t.id] = []; });

  // Filter to LAB orders within last 12 months (except hepatitis/HIV/RPR: all-time)
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - 12);
  cutoff.setHours(0, 0, 0, 0);

  const ALL_TIME_IDS = new Set(['HBsAg', 'AntiHBs', 'AntiHCV', 'HIV', 'RPR']);
  // Tests with sub-page enrichment chase historical values (e.g. annual
  // Aluminum). Give them all-time treatment too so the enriched older
  // entries don't get dropped by the 12-month cutoff downstream.
  LAB_TESTS.forEach(t => { if (t && t.subpage) ALL_TIME_IDS.add(t.id); });

  for (const order of orders) {
    if (order.ordType && order.ordType !== 'LAB') continue;
    if (!order.reportText) continue;

    const dateObj = parseDateResdttm(order.resdttm) || parseDateTaiwan(order.orderDate);
    if (!dateObj) continue;

    const text = order.reportText;
    const dateStr = toSortableDate(dateObj);
    const reportDateTime = dateObj.toISOString(); // full timestamp persisted for resolveBUN (legacy)
    const orderName     = order.orderName    || '';
    // Revision 1: persist explicit cluster anchor + BUN-sort key per entry.
    // effectiveTime = 生效時間 (monthly cluster key); signOffTime = 簽收時間 (BUN pre/post sort).
    const effectiveTime = order.effectiveTime || null;
    const signOffTime   = order.signOffTime   || null;

    for (const test of LAB_TESTS) {
      // Date filter: all-time for hepatitis/HIV/RPR, 12 months for everything else
      if (!ALL_TIME_IDS.has(test.id) && dateObj < cutoff) continue;

      const match = text.match(test.pattern);
      if (!match) continue;

      let value = match[1];
      if (!test.qualitative) {
        // Detection-limit markers: keep "<N" / ">N" as a normalised string
        // (e.g. "Al鋁: <2"). Downstream consumers naturally degrade — table
        // rendering parseFloat → NaN → renders as plain text without alarm
        // colour; URR/Ca×P guard with isFinite; CSV stringifies as-is.
        // Skipping normalize() for these is safe — the `<` / `>` markers
        // historically come from manual lab annotations, not unit-conversion
        // candidates (no test today applies normalize to such values).
        const trimmed = String(value).replace(/\s+/g, '');
        if (/^[<>]/.test(trimmed)) {
          value = trimmed;
        } else {
          value = parseFloat(value);
          if (isNaN(value)) continue;
          if (test.normalize) {
            // catalog references normalizers by string name (so it stays
            // JSON-serialisable); look up the function from the bundled
            // NORMALIZERS table. Tolerate function references too for
            // forward/backward compat.
            const fn = typeof test.normalize === 'function'
              ? test.normalize
              : (typeof NORMALIZERS !== 'undefined' && NORMALIZERS[test.normalize]);
            if (typeof fn === 'function') value = fn(value);
          }
        }
      }

      // Dedupe: prefer signOffTime as the discriminator (it's the most
      // unique per-draw timestamp), then reportDateTime, finally fall back
      // to date+value when neither timestamp is present.
      const existing = results[test.id];
      const dup = existing.find(e =>
        e.value === value &&
        ((e.signOffTime   && e.signOffTime   === signOffTime)   ||
         (e.reportDateTime && e.reportDateTime === reportDateTime) ||
         (!e.signOffTime && !e.reportDateTime && e.date === dateStr))
      );
      if (!dup) {
        existing.push({
          date: dateStr,
          value,
          dateObj,
          reportDateTime,
          effectiveTime,
          signOffTime,
          orderName,
        });
      }
    }
  }

  // Sort each test's results by date (newest first)
  for (const id in results) {
    results[id].sort((a, b) => b.date.localeCompare(a.date));
  }

  // Revision 1 hotfix (2026-05-05): rebuild BUN_pre[] / BUN_post[].
  // Both regexes match every BUN occurrence, so each entry was being stored
  // in BOTH arrays — leaving BUN(AD) effectively empty downstream.
  classifyBUNPrePost(results);

  return results;
}

/**
 * Post-processing pass for BUN_pre / BUN_post (revision 1 hotfix).
 *
 * Both BUN_pre and BUN_post share the same /BUN:\s*([\d.]+)/ regex, so every
 * BUN draw lands in BOTH arrays. This pass rebuilds the two arrays so each
 * physical draw appears exactly once in the correct bucket.
 *
 * Method A (primary, cross-hospital safe): sort same-date entries by
 * signOffTime / dateObj — earliest = pre (洗前), latest = post (洗後).
 * Method B (fallback): when A is ambiguous (missing timestamps or ties),
 * match orderName for 洗前 / 洗後 markers.
 */
function classifyBUNPrePost(results) {
  const pre  = results.BUN_pre  || [];
  const post = results.BUN_post || [];
  const all  = [...pre, ...post];
  if (all.length === 0) return results;

  // Dedupe: same physical draw in BUN_pre[] and BUN_post[].
  const seen = new Set();
  const dedup = [];
  for (const e of all) {
    const tsKey = e.signOffTime
      || (e.dateObj instanceof Date ? e.dateObj.toISOString() : '')
      || e.reportDateTime
      || e.date
      || '';
    const key = String(e.value) + '|' + tsKey + '|' + (e.orderName || '');
    if (seen.has(key)) continue;
    seen.add(key);
    dedup.push(e);
  }

  // Group by date (YYYY-MM-DD)
  const byDate = {};
  for (const e of dedup) {
    if (!e.date) continue;
    if (!byDate[e.date]) byDate[e.date] = [];
    byDate[e.date].push(e);
  }

  const newPre = [];
  const newPost = [];
  for (const date in byDate) {
    const { pre: p, post: q } = classifyBUNForDate(byDate[date], date);
    if (p) newPre.push(p);
    if (q) newPost.push(q);
  }

  newPre.sort((a, b) => b.date.localeCompare(a.date));
  newPost.sort((a, b) => b.date.localeCompare(a.date));
  results.BUN_pre  = newPre;
  results.BUN_post = newPost;
  return results;
}

function _bunEntryTime(e) {
  if (e.signOffTime) {
    const t = new Date(e.signOffTime).getTime();
    if (Number.isFinite(t)) return t;
  }
  if (e.dateObj instanceof Date) {
    const t = e.dateObj.getTime();
    if (Number.isFinite(t)) return t;
  }
  if (e.reportDateTime) {
    const t = new Date(e.reportDateTime).getTime();
    if (Number.isFinite(t)) return t;
  }
  return null;
}

function classifyBUNForDate(entries, date) {
  if (entries.length === 1) return { pre: entries[0], post: null };

  const times = entries.map(_bunEntryTime);
  const hasMissing = times.some(t => t == null);
  const present    = times.filter(t => t != null);
  const hasTie     = present.length !== new Set(present).size;

  // Method A — sort by timestamp; earliest = pre, latest = post.
  if (!hasMissing && !hasTie) {
    const sorted = [...entries].sort((a, b) => _bunEntryTime(a) - _bunEntryTime(b));
    if (sorted.length > 2) {
      try { console.warn(`[BUN] 3+ entries on date ${date} — taking earliest as pre, latest as post`, entries); } catch (_) {}
    }
    return { pre: sorted[0], post: sorted[sorted.length - 1] };
  }

  // Method B — fallback by orderName text.
  try { console.warn(`[BUN] classification fell back to orderName for date ${date}`, entries); } catch (_) {}
  let pre = null, post = null;
  const unmarked = [];
  for (const e of entries) {
    const name = e.orderName || '';
    if (name.includes('洗後')) {
      if (!post) post = e;
    } else if (name.includes('洗前')) {
      if (!pre) pre = e;
    } else {
      unmarked.push(e);
    }
  }
  if (!pre  && unmarked.length > 0) pre  = unmarked.shift();
  if (!post && unmarked.length > 0) post = unmarked.shift();
  if (unmarked.length > 0) {
    try { console.warn(`[BUN] ambiguous on date ${date} — extra unmarked entries dropped`, entries); } catch (_) {}
  }
  return { pre, post };
}

// computeDerivedValues lives in core/compute.js
