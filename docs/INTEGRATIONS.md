# Integrations

How Rawkoon talks to third-party services. Each integration follows the same shape: a row in the `Integration` table (type-keyed, encrypted secrets), a route plugin under `apps/api/src/routes/integrations/<name>/`, and a service module under `apps/api/src/services/`.

Last verified: 2026-06-14

## Pattern

The generic `Integration` model (`apps/api/prisma/schema.prisma:230`) stores `type` (unique), `enabled`, and a JSON `config` blob. Secrets inside `config` are encrypted via `apps/api/src/services/crypto.ts` (`encrypt` / `decrypt`). Config is read through a per-service helper (e.g. `getQbittorrentIntegrationConfig()`) that caches the decrypted view; admin updates call `invalidate*IntegrationConfigCache()`.

Settings → Integrations UI in the web app uses `useIntegrations()` and the per-service hooks (`useQbittorrentIntegration`, `useTmdbIntegration`, etc., all in `apps/web/src/pages/settings/`).

## qBittorrent

Rawkoon's torrent client of record. The library grab/post-process pipeline depends on it.

- **Code**: `apps/api/src/services/qbittorrent/` (`clientFetch.ts`, `clientSession.ts`, `torrentAdd.ts`, `torrentMutations.ts`, `torrentQueries.ts`, `config.ts`), `apps/api/src/routes/integrations/qbittorrent/`.
- **SSE**: download speed and torrent list use `createJsonSseResponse()` (`apps/api/src/utils/sse.ts`); endpoints under `apps/api/src/routes/dashboard/downloads/`.
- **Webhooks (inbound)**: `POST /api/webhooks/qbittorrent/added` and `/completed`. Auto-configured by the "Configure Webhooks" button in Settings, which writes a `curl … ?hash=%I` command into qBittorrent's "Run external program" hooks with a shared bearer secret (`apps/api/src/routes/webhooks/index.ts:42-180`).
- **Config**: stored URL + credentials, plus `webhook_secret` and category names (`rawkoon-movies`, `rawkoon-shows` from `apps/api/src/constants/libraryGrab.ts`).
- **Why a webhook + ?hash=%I**: qBittorrent natively supports running an external program on torrent add/finish, but has no native HTTP hook. Spawning `curl` keeps the integration zero-dependency on the qBittorrent side and routes the `info-hash` substitution through a query param.

## TMDB

Media discovery + metadata source for the library.

- **Code**: `apps/api/src/utils/medias/tmdbFetcher*.ts` (split across `Core`, `Details`, `Endpoints`, `Types`), `apps/api/src/utils/medias/tmdbRegion.ts`.
- **Routes**: `apps/api/src/routes/medias/tmdb/` powers TMDB-backed search and trending in the web app. `apps/api/src/routes/integrations/tmdb/` exposes admin-only test/config endpoints.
- **Env**: `TMDB_API_KEY` (free at themoviedb.org/settings/api). Optional `OMDB_API_KEY` for IMDb ratings overlay.
- **Cron**: `REFRESH_UPCOMING` (every 12h at :30) refreshes the dashboard upcoming-releases widget for the country/languages set in `AppSettings`.

## Radarr / Sonarr — Migration Only

Rawkoon **replaces** Radarr/Sonarr; it does not wrap them at runtime. The only Radarr/Sonarr code paths are:

1. **One-time importer** — Settings → Library import runs `apps/api/src/services/jobs/libraryMigrate{Radarr,Sonarr}.ts` to pull metadata, files, and MediaInfo into `LibraryMedia` / `MediaFile`. The job runs on the `library-migrate` queue (concurrency 1). Endpoints in `apps/api/src/routes/library/libraryJobWorkerRoutes.ts` (`POST /api/library/migrate`, `GET /api/library/migrate/status`).
2. **Filename conventions** — `apps/api/src/utils/medias/filenameParser.ts` / `releaseTitleParser.ts` recognize Radarr/Sonarr-formatted release filenames during downloads import.

See [DECISIONS.md](./DECISIONS.md) for the rationale.

Optional env for the importer: `MEDIA_PATH_FROM` / `MEDIA_PATH_TO` — remap `*arr`-internal paths to your container's mount path (e.g. `/data/Movies` → `/mnt/storage/Movies`).

## Indexers (Prowlarr / Jackett)

Used by the library grab pipeline to search torrent indexers.

- **Code**: `apps/api/src/services/indexerManager/` — strategy interface with `prowlarrAdapter.ts` and `jackettAdapter.ts`. `MediaSettings.activeIndexerManager` selects which one is active.
- **Routes**: `apps/api/src/routes/integrations/prowlarr/`, `.../jackett/`.
- **Cron**: `POLL_INDEXER_RSS` every 15 min (`apps/api/src/workers/pollIndexerRss.ts`) ingests RSS feeds for "wanted" items.

## Jellyfin

Powers the dashboard "latest media" widget.

- **Code**: `apps/api/src/routes/integrations/jellyfin/`, `apps/api/src/services/jellyfinLibraryRefresh.ts`.
- **Routes**: dashboard endpoints under `apps/api/src/routes/dashboard/jellyfin/`.
- **Config**: URL + API key in the `jellyfin` Integration row.

## OIDC

Generic OAuth/OIDC providers configured via Settings (stored in `OidcProvider`).

- **Code**: `apps/api/src/routes/integrations/oidc/`, `apps/api/src/lib/auth.ts:loadOidcProviders` + `refreshOidcProviders()`.
- Better Auth loads enabled providers at startup; admin edits trigger `refreshOidcProviders()` to update without a restart.

## Notifications Out

- **Web Push (VAPID)** — `apps/api/src/utils/webpush.ts` loads keys from `vapid_keys/` files or `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` env vars; uses `VAPID_CONTACT_EMAIL` as the contact identity. Subscriptions persisted on `UserSubscription`. Notifications are delivered in-app (bell menu) and via push; there is no outbound third-party webhook dispatcher.

## Webhook Inbounds

- **qBittorrent only** — `POST /api/webhooks/qbittorrent/added` and `/completed` (see the qBittorrent section above). There is no generic `:serviceName` webhook dispatcher; inbound webhooks from other services (Jellyfin/Plex/Prowlarr/cross-seed) are not handled.
