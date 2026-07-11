# Simplify Library and navigation labels

## Goal

Rewrite a small set of *arr-scene/torrent jargon and ambiguous copy on the
main navigation and the Library list page so a user with **zero Sonarr /
Radarr background** can understand primary actions and status at a glance.
This is a content-only change: i18n string values, in English and French.
No component logic, layout, or behavior changes.

## Scope

In scope:
- Main navigation labels (`nav.explore`, `nav.discover`).
- Library list page: status filter/badge vocabulary, sort labels, one header
  button label.

Out of scope (explicitly deferred):
- Item detail page management actions (`Monitor`/`Unmonitor` toggle, `Grab`,
  `Sync status`, `Retry search`, toast copy) — these share vocabulary with the
  in-scope "Unmonitored" list-row chip; changing one without the other would
  create a mismatch, so both are left as a follow-up task if wanted later.
- Any layout, component structure, or behavior change.

## Changes

### 1. Navigation

| i18n key | Current | New | Why |
|---|---|---|---|
| `nav.explore` | Explore | **Browse** | Names the actual behavior — a TMDB browsing grid (trending/popular/upcoming sections). |
| `nav.discover` | Discover | **For You** | A swipe-deck personalized recommendation feed. "Explore" and "Discover" were near-synonyms with no way to tell them apart before clicking; "Browse" vs "For You" describe distinct mental models (streaming-app convention: Netflix/Spotify use "For You" for this exact pattern). |

### 2. Library status vocabulary

| i18n key(s) | Current | New | Why |
|---|---|---|---|
| `medias.library.statusWanted`, `medias.library.itemStatus.wanted` | Wanted | **Missing** | Matches the app's own internal concept name (`cardStatus: "missing"` in `libraryStatusPresentation.ts`). "Wanted" invites "wanted by whom?" for a new user; "Missing" is self-explanatory. |
| `medias.library.sort.last_grabbed_at` | Last grab | **Last downloaded** | "Grab" is torrent-scene/*arr slang for "downloaded a release." Plain language for a general audience. |

### 3. Sort label consistency

| i18n key | Current | New | Why |
|---|---|---|---|
| `medias.library.sort.digital_release_date` | Release Date | **Digital release** | The item card elsewhere already labels this same field `Digital {{date}}` (`medias.library.digitalRelease`). The sort dropdown calling it "Release Date" is an internal naming mismatch, not just a casing nit. |
| `medias.library.sort.file_size` | File Size | **File size** | Sentence-case, matching the other 6 sort labels (`Date added`, `Title`, `Year`, `Status`, `Last downloaded`). |

### 4. Header button

| i18n key | Current | New | Why |
|---|---|---|---|
| `medias.library.downloadsImport` | Downloads import | **Import downloads** | Reads backwards; "Import downloads" is the natural English word order for the same admin action (linking to `/library/downloads`). |

## Explicitly not changed

- **`medias.library.unmonitored`** ("Unmonitored" list-row chip, shown when an item isn't tracked for new episodes/upgrades) is left as-is. Renaming it without also renaming the paired `Monitor`/`Unmonitor` toggle button on the item detail page (out of scope) would leave the list and detail pages using different vocabulary for the same concept. Revisit together if the detail-page actions are ever tackled.
- Filter section labels (`Type`, `Status`, `Language` each showing an "All" option) — this is standard, unambiguous filter-UI repetition, not jargon.
- TMDB-derived show statuses (`Returning`, `In Production`, `Planned`, `Upgrading`) — left as-is; reasonably self-explanatory in context and not torrent/*arr-specific jargon.
- `episodesMissing` ("{{count}} ep missing") abbreviation — a deliberate space-saving choice for a small card badge, not jargon.

## Implementation notes

- Every change is a string-value edit in `apps/web/src/locales/en/common.json`
  and its French counterpart `apps/web/src/locales/fr/common.json` — no key
  renames, no code changes, since components already reference these keys by
  name.
- No new i18n keys, no key removals.

## Testing

- No unit test changes expected (no logic changes); the existing
  `libraryStatusPresentation.test.ts` continues to assert on the `labelKey`
  strings (key names, not values), which are unaffected.
- Manual verification: build the web app, visually confirm the nav labels,
  Library filter chips, sort dropdown, and header button read as specified,
  in both English and French.

## Acceptance criteria

1. `nav.explore` renders "Browse" and `nav.discover` renders "For You" in the
   sidebar, in both locales (translated appropriately in French).
2. The Library status filter chip and item badge/row previously reading
   "Wanted" now read "Missing" everywhere that key is used.
3. The Library sort dropdown reads: Date added, **Last downloaded**, Title,
   Year, Status, **Digital release**, **File size** — no remaining Title Case
   inconsistency.
4. The Library page header button reads "Import downloads".
5. `medias.library.unmonitored` value is unchanged.
6. `bun run typecheck`, `bun run lint`, `bun run test` all pass unchanged
   (this is a content-only diff).
