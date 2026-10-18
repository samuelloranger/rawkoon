# Per-show episode numbering — design

Date: 2026-10-18 · Status: proposed.

## Goal

Let an admin choose, per show, where its season and episode numbers come from,
so the library's episode rows match the files on disk and the releases on
indexers. TMDB stays the default and nothing changes for a show that never opts
in.

## Problem

Rawkoon builds a show's episode rows from TMDB's default order
(`upsertLibraryShowEpisodesFromTmdb`): one row per TMDB episode, keyed by
`(media_id, season, episode)`. Files and grabs are linked to those rows by
number, and searches ask indexers for `SxxEyy` by number. Indexer releases, and
libraries imported from Sonarr, mostly follow TVDB's aired order. When TMDB's
numbering differs from it, three things go wrong:

1. **TMDB merged a two-part episode into one record.** Every later episode in
   the season shifts down by one, so files carry the wrong title in Rawkoon.
   The part numbers past the end of TMDB's season become orphan rows. The sync
   never deletes them (it only upserts), and a file-less one stays wanted.
   It is then searched until it is auto-skipped.
2. **The files follow the DVD order.** Two episodes swap places, and both get
   the other's title.
3. **A file holds two episodes** (`S09E23-E24`). The importer links it to the
   first number only (`parseReleaseSeasonEpisode` keeps `episodes[0]`), so the
   second episode looks missing and is searched until it is skipped.

Comparing a real library's files against each source, title by title, showed:

- Most shows match TMDB exactly. Nothing should change for them.
- Shows with TMDB-merged two-parters match **TVmaze**, which keeps each part as
  its own episode.
- **No single source fits every show.** TVmaze mis-numbers some animated series
  that TMDB gets right. It also has no entry for many regional productions.
  Switching every show to one source would break more than it fixes.
- **TMDB's alternate orders (episode groups) cannot fix a merged two-parter.**
  A group only reorders TMDB's existing episode records, and a merged
  two-parter is a single record. Groups do help shows whose files follow a DVD
  or production order, when TMDB has that group.

## Decisions

| # | Decision |
|---|---|
| D1 | A show has a numbering source: `tmdb` (default), `tmdb_group` (one TMDB episode group) or `tvmaze`. |
| D2 | TMDB stays the source of everything else about the show: metadata, artwork, discovery, calendar, release dates. Only the episode list (numbers, titles, air dates) comes from the chosen source. |
| D3 | Episode rows stay keyed by `(media_id, season, episode)`. Switching source re-titles and re-dates rows by number, adds the source's missing numbers and removes rows the source does not have. Files are not moved or relinked, because they are already linked by number. |
| D4 | The episode sync deletes a row its source no longer lists, **only** if it has no file, no grab in flight and is not downloaded. This applies to every source, `tmdb` included. |
| D5 | A file whose name covers several episodes (`S09E23-E24`, `S01E01E02`) marks every covered episode downloaded. |
| D6 | TVDB is out of scope. Its API needs a subscription or a license, and TVmaze plus TMDB groups cover the cases found. |
| D7 | The switch is previewed before it is saved: the admin sees, per row, the title today and the title after. |
| D8 | Using TVmaze data shows its CC BY-SA attribution in Settings › About. |

## Sources

### TMDB (default)

Unchanged: `tv/{id}` for the season list, then `tv/{id}/season/{n}` per season.

### TMDB episode group

- `GET tv/{id}/episode_groups` lists the groups with `type`: 1 original air
  date, 2 absolute, 3 DVD, 4 digital, 5 story arc, 6 production, 7 TV.
- `GET tv/episode_group/{group_id}` returns `groups[]` (seasons) with
  `episodes[]` in order.
- A group's season number comes from its `order` field, and an episode's
  number is its `order + 1` within the group.
- Groups can mix in specials (season 0 records) to pad a season. Rows built
  from a season-0 record are skipped, and the preview says so.
- Each row keeps `tmdb_episode_id` from the group entry, so artwork and
  integrity checks still resolve.

### TVmaze

- Free, no API key. Data is CC BY-SA 4.0, which needs attribution (D8).
- Show lookup: `GET /lookup/shows?thetvdb={id}`, falling back to
  `?imdb={id}`, using TMDB's `tv/{id}/external_ids`. The endpoint answers with
  a redirect, so the client must follow it.
- Episodes: `GET /shows/{id}/episodes`. `season`, `number`, `name`, `airdate`
  and `runtime`. An entry with `number: null` is a special and is skipped.
- Rate limit: 20 calls per 10 seconds per IP. The sync paces itself, and a 429
  backs off and keeps the existing rows.
- `tmdb_episode_id` is set when a TVmaze episode matches a TMDB episode on the
  same air date and title. A part of a TMDB-merged two-parter keeps
  `tmdb_episode_id = null`.
- The TVmaze show id is stored on the show, so later syncs skip the lookup.

## Data model

```prisma
model LibraryMedia {
  // …
  /// Where episode numbers come from: "tmdb" | "tmdb_group" | "tvmaze".
  episodeSource    String  @default("tmdb") @map("episode_source")
  /// TMDB episode group id for tmdb_group, TVmaze show id for tvmaze.
  episodeSourceRef String? @map("episode_source_ref")
}

model LibraryEpisode {
  // …
  /// Set when another episode's file also holds this one (S09E23-E24).
  coveredByFileId Int?       @map("covered_by_file_id")
  coveredByFile   MediaFile? @relation("CoveredEpisodes", fields: [coveredByFileId], references: [id], onDelete: SetNull)
}
```

One migration: two columns on `library_media` (`episode_source` NOT NULL
DEFAULT `'tmdb'`) and one nullable FK on `library_episodes`. There is no
backfill: every show starts on `tmdb`, as today.

## Sync

`syncLibraryShowEpisodes(mediaId)` builds a source-neutral list and applies
it the same way for every source:

```ts
type SourceEpisode = {
  season: number;
  episode: number;
  title: string | null;
  airDate: Date | null;
  runtimeMinutes: number | null;
  tmdbEpisodeId: number | null;
};

async function loadEpisodes(media): Promise<SourceEpisode[]>; // tmdb | tmdb_group | tvmaze
async function applyEpisodes(mediaId, list: SourceEpisode[]): Promise<ApplyResult>;
```

`applyEpisodes`:

1. Upserts every listed `(season, episode)` with title, air date and
   `tmdb_episode_id`. This is the same upsert as today.
2. Deletes rows of the show whose number is not listed (D4). A row with a
   file, a grab in flight (`download_history` not completed or failed) or
   `status = downloaded` is kept and counted as `keptUnlisted`.
3. Returns `{ added, retitled, removed, keptUnlisted }`. The preview reuses it
   in dry-run mode.

If a source request fails, nothing is applied for that show on that run, and
the existing rows stay.

## Switching source

API, admin only:

- `GET /api/library/:id/episode-sources` lists the options. That is `tmdb`,
  each TMDB group with its name, type and episode count, and `tvmaze` when the
  lookup finds the show (with the TVmaze show id). An unavailable option comes
  with its reason, for example "not on TVmaze".
- `POST /api/library/:id/episode-source/preview` with `{ source, ref? }`
  returns the dry-run result plus one entry per changed row:
  `{ season, episode, fileName | null, titleNow, titleAfter, change }`.
  `change` is one of `retitle`, `add`, `remove`, `keep_unlisted`.
- `PUT /api/library/:id/episode-source` with `{ source, ref? }` saves it, runs
  the sync and then a rescan, so multi-episode files are re-linked.

Web, title page, admin ⋯ menu → **Edit details** → **Episode numbering**:

- A select with TMDB (default), each TMDB order and TVmaze.
- A preview table: the file on disk, the title today and the title after. Only
  changed rows are shown, with ✓ / ✗ when the file name's title matches. Below
  it, a count of each change type.
- A Save button. Rows that would be removed but are kept because they have a
  file are listed separately, so nothing disappears silently.

iOS shows the chosen source read-only in the title's details. Switching stays
on the web for now.

## Multi-episode files (D5)

- `parseReleaseStructure(name).episodes` already returns every number in
  `S09E23-E24`. Import (post-process and rescan discovery) links the file to
  the first episode as today. It sets `covered_by_file_id` and
  `status = downloaded` on the others.
- Rescan treats a covered episode like one with a valid file. When the
  covering file is gone, `covered_by_file_id` is nulled (FK SetNull), and the
  status reconcile puts the episode back to wanted.
- An upgrade of the first episode that replaces the file with a
  single-episode release drops the cover. The second episode becomes wanted
  again and is searched on its own, which is correct.
- The episode list and the title page show a covered episode as downloaded,
  with "in `S09E23-E24`" as its file.

## Other users of episode numbers

- **Search and grabs:** unchanged. They use row numbers, which now match the
  releases for a show on the right source.
- **Library integrity (`libraryIntegrityCollectors`):** the expected runtime
  comes from the source's runtime. It no longer comes from the TMDB episode
  when `tmdb_episode_id` is null or the source is not `tmdb`. Otherwise every
  part of a TMDB-merged two-parter would be flagged as too short.
- **Calendar and upcoming:** they read `library_episodes.air_date`, so they
  follow the chosen source automatically.

## Attribution (D8)

When any show uses TVmaze, Settings › About lists "Episode data for some shows
from TVmaze (CC BY-SA)" with a link.

## Testing

- `loadEpisodes` per source against recorded fixtures:
  - a show with a TMDB-merged two-parter;
  - a DVD-order group;
  - a group padded with specials;
  - TVmaze `number: null` specials;
  - a TVmaze 404 and a 429.
- `applyEpisodes`: re-title by number, add, remove a file-less unlisted row,
  keep an unlisted row that has a file, a grab in flight or `downloaded`, and
  dry-run equivalence.
- Multi-episode import: `S09E23-E24` covers E24, and deleting the file
  uncovers it. An upgrade with a single-episode release drops the cover.
- Integrity runtime: a TVmaze-sourced part is not flagged when the TMDB
  record is a merged double.
- Route tests: admin only, preview without writes, and save runs the sync
  then the rescan.

## Out of scope

- TVDB as a source (D6).
- Scene-numbering services (XEM).
- Anime absolute numbering. TMDB type-2 groups may cover it later through
  `tmdb_group`.
- Files that follow an order no source offers. They keep the current
  behaviour, and the admin can unmonitor the affected episodes.
- Switching source from iOS.
