# Preferred Search Title Language — Design Spec

**Date:** 2026-08-01
**Status:** Approved design, ready for implementation planning
**Repo:** rawkoon
**Bug report:** `docs/bug-reports/2026-08-01-search-uses-english-title.md`

## Summary

Automatic and interactive indexer search currently query and match on a single
English `library_media.title` (`TMDB_LANGUAGE_LIBRARY_PERSISTENCE = "en-US"`).
Shows whose releases only exist under the original/foreign title (e.g.
*Belflower* / *Bellefleur*) never match on cron or RSS.

This change introduces a **preferred search title** per library item, defaulted
from a new **quality-profile search language**, overridable via a TMDB-only
select on the library item. Search tries the preferred title first, then the
original title when distinct. Existing rows with unset fields keep today’s
English-only behavior (future-only; no mass backfill or attempt reset).

## Goals

- Let every search path (cron episodes, cron movies, RSS, interactive) use a
  preferred query title instead of English-only.
- Default that preference from the media’s quality profile
  (`preferred_search_language`), resolved against TMDB titles at add time.
- Allow a per-media override via a select of TMDB-available titles only (no free
  text), placed below the quality-profile picker on Management.
- Accept releases whose title matches preferred **or** original (match set), so
  fallback grabs are not discarded by `expectedTitle` / RSS equality.
- Leave pre-migration library rows unchanged until they are newly added (or a
  future optional script); no automatic `search_attempts` reset.

## Non-Goals

- Mass backfill of existing library rows.
- Auto-unskip / reset of burned `search_attempts` (including *Bellefleur*).
- Free-text custom search titles.
- Searching every TMDB translation on every cron tick.
- Rewriting `search_title` when a media’s quality profile later changes.
- Fixing unrelated secrets / unencrypted tracker password storage noted in the
  bug report.

## Approaches considered

- **(chosen) Dedicated columns + shared resolver.**
  `original_title`, `original_language`, `search_title`,
  `search_title_language` on `library_media`; QP
  `preferred_search_language`; one `resolveSearchTitles` helper for all paths.
- **Rejected — store preference in `overrides` JSON.** Weak typing; conflicts
  with display-override semantics; awkward for worker `select`s.
- **Rejected — aliases / translations child table.** Overkill for preferred +
  original-fallback; more join surface for every worker.

## Data model

### `library_media` (new nullable columns)

| Column | Purpose |
|---|---|
| `original_title` | TMDB original title |
| `original_language` | ISO 639-1 |
| `search_title` | Denormalized preferred query string |
| `search_title_language` | ISO code of that preference |

- Existing rows stay `NULL` → English `title` only.
- On **add to library**, populate all four from TMDB details using the assigned
  quality profile’s `preferred_search_language` (null → `en`).
- Per-media picker updates `search_title` + `search_title_language` only;
  original fields remain TMDB truth.
- Expose all four on shared `LibraryMedia` / API responses.

### `quality_profile` (new field)

- `preferred_search_language` — ISO 639-1 string, nullable; null means `en`.
- Distinct from existing audio `preferredLanguages` (release-name audio flags).
- Editable in quality-profile settings UI.

## Search title resolution

Shared API helper used by episode cron, movie cron, RSS, interactive default,
and the `searchAndGrab` match filter:

```ts
resolveSearchTitles(media) → {
  queries: string[]      // ordered, deduped
  matchTitles: string[]  // same strings; callers normalize for comparison
}
```

**Query order**

1. If `search_title` set → first.
2. If `original_title` set and distinct from (1) → append as fallback.
3. If neither set → `[media.title]` (legacy English).

**Cron / grab flow:** `searchAndGrab` with `queries[0]`; if no grab and
`queries[1]` exists, retry with `queries[1]`. One cron attempt increment per
tick (not per title try). Movie year suffix appends to whichever title is
queried.

**Match set:** every string in `queries`. `expectedTitle` becomes set membership
(normalized release starts with any match title). RSS equality uses the same set
(season/episode/year rules unchanged).

**Interactive:** default selected option = persisted `search_title` when set.
Session `SearchTitleSelect` remains local and does not write preference;
Management picker is the only writer.

## Add-to-library defaults

1. Read QP `preferred_search_language` (default `en`).
2. Resolve title in order: TMDB translation for that code → else
   `original_title` when the code equals `original_language` → else English
   `title`.
3. Write `search_title`, `search_title_language`, `original_title`,
   `original_language`.
4. If TMDB fetch fails at add → create the library row as today; leave search
   fields null (legacy path) rather than failing the add.
5. Changing quality profile later does **not** rewrite `search_title`.

## UI

- **Quality profiles:** expose `preferred_search_language` alongside other
  preference fields.
- **Library item Management:** TMDB-only select below the quality-profile
  picker (`LibraryQualityProfileSection`). Options built like interactive
  `buildTitleOptions` (library English, EN/FR, original, common translations).
  Admin-only.
- If TMDB details unavailable → disable select; show English title as read-only
  hint.
- PATCH must reject titles/languages not in the validated TMDB option set for
  that media.

## Edge cases

- QP language has no TMDB title → default write uses English `title`; still
  store `original_*` when present.
- Preferred equals original → single query (dedupe).
- Preferred set, original null → preferred only.
- All four null (legacy) → English `title` only.
- Preferred queried first but release only matches original → still accepted via
  match set.

## Testing

**Unit:** `resolveSearchTitles` (legacy / preferred / preferred+original /
dedupe); match filter accepts either title; add-to-library mapping from QP
language + mock TMDB translations; missing translation → English.

**API / workers:** episode + movie cron preferred-then-original; single attempt
increment; RSS matches either normalized title; PATCH rejects non-TMDB options.

**Web:** Management select under QP picker saves code + title; interactive
default follows `search_title`; quality-profile form exposes
`preferred_search_language`.

## Out of scope follow-ups (optional later)

- One-shot backfill script for existing library rows.
- Reset `search_attempts` / un-skip when search titles change.
- Secrets / `enc:` tracker password cleanup from the bug-report side note.
