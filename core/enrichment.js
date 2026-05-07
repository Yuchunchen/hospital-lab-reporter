// ─── enrichment.js ───────────────────────────────────────────────
// Manifest-driven sub-page enrichment (opdweb 請 Click 正式報告)
//
// Extracted verbatim from hospital-lab-data.html (Phase 1 restructure,
// 2026-05-08). Functions stay top-level; the build concatenates every
// core/*.js into a single <script> block, so cross-module calls Just Work
// the way they did in the monolith.

// ═══════════════════════════════════════════════════════════════════════════════
// SUB-PAGE ENRICHMENT (manifest-driven, two-pass)
// ═══════════════════════════════════════════════════════════════════════════════
// Some lab orders only show "請 Click「正式報告」" in the main reportText —
// the actual values live behind opdweb's OpdOrderReport.aspx sub-page. After
// the caller's normal extraction, this pass:
//   1. computes which manifest testIds are still missing,
//   2. fetches the sub-pages of candidate "請 Click" orders within cutoff,
//   3. splices any matched fragments back into order.reportText so the next
//      extractLabValues() call picks them up.
// Sub-page text is cached in localStorage by ordapno (lab reports are
// signed off and immutable, so no TTL). The cache is shared across disease
// HTMLs — same ordapno in dialysis vs CKD vs DM has identical sub-page
// content, so a per-disease key would just waste space + duplicate API calls.

const ENRICH_CACHE_KEY = 'enrichCache';

// One-time migration: legacy per-disease key → shared key. Runs once on load;
// merges if both keys somehow co-exist (the new key wins on collision since
// any newer fetch under the unified key is fresher).
(function migrateEnrichCache() {
  const OLD_KEY = 'enrichCache_dialysis';
  const NEW_KEY = 'enrichCache';
  try {
    const old = localStorage.getItem(OLD_KEY);
    if (!old) return;
    const cur = localStorage.getItem(NEW_KEY);
    if (!cur) {
      localStorage.setItem(NEW_KEY, old);
      localStorage.removeItem(OLD_KEY);
      console.log('[enrichCache] migrated enrichCache_dialysis → enrichCache');
    } else {
      const merged = Object.assign({}, JSON.parse(old), JSON.parse(cur));
      localStorage.setItem(NEW_KEY, JSON.stringify(merged));
      localStorage.removeItem(OLD_KEY);
      console.log('[enrichCache] merged enrichCache_dialysis into enrichCache');
    }
  } catch (e) {
    console.warn('[enrichCache] migration failed:', e);
  }
})();

function loadEnrichCache() {
  try { return JSON.parse(localStorage.getItem(ENRICH_CACHE_KEY)) || {}; }
  catch { return {}; }
}
function saveEnrichCache(cache) {
  try { localStorage.setItem(ENRICH_CACHE_KEY, JSON.stringify(cache)); }
  catch (e) { console.warn('[enrichCache] save failed (likely quota):', e); }
}
function enrichCacheGet(ordapno) {
  if (!ordapno) return null;
  const c = loadEnrichCache();
  const slot = c[String(ordapno)];
  return slot ? slot.text : null;
}
function enrichCachePut(ordapno, text) {
  if (!ordapno || !text) return;
  const c = loadEnrichCache();
  c[String(ordapno)] = { text, ts: Date.now() };
  saveEnrichCache(c);
}

// Derive opdweb URL from ernode base, e.g.
//   http://ernode.vghb12.vhtt.gov.tw:8000 → http://opdweb.vghb12.vhtt.gov.tw
function getOpdwebBase(ernodeBaseUrl) {
  try {
    const u = new URL(ernodeBaseUrl);
    u.hostname = u.hostname.replace(/^ernode\./, 'opdweb.');
    u.port = '';
    return u.origin;
  } catch { return null; }
}

function buildSubpageUrl(ordapno, chartno, ernodeBaseUrl, opsid) {
  const base = getOpdwebBase(ernodeBaseUrl);
  if (!base) return null;
  return `${base}/QueryReport/OpdOrderReport.aspx?OrdApNo=${ordapno}&hisnum=${chartno}&opid=${opsid}`;
}

async function fetchSubpageText(url) {
  const resp = await fetch(url, { credentials: 'omit' });
  if (!resp.ok) return '';
  const html = await resp.text();
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return doc.body?.textContent || '';
}

// Splice into order.reportText whatever the sub-page reveals about the
// missing tests. Returns true if anything was appended.
function applySubpageText(order, subpageText, missingTests) {
  if (!subpageText) return false;
  const additions = [];
  for (const t of missingTests) {
    if (!t.pattern) continue;
    // Phase A: sub-page already carries the main-page label.
    const mMain = subpageText.match(t.pattern);
    if (mMain && mMain[0]) {
      additions.push(mMain[0]);
      continue;
    }
    // Phase B: catalog `subpage` config — orderName-gated translation
    // (e.g. Aluminum sub-page only has "Result: N", no "Al鋁:").
    const sp = t.subpage;
    if (!sp || !sp.resultPattern) continue;
    if (sp.orderNameMatch && !sp.orderNameMatch.test(order.orderName || '')) continue;
    const mSub = subpageText.match(sp.resultPattern);
    if (mSub && mSub[1]) {
      additions.push(`${sp.synthLabel || t.id}: ${String(mSub[1]).trim()}`);
    }
  }
  if (!additions.length) return false;
  order.reportText = (order.reportText ? order.reportText + ' ; ' : '')
                   + additions.join(' ; ');
  return true;
}

// Per-test chase semantics:
//   - Tests WITHOUT a `subpage` config: chased only when the value is
//     entirely missing across every order's reportText (single-value style).
//   - Tests WITH a `subpage` config (e.g. Aluminum): chased per-order even
//     when one main-page value already exists. Annual lab tracking needs
//     ALL historical "請 Click" entries to fill the dialysis CSV column,
//     not just the most-recent visible value.
async function enrichMissingValues(labOrders, chartno, manifest, opts) {
  opts = opts || {};
  const onProgress = opts.onProgress;
  const maxFetches = opts.maxFetches != null ? opts.maxFetches : 15;

  const settings = loadSettings();
  if (!settings.baseUrl || !settings.opsid) return;

  const tests = (manifest || []).filter(t => t && t.pattern instanceof RegExp);
  if (!tests.length) return;

  // Pass 1: which testIds appear at least once in any order's reportText?
  const presentIds = new Set();
  for (const o of labOrders) {
    if (!o.reportText) continue;
    for (const t of tests) {
      if (presentIds.has(t.id)) continue;
      if (t.pattern.test(o.reportText)) presentIds.add(t.id);
    }
  }

  // Only chase tests that explicitly opt in via catalog `subpage.orderNameMatch`.
  // Without an orderName signal we'd brute-fetch every "missing" candidate
  // (verified blow-up 2026-05-07: queue=132 for a patient missing AntiHCV/AFP,
  // all CORS-blocked under file:// origin anyway). Tests opt in by adding
  // subpage.orderNameMatch (and optionally subpage.resultPattern for
  // sub-page label translation, e.g. Aluminum's "Result: N" → "Al鋁: N").
  const chaseTests = tests.filter(t => t.subpage && t.subpage.orderNameMatch);
  if (!chaseTests.length) return;

  function relevantTestsForOrder(o) {
    const out = [];
    for (const t of chaseTests) {
      if (t.pattern.test(o.reportText || '')) continue; // already on main page for this order
      if (t.subpage.orderNameMatch.test(o.orderName || '')) out.push(t);
    }
    return out;
  }

  const queue = [];
  for (const o of labOrders) {
    if (!o.ordapno) continue;
    const rel = relevantTestsForOrder(o);
    if (rel.length) queue.push({ order: o, tests: rel });
  }
  if (!queue.length) return;

  let fetched = 0;
  for (let i = 0; i < queue.length && fetched < maxFetches; i++) {
    const { order, tests: relTests } = queue[i];
    const url = buildSubpageUrl(order.ordapno, chartno, settings.baseUrl, settings.opsid);
    if (!url) continue;

    let text = enrichCacheGet(order.ordapno);
    if (!text) {
      if (onProgress) onProgress(`補抓子頁面 ${fetched + 1}/${maxFetches}（candidate ${i + 1}/${queue.length}）`);
      try {
        text = await fetchSubpageText(url);
        if (text) enrichCachePut(order.ordapno, text);
      } catch { continue; }
      fetched++;
    }
    if (!text) continue;

    applySubpageText(order, text, relTests);
  }
}
