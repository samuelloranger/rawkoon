# Library (Media)

The heart of Rawkoon's "\*arr replacement": movie + TV library with TMDB discovery, indexer search, quality profiles, grab pipeline, post-processing, and attention alerts.

Last verified: 2026-05-25

See [DECISIONS.md ADR-001](../DECISIONS.md#adr-001-replace-radarrsonarr-with-a-built-in-media-library) for the rationale.

## Locations

| Layer        | Path                                                                |
| ------------ | ------------------------------------------------------------------- |
| Web (browse) | `apps/web/src/pages/library/` (`index.tsx`, `$libraryId.tsx`, `downloads.tsx`) |
| Web (discover) | `apps/web/src/pages/medias/`, `apps/web/src/pages/watchlist/`, `apps/web/src/pages/explore/` |
| Web hooks    | `apps/web/src/hooks/medias/`                                        |
| API (library)| `apps/api/src/routes/library/`                                      |
| API (discover)| `apps/api/src/routes/medias/` (TMDB-backed search, collections, watchlist, blocklist) |
| API (admin)  | `apps/api/src/routes/library/libraryMediaAdmin.ts`                  |
| API (downloads import) | `apps/api/src/routes/library/downloads/`                  |
| API (quality)| `apps/api/src/routes/quality-profiles/`                             |
| Services     | `apps/api/src/services/library*.ts`, `apps/api/src/services/media*.ts`, `apps/api/src/services/postProcessor*.ts`, `apps/api/src/services/indexerManager/` |
| Schema       | `LibraryMedia`, `LibraryEpisode`, `MediaFile`, `DownloadHistory`, `GrabBlocklist`, `LibraryAttentionAlert`, `LibraryHealthLog`, `QualityProfile`, `MediaSettings` |

## API Route Composition

`apps/api/src/routes/library/index.ts` is a thin orchestrator at prefix `/api/library`:

- `libraryListRoutes` — `GET /`, `POST /` (add by TMDB ID), `DELETE /:id`, `GET /item/:id`
- `libraryMetaRoutes` — status, monitored, quality profile, seasons/episodes meta
- `libraryGrabRoutes` — grab orchestration: `POST /:id/grab`, search, episodes search, seasons search, upgrade
- `libraryFilesRoutes` — file listing, rescan, file deletion
- `libraryJobRoutes` — composes attention alerts, stats, worker job admin routes

Plus, top-level: `libraryRoutes` (above), `libraryMediaAdminRoutes` (admin tooling), `libraryDownloadsRoutes` (`/api/library/downloads` — imports from a configured downloads dir, admin-only), `qualityProfilesRoutes`.

## Grab Pipeline

The end-to-end flow when a user grabs a release:

1. **Search** — `mediaGrabberSearch.ts` queries the active indexer manager (Prowlarr or Jackett, per `MediaSettings.activeIndexerManager`).
2. **Score** — `apps/api/src/utils/medias/releaseScorer.ts` ranks results against the item's `QualityProfile`.
3. **Grab** — `mediaGrabberGrab.ts` sends the chosen release to qBittorrent under the `rawkoon-movies` or `rawkoon-shows` category (constants from `apps/api/src/constants/libraryGrab.ts`).
4. **DownloadHistory** — a row is created with `releaseTitle`, `torrentHash`, `indexer`, `qualityParsed`, `grabbedAt`. The library item's `status` flips to `downloading`.
5. **Webhook** — qBittorrent's "torrent added" webhook (`POST /api/webhooks/qbittorrent/added`) confirms the grab landed by matching torrent hash → DownloadHistory.
6. **Completion** — qBittorrent's "torrent finished" webhook (`POST /api/webhooks/qbittorrent/completed`) sets `DownloadHistory.completedAt` and enqueues the post-processor.
7. **Post-process** — `postProcessorQueue.ts` + `postProcessorSingle.ts` / `postProcessorSeasonPack.ts` apply the file operation (`hardlink | move | copy` per `MediaSettings.fileOperation`), rendering the destination path from `MediaSettings.movieTemplate` / `episodeTemplate`. Result lands in `DownloadHistory.postProcessDestinationPath` or `postProcessError`.
8. **MediaInfo scan** — `apps/api/src/utils/medias/mediainfoScanner.ts` populates `MediaFile` fields (codec, bitrate, HDR, resolution).
9. **Status** — library item flips to `downloaded` (or `upgrading` if the grab was an upgrade per `upgradeDetection.ts`).

## Attention Alerts

`LibraryAttentionAlert` is the user-facing "something needs your attention" list (e.g. a movie has been "wanted" for 30 days with no grab, post-processing failed, a season pack is missing episodes). The `SYNC_LIBRARY_ATTENTION_ALERTS` cron (hourly at :12) scans library + download state and creates/resolves alerts. Code: `apps/api/src/services/libraryAttention*.ts`.

Why a dedicated table rather than ad-hoc computation: alerts persist across user sessions (dismissed, resolved, etc.) and the homepage needs a fast `count(status='open')` without re-running the whole heuristic.

## Crons (Library-Related)

From `apps/api/src/services/queueService.ts:setupScheduledJobs`:

| Job                                   | Pattern        | Purpose                                                       |
| ------------------------------------- | -------------- | ------------------------------------------------------------- |
| `REFRESH_UPCOMING`                    | `30 */12 * * *`| Dashboard upcoming-releases snapshot                          |
| `CHECK_MOVIE_RELEASE_REMINDERS`       | `20 * * * *`   | Hourly :20 — day-before reminder for watchlist movies         |
| `CHECK_LIBRARY_MOVIE_RELEASES`        | `0 */6 * * *`  | Refresh "out today" movies in library                         |
| `CHECK_LIBRARY_EPISODE_RELEASES`      | `0 */6 * * *`  | Refresh upcoming episodes for monitored shows                 |
| `SYNC_LIBRARY_SHOW_EPISODES`          | `0 */6 * * *`  | Sync TMDB episode lists into `LibraryEpisode`                 |
| `CHECK_LIBRARY_DOWNLOAD_COMPLETION`   | `*/30 * * * *` | Reconcile DownloadHistory against qBittorrent (catches missed webhooks) |
| `CHECK_LIBRARY_INTEGRITY`             | `0 3 * * 0`    | Weekly Sunday 03:00 — verify files on disk match `MediaFile`  |
| `POLL_INDEXER_RSS`                    | `*/15 * * * *` | Auto-grab from indexer RSS feeds for "wanted" items           |
| `UPGRADE_MEDIA_SEARCH`                | (event-driven) | Try to upgrade existing items to better quality               |
| `SYNC_LIBRARY_ATTENTION_ALERTS`       | `12 * * * *`   | Refresh attention alerts                                      |

## Migration from Radarr/Sonarr

One-time importer on the `library-migrate` BullMQ queue (concurrency 1). Code: `apps/api/src/services/jobs/libraryMigrate{Radarr,Sonarr}.ts`. Endpoints: `POST /api/library/migrate`, `GET /api/library/migrate/status` (`apps/api/src/routes/library/libraryJobWorkerRoutes.ts`). Optional `MEDIA_PATH_FROM` / `MEDIA_PATH_TO` env vars remap \*arr-internal paths.

## Web Discovery

`apps/web/src/pages/medias/` and `apps/web/src/pages/explore/` use TMDB-backed endpoints under `/api/medias/tmdb/` and `/api/medias/search/`. Adding an item to the library goes through `POST /api/library/` with a TMDB ID.

`apps/web/src/pages/watchlist/` shows monitored-but-unreleased items (`WatchlistItem`). The day-before notification (`CHECK_MOVIE_RELEASE_REMINDERS`) fires off this table.

## Downloads Import (Pre-existing Files)

`apps/api/src/routes/library/downloads/` (admin-only) scans configured downloads dirs and parses filenames via `apps/api/src/services/downloadsScanner.ts`. Users can assign a parsed file to a library item from the Downloads Import UI.
