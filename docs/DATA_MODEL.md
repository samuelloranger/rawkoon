# Data Model

Survey of the Prisma schema at `apps/api/prisma/schema.prisma`. Focuses on the key entities and how they connect; per-field detail is in the schema itself.

Last verified: 2026-06-15

## Overview

PostgreSQL 15 via Prisma. 27 models grouped into a few concerns:

- **Identity / auth** — `User`, Better Auth tables (`BaSession`, `BaAccount`, `BaVerification`, `BaPasskey`), `Invitation`, `OidcProvider`
- **Media library (replaces \*arr)** — `LibraryMedia`, `LibraryEpisode`, `MediaFile`, `DownloadHistory`, `GrabBlocklist`, `LibraryAttentionAlert`, `LibraryHealthLog`, `QualityProfile`, `CustomFormat`, `QualityProfileCustomFormat`, `MediaSettings`
- **Media planning** — `WatchlistItem`
- **Notifications / activity** — `Notification`, `NotificationChannel`, `UserSubscription`, `ActivityLog`, `TaskCompletion`
- **Integrations / ops** — `Integration`, `QbittorrentRequestLog`, `AppSettings`

Prisma columns are camelCase, mapped to snake_case DB column names with `@map`. All API responses re-map back to snake_case (see [CONVENTIONS.md](./CONVENTIONS.md#api-response-mapping-snake_case)).

## Singletons

Two singleton rows (id = 1) hold global config:

- **`AppSettings`** — app-wide UX defaults. Fields: `countryCode` (TMDB release-date region), `upcomingWindowMonths` (3/6/12/24), `upcomingLanguages` (comma-separated TMDB codes). Read via `GET /api/settings`, write via admin-only `PATCH /api/settings`. UI: Settings → General.
- **`MediaSettings`** — library / post-processing config. Fields: `moviesLibraryPath`, `showsLibraryPath`, `fileOperation` (hardlink/move/copy), `movieTemplate`, `episodeTemplate`, `minSeedRatio`, `postProcessingEnabled`, `defaultQualityProfileId`, `activeIndexerManager` (`prowlarr` or `jackett`).

Why singletons: there's exactly one Rawkoon instance per deployment; modeling as a table (with a fixed id) lets Prisma migrations evolve the shape and gives admins atomic `PATCH` semantics.

## Media Library (the "\*arr replacement")

`LibraryMedia` is the root entity — one row per movie or show (`type = "movie" | "show"`, keyed by `tmdbId`). Status drives the UI: `wanted | downloading | downloaded | skipped | returning | in_production | planned | upgrading`.

```
LibraryMedia ──┬── episodes:   LibraryEpisode[]          (TV only)
               ├── files:      MediaFile[]               (via mediaId or episodeId)
               ├── downloads:  DownloadHistory[]
               ├── blocklist:  GrabBlocklist[]
               ├── alerts:     LibraryAttentionAlert[]
               └── profile:    QualityProfile?
```

- **`LibraryEpisode`** belongs to a `LibraryMedia` (show). Unique on `(mediaId, season, episode)`. Carries the same wanted/downloading/downloaded state at episode level.
- **`MediaFile`** is the actual file on disk (after post-processing). Linked to either `mediaId` (movie) or `episodeId` (TV episode), with MediaInfo-derived fields (codec, bitrate, HDR, resolution, etc.) — see `apps/api/src/utils/medias/mediainfoParser.ts`.
- **`DownloadHistory`** records every grab attempt (release title, indexer, torrent hash, success/fail, post-process result). `postProcessDestinationPath` is the final library path; `postProcessError` is set when the file completes but post-processing failed.
- **`GrabBlocklist`** prevents re-grabbing a known-bad release (by torrent hash + release title).
- **`LibraryAttentionAlert`** — open alerts created hourly by `syncLibraryAttentionAlerts.ts` when grab/download conditions need user action. One open row per `(media, scope, kind)` to dedupe.
- **`QualityProfile`** — user-defined quality tier (resolution + source preferences). `MediaSettings.defaultQualityProfileId` points to the default; `LibraryMedia.qualityProfileId` is the per-item override.

## Calendar

There is no calendar-specific model. The calendar page is a read-only view of upcoming library releases (`LibraryMedia` / `LibraryEpisode` release dates), served by `GET /api/dashboard/upcoming`.

## Notifications

- **`Notification`** — in-app notifications visible in the bell menu.
- **`UserSubscription`** — Web Push subscription, one per browser/device. `subscriptionInfo` is the raw `PushSubscription` JSON; `endpoint` is also stored standalone for fast lookup.
- **`NotificationChannel`** — per-user delivery channel configuration.

## Auth (Better Auth)

`User` + `BaSession` + `BaAccount` + `BaVerification` + `BaPasskey`. Better Auth owns these tables but Rawkoon adds fields to `User`: `firstName`, `lastName`, `isAdmin`, `locale`, `avatarUrl`, `dashboardConfig`. `Invitation` covers the admin-issued invite flow (see `apps/api/src/auth.ts`).

`OidcProvider` rows configure generic OIDC providers loaded into Better Auth at startup (`apps/api/src/lib/auth.ts:loadOidcProviders`). Client secrets are encrypted at rest.

## Integrations

`Integration` is a generic key-value table keyed by `type` (e.g. `qbittorrent`, `tmdb`, `prowlarr`, `jackett`, `jellyfin`, `plex`, `local-ai`, trackers). `config` is JSON. Sensitive fields inside `config` are encrypted via `apps/api/src/services/crypto.ts`.

## Activity / Logs

- **`ActivityLog`** — append-only structured log of user-driven actions (e.g. `library:grab`, `media_grab`). Powers the dashboard activity feed. See `apps/api/src/utils/activityLogs.ts:logActivity`.
- **`TaskCompletion`** — per-user completion record across task types; powers stats widgets.
- **`QbittorrentRequestLog`** — captured qBittorrent HTTP requests/responses for debugging integration issues.
- **`LibraryHealthLog`** — periodic health snapshots from the library integrity checker (weekly cron Sunday 03:00).
