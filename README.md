# hospital-lab-reporter

<!-- 洗腎室檢驗資料案管系統 — 獨立 HTML 網頁 -->

Single self-contained HTML application for managing dialysis patient lab data.
Used at 臺北榮民總醫院臺東分院 (vhtt) and 玉里分院 (vhyl) hemodialysis units.

## What it does

Open `hospital-lab-data.html` in a browser → add patients by chart number →
the app fetches labs from the ernode API → displays a longitudinal table
(rows = tests, columns = dates) → exports CSV aligned to the official
「病人定期檢查記錄」form.

## File layout

```
hospital-lab-reporter/
├── hospital-lab-data.html    ← Main app (~3000 lines, all-in-one HTML+CSS+JS)
│   ├── __HOSPITAL_LAB_PATTERNS_BEGIN/END__  ← auto-generated pattern block
│   └── __HOSPITAL_LAB_GROUPS_BEGIN/END__    ← auto-generated group modules
├── groups/
│   └── dialysis.js           ← Dialysis disease group (manifest, monthly-draw
│                                detection, BUN pre/post, CSV exporter)
├── sync-patterns.js          ← Sync patterns + groups into HTML marker blocks
├── fetcher.js                ← (server-side, not primary path)
├── server.js                 ← (server-side, not primary path)
├── cache.js                  ← (server-side, not primary path)
├── patients.js               ← (server-side, not primary path)
├── csv-compiler.js           ← (server-side, not primary path)
├── lab-mapping.js            ← (server-side, not primary path)
├── package.json              ← Node dependencies for sync
├── CLAUDE.md                 ← Per-repo rules for Claude
└── WORKLOG.md                ← Change log (繁體中文)
```

**Note:** Files marked "(server-side, not primary path)" are from an earlier
Node.js architecture. The current user flow is entirely client-side within
`hospital-lab-data.html`. They remain for potential future server-side use.

## Pattern source

All regex patterns, reference ranges, and computed values come from the
sibling repo [`hospital-lab-patterns`](https://github.com/Yuchunchen/hospital-lab-patterns).
**Do NOT hand-edit** content between `__HOSPITAL_LAB_PATTERNS_BEGIN/END__`
or `__HOSPITAL_LAB_GROUPS_BEGIN/END__` markers — `sync-patterns.js` overwrites them.

## Quick start

```powershell
# After pattern or group changes:
node sync-patterns.js

# Use the app:
# Just open hospital-lab-data.html in any browser (no server needed)
```

## Key features

- **3 tabs**: 病患清單 (patient list) / 檢驗資料 (lab data) / 設定 (settings)
- **CSV export**: Long-format, aligned to official 「病人定期檢查記錄」form
- **Monthly draw detection**: Clusters labs by 生效時間, identifies regular monthly checks
- **BUN pre/post**: Method A (dateObj sort) + Method B (orderName keyword) fallback
- **Demographics auto-fill**: Name/sex/age parsed from ernode response header
- **Sort + filter**: Column headers clickable, state persisted in localStorage
- **Per-row actions**: Single-patient refresh (↻) and delete (✕)
- **Gender-aware thresholds**: loM/hiM/loF/hiF alarm coloring
- **Multi-disease framework** (in progress): `groups/` directory for dialysis / CKD / DM / COPD

## Current counts

- 37 reporter-resolved lab tests (from patterns repo)
- 2 computed values (URR, Ca×P)
- 1 disease group active (dialysis)

## Privacy

Never commit real chart numbers, patient names, or exported CSV/JSON files.

## License

Proprietary / internal use.
