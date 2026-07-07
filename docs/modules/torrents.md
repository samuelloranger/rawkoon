# Torrents (qBittorrent)

Real-time qBittorrent integration: torrent list, speed graph, basic mutations (pause/resume/delete), and the inbound webhook pipeline that drives the library grab lifecycle.

Last verified: 2026-05-25

## Locations

| Layer      | Path                                                                                                                                |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Web        | Dashboard widget under `apps/web/src/features/` + downloads pages                                                                   |
| API client | `apps/api/src/services/qbittorrent/` (`clientFetch`, `clientSession`, `torrentAdd`, `torrentMutations`, `torrentQueries`, `config`) |
| API routes | `apps/api/src/routes/integrations/qbittorrent/`, `apps/api/src/routes/dashboard/downloads/`                                         |
| Webhooks   | `apps/api/src/routes/webhooks/index.ts` (`/qbittorrent/added`, `/qbittorrent/completed`)                                            |
| Schema     | `Integration` (type=`qbittorrent`), `QbittorrentRequestLog`                                                                         |
| Constants  | `apps/api/src/constants/libraryGrab.ts` (category names)                                                                            |

## Config

`Integration` row of type `qbittorrent`. Config blob holds URL, username, encrypted password, `webhook_secret`, and category names. Accessed via cached helper `getQbittorrentIntegrationConfig()` (invalidated on admin edit through `invalidateQbittorrentIntegrationConfigCache()`).

## Client Session

`apps/api/src/services/qbittorrent/clientSession.ts` manages the qBittorrent Web API session cookie. `clientFetch.ts` exposes `qbFetchJson` and `qbFetchText` which auto-relogin on 403. All HTTP traffic to qBittorrent is logged into `QbittorrentRequestLog` for debugging — useful when an integration silently fails behind a VPN container.

## SSE

Download speed and torrent list endpoints under `apps/api/src/routes/dashboard/downloads/` use `createJsonSseResponse()` (`apps/api/src/utils/sse.ts`) with a 2s poll interval. Web consumers are in `apps/web/src/lib/realtime/`.

Why SSE not WebSocket: one-way data, no client backpressure needed, plays nicely with reverse proxies, and the `text/event-stream` content-type bypasses most buffering issues out of the box.

## Webhook Pipeline

qBittorrent natively supports "Run external program on torrent added/finished". The "Configure Webhooks" button in Settings auto-writes this command into qBittorrent:

```
/usr/bin/curl -s -X POST "<rawkoon-url>/api/webhooks/qbittorrent/completed?hash=%I" \
  -H "Authorization: Bearer <webhook_secret>"
```

`%I` is qBittorrent's substitution for the torrent info-hash. Routes verify the bearer with `timingSafeEqual` then call `completeDownloadByHash()` (`apps/api/src/workers/checkDownloadCompletion.ts`) which matches the hash to a `DownloadHistory` row and enqueues post-processing.

`resolveRawkoonInternalUrl()` (`apps/api/src/routes/integrations/qbittorrent/index.ts`) picks the URL qBittorrent uses to reach Rawkoon, with this priority:

1. Explicit override from the admin
2. Docker DNS lookup of `rawkoon` on `API_PORT` — works when qBittorrent (often in a VPN container via `network_mode: service:vpn`) shares the homelab network
3. `BASE_URL` as a last resort

Why prefer Docker DNS: qBittorrent traffic via `BASE_URL` would round-trip through your public URL → reverse proxy → back into Docker, which adds latency and can break under Cloudflare's request limits.
