# Library and Navigation Label Simplification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite 8 English i18n string values (and their French counterparts where the meaning actually changes) on the main navigation and the Library list page, removing *arr/torrent-scene jargon and fixing one naming inconsistency, with zero code or behavior changes.

**Architecture:** Pure content edit. All target strings are leaf values in `apps/web/src/locales/en/common.json` and `apps/web/src/locales/fr/common.json`. No component, hook, or route file changes — every consuming component already references these keys by name (`t("nav.explore")`, `t("medias.library.statusWanted")`, etc.) and needs no changes.

**Tech Stack:** react-i18next JSON locale files; `bun run typecheck` / `bun run lint` / `bun run test` / `bun run build` (apps/web) for verification. No new dependencies.

## Global Constraints

- Content-only change: edit i18n string **values**, never key names. No component/hook/route edits.
- Target audience for the new wording: a user with **zero Sonarr/Radarr background** (per spec).
- Do **not** touch `medias.library.unmonitored`, TMDB-derived statuses (`returning`, `in_production`, `planned`, `upgrading`), the `Type`/`Status`/`Language` filter section "All" labels, or `episodesMissing` — all explicitly out of scope per the spec.
- Do **not** touch the other `wanted`/`discover` keys that exist elsewhere in the same locale files at different nesting levels: `dashboard.home.libraryStats.wanted`, `dashboard.libraryStats.wanted`, `medias.tabs.discover`, `library.stats.wanted` — these belong to the Dashboard and media tabs, not the Library page or main nav, and are out of scope.
- Every edit must be made in **both** `apps/web/src/locales/en/common.json` and `apps/web/src/locales/fr/common.json`. Where the spec's French meaning is already correct (see Task 1), the French value is intentionally left unchanged — do not "fix" it to literally mirror the English word choice.

---

## File Structure

Only two files are touched, both already existing:

- Modify: `apps/web/src/locales/en/common.json` — English string values.
- Modify: `apps/web/src/locales/fr/common.json` — French string values.

## Task 1: Edit all 8 target keys in both locale files

This is a single content-review unit — all 8 edits are the same kind of change (i18n string values) reviewed against the same spec table, so splitting them into separate tasks would only fragment one review into eight identical rubber-stamps. A reviewer either approves this whole content diff or requests changes to specific rows in it.

**Files:**
- Modify: `apps/web/src/locales/en/common.json`
- Modify: `apps/web/src/locales/fr/common.json`

**Interfaces:**
- Consumes: nothing (no prior tasks).
- Produces: nothing consumed by later tasks (this is the only implementation task).

**Target keys, current values, and confirmed dotted paths** (verified via a full-tree walk of both JSON files — these are the *only* occurrences of these key names that live under `nav.*` or `medias.library.*`):

| Dotted key | EN current (line) | EN new | FR current (line) | FR new |
|---|---|---|---|---|
| `nav.explore` | `Explore` (line 5) | `Browse` | `Découvrir` (line 5) | `Parcourir` |
| `nav.discover` | `Discover` (line 6) | `For You` | `Pour vous` (line 6) | `Pour vous` **(unchanged)** |
| `medias.library.statusWanted` | `Wanted` (line 1231) | `Missing` | `Voulu` (line 1231) | `Manquant` |
| `medias.library.itemStatus.wanted` | `Wanted` (line 1259) | `Missing` | `Voulu` (line 1259) | `Manquant` |
| `medias.library.sort.last_grabbed_at` | `Last grab` (line 1251) | `Last downloaded` | `Dernier grab` (line 1251) | `Dernier téléchargement` |
| `medias.library.sort.digital_release_date` | `Release Date` (line 1255) | `Digital release` | `Date de sortie` (line 1255) | `Sortie numérique` |
| `medias.library.sort.file_size` | `File Size` (line 1256) | `File size` | `Taille` (line 1256) | `Taille` **(unchanged)** |
| `medias.library.downloadsImport` | `Downloads import` (line 1293) | `Import downloads` | `Importer des téléchargements` (line 1293) | `Importer des téléchargements` **(unchanged)** |

Why the 3 "unchanged" rows: `nav.discover`'s French value is already the natural French phrase for "For You" (no change needed); `sort.file_size`'s French value `Taille` has no Title-Case-vs-sentence-case issue (that inconsistency is English-only); `downloadsImport`'s French value is already in the natural word order (the backwards phrasing was an English-only bug).

- [ ] **Step 1: Edit `apps/web/src/locales/en/common.json` — nav section (lines 5-6)**

Before:
```json
    "explore": "Explore",
    "discover": "Discover",
```

After:
```json
    "explore": "Browse",
    "discover": "For You",
```

- [ ] **Step 2: Edit `apps/web/src/locales/en/common.json` — `statusWanted` (line 1231)**

Before:
```json
      "statusWanted": "Wanted",
```

After:
```json
      "statusWanted": "Missing",
```

- [ ] **Step 3: Edit `apps/web/src/locales/en/common.json` — `sort` block (lines 1249-1256)**

Before:
```json
      "sort": {
        "added_at": "Date added",
        "last_grabbed_at": "Last grab",
        "title": "Title",
        "year": "Year",
        "status": "Status",
        "digital_release_date": "Release Date",
        "file_size": "File Size"
      },
```

After:
```json
      "sort": {
        "added_at": "Date added",
        "last_grabbed_at": "Last downloaded",
        "title": "Title",
        "year": "Year",
        "status": "Status",
        "digital_release_date": "Digital release",
        "file_size": "File size"
      },
```

- [ ] **Step 4: Edit `apps/web/src/locales/en/common.json` — `itemStatus.wanted` (line 1259)**

Before:
```json
      "itemStatus": {
        "wanted": "Wanted",
```

After:
```json
      "itemStatus": {
        "wanted": "Missing",
```

- [ ] **Step 5: Edit `apps/web/src/locales/en/common.json` — `downloadsImport` (line 1293)**

Before:
```json
      "downloadsImport": "Downloads import"
```

After:
```json
      "downloadsImport": "Import downloads"
```

- [ ] **Step 6: Edit `apps/web/src/locales/fr/common.json` — nav section (lines 5-6)**

Before:
```json
    "explore": "Découvrir",
    "discover": "Pour vous",
```

After:
```json
    "explore": "Parcourir",
    "discover": "Pour vous",
```

(Only `explore` changes; `discover` is already correct.)

- [ ] **Step 7: Edit `apps/web/src/locales/fr/common.json` — `statusWanted` (line 1231)**

Before:
```json
      "statusWanted": "Voulu",
```

After:
```json
      "statusWanted": "Manquant",
```

- [ ] **Step 8: Edit `apps/web/src/locales/fr/common.json` — `sort` block (lines 1249-1256)**

Before:
```json
      "sort": {
        "added_at": "Date d’ajout",
        "last_grabbed_at": "Dernier grab",
        "title": "Titre",
        "year": "Année",
        "status": "Statut",
        "digital_release_date": "Date de sortie",
        "file_size": "Taille"
      },
```

After:
```json
      "sort": {
        "added_at": "Date d’ajout",
        "last_grabbed_at": "Dernier téléchargement",
        "title": "Titre",
        "year": "Année",
        "status": "Statut",
        "digital_release_date": "Sortie numérique",
        "file_size": "Taille"
      },
```

(Only `last_grabbed_at` and `digital_release_date` change; `added_at`, `title`, `year`, `status`, `file_size` are unchanged — shown in full for exact-match context.)

- [ ] **Step 9: Edit `apps/web/src/locales/fr/common.json` — `itemStatus.wanted` (line 1259)**

Before:
```json
      "itemStatus": {
        "wanted": "Voulu",
```

After:
```json
      "itemStatus": {
        "wanted": "Manquant",
```

- [ ] **Step 10: Verify no unintended key was touched**

Run:
```bash
cd /home/samuelloranger/sites/rawkoon
git diff apps/web/src/locales/en/common.json apps/web/src/locales/fr/common.json
```

Expected: exactly 8 changed lines in the English file (`explore`, `discover`, `statusWanted`, `last_grabbed_at`, `digital_release_date`, `file_size`, `itemStatus.wanted`, `downloadsImport`) and exactly 4 changed lines in the French file (`explore`, `statusWanted`, `last_grabbed_at`, `digital_release_date`, `itemStatus.wanted` — 5 lines). No other lines in either file should appear in the diff. If `dashboard.home.libraryStats.wanted`, `dashboard.libraryStats.wanted`, `medias.tabs.discover`, or `library.stats.wanted` appear in the diff, you edited the wrong occurrence — revert and redo using the line numbers above.

- [ ] **Step 11: Confirm both files are still valid JSON**

Run:
```bash
cd /home/samuelloranger/sites/rawkoon
python3 -c "import json; json.load(open('apps/web/src/locales/en/common.json')); json.load(open('apps/web/src/locales/fr/common.json')); print('both valid')"
```

Expected: `both valid`

- [ ] **Step 12: Run the full verification gate**

Run:
```bash
cd /home/samuelloranger/sites/rawkoon
bun run typecheck && bun run lint && bun run formatCheck && bun run test
```

Expected: all four commands exit 0. This is a content-only diff — no test assertions reference these string values (only `libraryStatusPresentation.test.ts` exists near this area and it asserts on `labelKey` names, not translated text), so the existing suite should pass unchanged.

- [ ] **Step 13: Manual visual check**

Run the app locally (or use the project's `run` skill / existing dev script) and confirm, in both English and French (switch language in Settings → Profile, or via the locale switcher if present):
- Sidebar nav shows "Browse" and "For You" (EN) / "Parcourir" and "Pour vous" (FR) instead of "Explore"/"Discover".
- Library page: the "Wanted" status filter chip and any "Wanted" badge/row now read "Missing" (EN) / "Manquant" (FR).
- Library page sort dropdown reads, in order: Date added, **Last downloaded**, Title, Year, Status, **Digital release**, **File size** (EN) — and the French equivalents with `Dernier téléchargement` / `Sortie numérique`.
- Library page header button reads "Import downloads" (EN) — French already read this way.

- [ ] **Step 14: Commit**

```bash
cd /home/samuelloranger/sites/rawkoon
git add apps/web/src/locales/en/common.json apps/web/src/locales/fr/common.json
git commit -m "content: simplify Library and nav labels for zero-arr-background users

- nav.explore/discover -> Browse / For You (fr: Parcourir / Pour vous)
  to stop Explore and Discover reading as synonyms.
- medias.library.statusWanted + itemStatus.wanted: Wanted -> Missing
  (fr: Manquant), matching the app's own internal 'missing' concept.
- sort.last_grabbed_at: Last grab -> Last downloaded (fr: Dernier
  téléchargement) - removes torrent/arr slang.
- sort.digital_release_date: Release Date -> Digital release (fr:
  Sortie numérique) - matches the 'Digital {{date}}' badge elsewhere.
- sort.file_size: File Size -> File size (casing consistency).
- downloadsImport: Downloads import -> Import downloads (word order;
  fr already correct).

medias.library.unmonitored intentionally left unchanged (spec: would
mismatch the out-of-scope Monitor/Unmonitor detail-page toggle)."
```

---

## Self-Review

**Spec coverage:**
- Section 1 (nav) → Task 1 Steps 1, 6. ✓
- Section 2 (status vocabulary: Wanted→Missing, Last grab→Last downloaded) → Steps 2, 3, 4, 7, 8, 9. ✓
- Section 3 (sort consistency: Release Date→Digital release, File Size→File size) → Steps 3, 8. ✓
- Section 4 (downloadsImport) → Step 5 (FR already correct, no FR step needed — noted). ✓
- "Explicitly not changed" section → captured in Global Constraints and Step 10's diff-scope check. ✓
- Testing/acceptance criteria from spec → Steps 10-13 cover exact wording checks, JSON validity, full gate, and manual visual confirmation in both locales. ✓

**Placeholder scan:** No TBD/"handle appropriately" language; every step shows the literal before/after JSON.

**Type consistency:** N/A — no functions/types introduced; this is a content-only plan. Key names used in the table (`nav.explore`, `medias.library.statusWanted`, etc.) match the dotted paths confirmed by the full-tree walk during brainstorming, not guessed from grep line proximity.
