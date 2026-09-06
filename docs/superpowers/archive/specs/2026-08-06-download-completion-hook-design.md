> Shipped in #19.

# Event-driven download completion — design

**Date:** 2026-08-06

**Status:** Approved design, ready for implementation planning

**Goal:** Let the download client tell Rawkoon a torrent finished, so Rawkoon stops polling to find out.

**Related:** the "Torrent integration possibilities" research that preceded this
(never committed to this repo, so deliberately not linked — a dead link fails
the docs build). This design implements only the narrow completion-notification
slice of that research and none of its larger phases.

## Problem

Two separate defects, discovered together.

### 1. Every qBittorrent list is a full snapshot

`apps/api/src/services/qbittorrent/clientFetch.ts` already implements complete
revision-based incremental sync against `/api/v2/sync/maindata?rid=<n>`: it
handles `full_update`, merges per-torrent deltas, applies `torrents_removed`,
and accumulates `server_state`.

None of it takes effect. `apps/api/src/services/downloadClient/qbittorrentAdapter.ts:101`
calls `resetMaindataState()` at the top of every `listTorrents()`, discarding the
revision cursor. Each call therefore issues `rid=0` and receives the entire
torrent list.

The line has been present since the multi-client adapter was introduced
(`9b2576e`, "Support qBittorrent, Transmission, and Deluge download clients").
It was not added to fix a stale-state bug, so removing it does not reintroduce one.

`getTorrent()` (line 106) compounds this: it calls `listTorrents()` and
normalizes the whole map to find a single hash.

### 2. Completion is discovered by polling

`apps/api/src/workers/checkDownloadCompletion.ts` polls the client every
`downloadPollActiveSecs` (default 20) while any `DownloadHistory` row is pending.

The polling is already adaptive and better than it first appears:

- zero pending rows sleeps `downloadPollIdleSecs` (default 1800) and never
  contacts the client;
- a newly-appeared pending row wakes the loop immediately, bypassing the timer;
- `computeNextPollDelaySecs` plus `idlePasses` backs off when nothing is active.

The `*/20 * * * * *` cron entry in `queueService.ts:242` is only a tick — the real
cadence gate is `pollState.nextPollAtMs`. So the waste is not constant; it is one
request every 20 seconds *while a download is in flight*, and completion latency
is up to 20 seconds.

## Approach

The client already knows the moment a torrent finishes. qBittorrent, Transmission,
and Deluge can each run a command on completion. Have that command call Rawkoon.

Two decisions shape everything below.

**The hook is a wake signal, not an event.** The endpoint does not mark anything
complete. It asks the existing reconcile loop to run *now*. Reconcile then
confirms against the client that the torrent really finished, exactly as it does
on a timer today.

Rationale: completion triggers file moves and library imports. Doing that because
*someone POSTed a hash* is a materially larger bet than doing it because
*qBittorrent reports progress 1.0* — and the token lives in a config file inside
a container Rawkoon does not control. Wake-signal semantics also mean replays and
duplicates are inherently no-ops, and require no new transition code:
`reconcilePendingDownloads` already classifies complete/fail/stall/missing, and
`completeDownload` is already idempotent.

Cost is one delta request and roughly one second of latency instead of ~200ms.
Irrelevant for a file that took forty minutes.

**The timer never goes away.** Clients fire completion hooks only. They do not
reliably report errors. Failures, stalls, max-age expiry, and torrents vanishing
from the client stay entirely on the timer, so none of them can ever depend on
the hook working.

## Design

Four independent pieces. Each is shippable alone; none blocks another.

### Piece 1 — Preserve the qBittorrent revision cursor

Delete `resetMaindataState()` from `qbittorrentAdapter.ts:101`. That is the whole
fix; the merge logic at `clientFetch.ts:203-241` then does its job.

Narrow `getTorrent()` to fetch the projection, look up the one raw entry, and
normalize only that entry.

Observable semantics do not change. Callers already tolerate up to
`MAINDATA_REUSE_WINDOW_MS` (750ms) of staleness, and every call past that window
still contacts the client — it just sends a delta instead of receiving a full dump.

Correctness at the edges is already handled:

| Event | Behavior |
|---|---|
| qBittorrent restarts | Returns `full_update: true`; handled at `clientFetch.ts:203` |
| Rawkoon restarts | `maindataState` is null, so `rid=0` — a full snapshot, which is correct |
| Client config changes | `clientSession.ts:103` resets the cursor, which is correct and stays |

Memory is bounded by the client's torrent count, and `torrents_removed` prunes.

### Piece 2 — Hook endpoint

New file `apps/api/src/routes/integrations/downloadClient/hookRoutes.ts`, mounted
as its own top-level router in `src/index.ts`.

It must **not** be mounted under `integrationsRoutes`, which applies `requireUser`.
The caller is a container with no session. It carries its own strict per-IP rate
limit, independent of `globalRateLimit`.

```
POST /api/download-client/hook/complete?hash=<hex>
```

1. Constant-time compare `X-Rawkoon-Token` against the stored token. Mismatch → 401.
2. Validate `hash` is 40- or 64-hex. Otherwise → 400.
3. Stamp `downloadHookLastSeenAt = now`.
4. If a hash was supplied and no pending `DownloadHistory` row matches it → 202,
   no wake. This is the common case for the user's own unrelated torrents.
5. Otherwise request an immediate poll → 202.

The token check precedes all database work, so an unauthenticated flood costs one
decrypt rather than a query.

**How "request an immediate poll" works.** `pollState` is module-private
(`checkDownloadCompletion.ts:144`), so the route cannot reach it. Export a
`requestImmediatePoll()` from that module which sets `pollState.nextPollAtMs = 0`,
and have the route call it *before* enqueuing a one-off
`SCHEDULED_JOB_NAMES.CHECK_LIBRARY_DOWNLOAD_COMPLETION` job.

The ordering is load-bearing. `checkDownloadCompletion()` returns early at line
353 when `nowMs < pollState.nextPollAtMs`, so an ad-hoc job enqueued while the
timer gate is still closed would do nothing. Clearing the gate first is what makes
the hook take effect rather than silently no-op.

### Piece 3 — Self-tuning cadence

In `checkDownloadCompletion.ts` (around line 362), select the active interval
before calling `computeNextPollDelaySecs`:

```
hookRecent = downloadHookLastSeenAt && (now - downloadHookLastSeenAt) < 24h
activeSecs = hookRecent ? downloadPollActiveHookedSecs : downloadPollActiveSecs
```

No hook ever received, or a hook that has gone quiet for a day, yields 20s —
byte-identical to current behavior. This is the point of the design: a hook that
breaks silently inside someone else's container cannot make Rawkoon worse than it
is today.

Stall and max-age granularity are unaffected. 120-second resolution against a
2700-second stall timeout is noise.

### Piece 4 — Client configuration

**qBittorrent, automatic.** On connection test and on settings save, when the
client type is `qbittorrent` and `downloadHookAutoConfigure` is on:

1. `GET /api/v2/app/preferences`.
2. Inspect the existing autorun program.
   - Empty, or already contains our hook path → write ours via `setPreferences`,
     enabling autorun.
   - Non-empty and not ours → **never overwrite.** Return a warning; settings
     shows the manual command instead.

Our hook path in the command doubles as the ownership marker, so no separate
sentinel is needed and rewrites are idempotent.

The command is a plain argv with no shell metacharacters, because qBittorrent
parses it itself rather than invoking a shell:

```
curl -fsS -m 10 -X POST -H "X-Rawkoon-Token: <token>" "<base>/api/download-client/hook/complete?hash=%I"
```

**Deluge and Transmission, manual.** Settings generates copy-paste instructions.
Both mechanisms take a *path to an executable*, not an inline command — Deluge's
bundled Execute plugin and Transmission's `script-torrent-done-filename` — so the
UI provides the script body plus the two configuration steps.

| Client | Mechanism | Hash source |
|---|---|---|
| qBittorrent | Autorun on torrent finished | `%I` substitution |
| Deluge | Execute plugin, "Torrent Complete" | `$1` (Deluge's torrent id is the info hash) |
| Transmission | `script-torrent-done-filename` + `script-torrent-done-enabled` | `TR_TORRENT_HASH` env var |

If `curl` is absent from the client's image, the same request works with
`wget -qO- --post-data=''` plus `--header`. Document both.

### What each client gets

Only Piece 1 is qBittorrent-specific, because it is a bug rather than a missing
feature. Pieces 2, 3, and 4 are client-agnostic: `hookRoutes.ts` and
`checkDownloadCompletion.ts` never inspect the active client type.

| | qBittorrent | Transmission | Deluge |
|---|---|---|---|
| Hook wake (Piece 2) | Yes | Yes | Yes |
| 120s cadence when hooked (Piece 3) | Yes | Yes | Yes |
| Hook setup (Piece 4) | Automatic | Manual | Manual |
| Delta payloads (Piece 1) | Yes | No — see below | Not possible |
| Targeted `getTorrent` | Fixed here | Already correct | Already correct |

Transmission and Deluge therefore get the whole point of this work — completion
in about a second instead of up to twenty, and six times fewer requests while a
download is in flight. What they do not get is smaller request payloads.

**Why Transmission delta sync is not included.** Transmission's RPC does support
`torrent-get` with `ids: "recently-active"` plus a `removed` list. But
`reconcilePendingDownloads` runs `findPendingTorrent` against whatever
`listTorrents()` returns, and the no-match branch can reach
`failDownload(dh, "torrent missing from download client")` when
`treatMissingAsFailed` is set. Feeding it a partial list would make healthy
torrents look missing. Doing this safely requires an accumulating projection —
the same structure qBittorrent gets for free from `maindata`, but hand-built.
That is a worthwhile follow-up and explicitly not part of this design.

**Why Deluge delta sync is not possible.** `core.get_torrents_status` is a
full-state call with no revision or cursor concept. Restricting the returned
fields, which `STATUS_FIELDS` already does, is the only available lever.

### Data flow

```
torrent finishes
  └─ client runs: curl -fsS -m 10 -X POST -H "X-Rawkoon-Token: …" \
                    "$BASE/api/download-client/hook/complete?hash=%I"
       └─ hook route: auth → validate hash → stamp lastSeenAt → pending row for hash?
            ├─ no  → 202, done
            └─ yes → nextPollAtMs = 0, enqueue check job → 202
                 └─ reconcilePendingDownloads → listTorrents()   [one delta request]
                      └─ classify → completeDownloadByHash → enqueuePostProcess
```

The timer path is untouched and continues to own failures, stalls, max-age, and
missing torrents.

## Schema

One migration. Five columns on `MediaSettings`, alongside the existing
`downloadPoll*` fields.

| Column | Type | Default | Purpose |
|---|---|---|---|
| `downloadHookToken` | `String?` | null | Inbound auth secret. Generated lazily; encrypted at rest via `services/crypto`, matching the client-password pattern. 32 random bytes, base64url. |
| `downloadHookCallbackUrl` | `String?` | null | Base URL at which the *client* can reach Rawkoon. |
| `downloadHookAutoConfigure` | `Boolean` | `true` | Opt-out for qBittorrent auto-configuration. |
| `downloadHookLastSeenAt` | `DateTime?` | null | Last accepted hook. Drives cadence selection and the settings indicator. |
| `downloadPollActiveHookedSecs` | `Int` | `120` | Active cadence once a hook is proven. |

### Required user input Rawkoon cannot infer

`downloadHookCallbackUrl` has no sane default. Rawkoon cannot know what address
the *client's* container can reach it at — `http://rawkoon:3000`, a LAN IP, a
hostname behind a reverse proxy. Auto-configuration stays inert until this is
set, and the settings panel states why.

## Security

- Token comparison uses `timingSafeEqual`, with a length guard first — it throws
  on mismatched buffer lengths.
- `hash` is validated as hex and used only as a Prisma `where` value. It never
  enters a path or a shell.
- The hook performs no outbound fetch, so it adds no SSRF surface.
- **The token must travel in the `setPreferences` request *body*, never the query
  string.** Corrected after reading the logging code: no log site records a
  request body. Every call to `logQbittorrentRequest` captures method, pathname,
  `search`, status, duration, response size, and response-derived metrics only
  (`clientSession.ts:134,156,223,248`; `clientFetch.ts:100,117,149`). But
  `requestPath` is `${pathname}${search}` and `meta.query` is built from
  `url.searchParams` (`clientFetch.ts:33`), so a token in the query string *would*
  be persisted to `qbittorrent_request_logs`. qBittorrent's `setPreferences`
  accepts a `json=` form field, so the body is the natural place regardless.
  No redaction work is needed — only a guard test asserting the token never
  appears in a logged `requestPath` or `meta`.
- Rotation action in settings. Rotating re-runs auto-configuration so qBittorrent
  stays in sync.
- Accepted and documented: the token is visible in qBittorrent's Options →
  Downloads and in its on-disk config. This is precisely why the endpoint only
  *triggers a reconcile* — the worst outcome for a leaked token is making Rawkoon
  poll its own download client.

## Failure modes

| Situation | Behavior |
|---|---|
| Hook never configured | Identical to today: 20s active cadence |
| Hook configured, Rawkoon down when it fires | `curl` fails, hook lost. Timer still catches it, but at 120s rather than 20s, since the hook is still "recent". **The one case this design is slower than today.** |
| Hook fires twice | Second is a redundant reconcile pass — a no-op |
| Hash belongs to a torrent Rawkoon does not own | Skipped without a wake, but `lastSeenAt` is still stamped, so unrelated torrents still prove the hook is alive |
| Token rotated, client not updated | 401s; `lastSeenAt` goes stale; cadence self-heals to 20s after 24h. Logged as a warning. |
| User already uses `autorun_program` | Never overwritten. Warning plus manual command. |
| Callback URL wrong or unreachable | `curl -fsS` fails silently in the client. `lastSeenAt` stays null, cadence stays 20s, settings shows "no hook received yet". |

## Testing

Extending `apps/api/test/reconcilePendingDownloads.test.ts` and
`apps/api/test/downloadClientRoutes.test.ts`.

- **rid preserved:** two sequential `listTorrents()` calls request `rid=0` then
  `rid=N`; a delta patch and a `torrents_removed` entry are both reflected in the
  returned list.
- **`getTorrent`:** single-entry normalization returns what the whole-map path
  returned.
- **Hook route:** 401 on bad token; 400 on malformed hash; 202 without enqueue for
  an unknown hash; 202 with enqueue and stamp for a known hash.
- **Cadence:** hook recent → 120; hook stale → 20; never seen → 20.
- **Auto-configure:** empty program writes; our own program rewrites idempotently;
  a foreign program does not write and returns a warning.
- **Token containment:** a `setPreferences` request-log entry's `requestPath` and
  `meta` contain no token — it lives in the form body, which is never logged.

## Files touched

- `apps/api/prisma/schema.prisma` plus one migration
- `apps/api/src/services/downloadClient/qbittorrentAdapter.ts`
- `apps/api/src/services/qbittorrent/clientFetch.ts` (optional injected fetcher, for tests)
- `apps/api/src/services/qbittorrent/preferences.ts` (new)
- `apps/api/src/routes/integrations/downloadClient/hookRoutes.ts` (new)
- `apps/api/src/routes/integrations/downloadClient/index.ts`
- `apps/api/src/index.ts`
- `apps/api/src/workers/checkDownloadCompletion.ts`
- `apps/web` download-client settings panel
- `apps/web/src/locales/{en,fr}`

## Out of scope

- No SSE or WebSocket push from the API to the browser. The SPA keeps its current
  query polling. That is a separate concern and a separate design.
- No `rawkoon-torrent` service, no libtorrent-rasterbar, no librqbit, no fork of
  any client.
- No custom Deluge plugin — the bundled Execute plugin covers this need.
- No Transmission `recently-active` delta sync. It needs an accumulating
  projection to be safe against the `treatMissingAsFailed` path; tracked as a
  follow-up, not part of this design.
- No error or failure hooks. No client offers one reliably, so failures remain on
  the timer by design.
- No upload-speed dashboard work and no telemetry push. Progress and speed change
  continuously and must be sampled; only lifecycle transitions can be pushed.

## Verification note

The exact qBittorrent preference keys (expected `autorun_enabled` and
`autorun_program`) will be confirmed against a live `GET /api/v2/app/preferences`
during implementation rather than taken from the wiki. The naming shifted across
4.x and 5.x, and the response is self-documenting.
