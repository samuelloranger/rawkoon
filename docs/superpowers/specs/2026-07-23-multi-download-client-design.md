# Multi Download-Client Support — Design Spec

**Date:** 2026-07-23
**Status:** Approved design, ready for implementation planning
**Repo:** rawkoon

## Summary

Rawkoon currently integrates with a single external download client, qBittorrent,
via a hardwired service layer (`apps/api/src/services/qbittorrent/`). This spec
generalizes that into a **download-client adapter layer** that supports
**qBittorrent, Transmission, and Deluge**, with a single active client selectable
by the user.

The project deliberately stays a **media *manager*** (Sonarr/Radarr model): it
integrates with the user's chosen download client rather than embedding a torrent
engine. Embedding an engine (webtorrent / aria2 / libtorrent) was considered and
**rejected** — it changes how the project reads legally and reputationally, and
adds engine-reliability burden, for no user-facing benefit over integration.

## Goals

- Support three download clients behind one normalized interface: qBittorrent
  (existing), Transmission (new), Deluge (new).
- Single active client for v1. Multiple simultaneous clients (Sonarr-style
  priority/routing) is an explicit **later layer** — the data model and interface
  must not preclude it, but no routing logic is built now.
- Uniform, reliable completion detection via **polling** — no required per-client
  host-side scripting or webhook.
- Detect and handle **stalled** downloads instead of polling indefinitely.
- Zero reconfiguration for existing qBittorrent users (automatic migration).

## Non-Goals

- Embedding a torrent engine inside Rawkoon.
- Usenet / NZB / direct-HTTP downloads (BitTorrent only for now).
- Multiple simultaneous download clients / priority routing (later layer).
- Auto-fallback re-grab on stall (later layer — v1 marks failed + notifies).
- Per-client push accelerators (qBittorrent webhook, Deluge event-subscribe) —
  later optimizations layered on top of the polling backbone.

## Architecture

Mirror the existing `IndexerManagerAdapter` precedent
(`apps/api/src/services/indexerManager/` — `ProwlarrAdapter`, `JackettAdapter`).
Introduce a `DownloadClientAdapter` interface, three implementations, and a small
registry that resolves the one active client from config. All callers
(`mediaGrabberGrab`, the completion worker, `rescan`, dashboard downloads route)
depend only on the interface — never on a concrete client.

### Approaches considered

- **(chosen) Adapter interface + registry.** Consistent with the indexer layer,
  isolates per-client RPC quirks behind one normalized contract, unit-testable per
  adapter.
- **Rejected — leave qBittorrent hardwired, branch per client at call sites.**
  Scatters client logic across the codebase; does not scale to the later
  multi-client layer.
- **Rejected — generalized "any HTTP client" plugin config.** Over-engineered for
  three known clients; YAGNI.

### Interface (normalized contract)

```ts
type DownloadClientType = "qbittorrent" | "transmission" | "deluge";

interface DownloadClientAdapter {
  readonly type: DownloadClientType;

  testConnection(): Promise<{ ok: boolean; error?: string }>;

  addTorrent(input: {
    magnetOrUrl?: string;
    fileBuffer?: Uint8Array;
    tag: string;           // e.g. "rawkoon-dh-123"
    savePath?: string;
  }): Promise<{ hash: string }>;

  listTorrents(): Promise<NormalizedTorrent[]>;      // used by the poll worker
  getTorrent(hash: string): Promise<NormalizedTorrent | null>;

  pause(hash: string): Promise<void>;
  resume(hash: string): Promise<void>;
  remove(hash: string, deleteData: boolean): Promise<void>;
}

type NormalizedState =
  | "downloading"
  | "completed"
  | "stalled"
  | "error"
  | "paused";

interface NormalizedTorrent {
  hash: string;
  name: string;
  state: NormalizedState;
  progress: number;        // 0..1
  savePath: string;
  contentPath: string;     // absolute path to the downloaded content
  seeds: number;
  peers: number;
  dlSpeed: number;         // bytes/s
  sizeBytes: number;
}
```

Each client's raw states map into `NormalizedState` inside its adapter
(e.g. qBittorrent `stalledDL` → `stalled`, `uploading`/`stalledUP`/`pausedUP` →
`completed`; Deluge `Seeding` → `completed`, `Downloading` → `downloading`;
Transmission status codes → the enum). **All reconcile/completion/stall logic reads
only normalized fields** and is therefore client-agnostic.

## Config & Data Model

Generalize today's single `qbittorrent` integration record into one
**`download-client`** integration record, discriminated by `client_type`.

### Shared type (replaces `QbittorrentIntegration`)

```ts
interface DownloadClientIntegration {
  type: "download-client";
  enabled: boolean;
  client_type: DownloadClientType;
  website_url: string;     // qb WebUI / transmission rpc / deluge web
  username: string;        // deluge: unused/blank
  password_set: boolean;   // secret stored encrypted, never returned
  label: string;           // default "rawkoon" — the tag/category/label
  save_path?: string;      // optional download-dir override
}
```

### Connection model per client

All fold into `url + username? + password`:

- **qBittorrent** — WebUI url + user + pass. Cookie session (existing
  `clientSession` logic).
- **Transmission** — RPC url (`/transmission/rpc`) + user + pass. HTTP basic auth +
  `X-Transmission-Session-Id` 409 handshake (fetch id on 409, retry).
- **Deluge** — Web url (`/json`) + password only (username blank). `auth.login`
  then core methods; re-auth on session drop.

### Label / tag unification

Today's `rawkoon-dh-${id}` tag generalizes to the client's native label mechanism
(qBittorrent tag, Transmission label, Deluge label). The completion worker matches
pending downloads to client torrents by `torrentHash` first, falling back to this
label — the existing logic in `reconcilePendingDownloads`, now client-agnostic.

### Migration

One-time DB migration: existing `qbittorrent` integration row → `download-client`
row with `client_type = "qbittorrent"`, carrying url / username / encrypted secret.
Existing users need zero reconfiguration.

The retired webhook fields (`rawkoon_base_url`, `webhook_secret`) are dropped (see
Completion Detection). Called out in release notes.

### Secrets

Unchanged handling: secret encrypted at rest, `password_set` boolean exposed to the
UI, plaintext never returned — identical to current qBittorrent behavior.

## Completion Detection

**Polling is the backbone** — the only mechanism uniform and reliable across all
three clients (Transmission and Deluge have no clean built-in HTTP callback;
per-client push is fragile host-side config). This matches how Sonarr/Radarr detect
completion across their many supported clients.

The required qBittorrent **webhook is retired**. Per-client push accelerators
(qBittorrent run-on-complete, Deluge `TorrentFinishedEvent` subscription) may be
added later as pure optimizations on top of polling — they are not required for
correctness.

### Poll worker (generalizes `checkDownloadCompletion`)

- Each cycle: resolve active adapter → `adapter.listTorrents()` **once** → reconcile
  all pending `downloadHistory` rows in memory against the returned list.
- **Adaptive cadence:**
  - ≥1 pending download *progressing* → **fast tier** (configurable, default 20s).
  - Otherwise → **slow tier** (configurable, default 30min — today's safety-net
    interval).
  - Self-limiting: a stalled torrent does not hold the system at the fast tier.

### Per-download reconcile (per cycle, normalized fields only)

Match by `torrentHash`, fallback by `label` tag (existing behavior).

- `state === "completed"` **or** `progress >= 1` →
  `completeDownloadByHash` → `enqueueLibraryPostProcess` (unchanged post-processor;
  hardlink/move into library).
- `state === "error"` → mark failed + revert library status + notify.
- **Stall tracking:** track `lastProgressAt` + last progress value per download.
  - progress advanced since last cycle → update `lastProgressAt` (a large file with
    few seeds is *slow but progressing* and must NOT be killed).
  - `state === "stalled"` / no progress **and**
    `now - lastProgressAt > stallTimeout` (configurable, default 45min) →
    mark failed, `failReason: "stalled - no progress"`, revert library, **notify**.
    No auto-fallback (v1 decision).
- **Global max age:** `now - createdAt > maxAge` (configurable, default 7d) →
  mark failed + notify, regardless of progress state (absolute ceiling).
- **Missing from client** (deleted out-of-band) → existing `treatMissingAsFailed`
  path.

### Post-processing

Completely unchanged. The adapter surfaces `contentPath`; downstream
assign / hardlink / move logic (`downloadsAssign`, post-processors) is untouched.

## Error Handling

- **Adapter isolation.** Each adapter owns its RPC and auth/session handshake
  (qBittorrent cookie retry — exists; Transmission 409 → re-fetch
  `X-Transmission-Session-Id`; Deluge re-`auth.login` on session drop). Failures
  surface as a normalized `DownloadClientError`.
- **Connection test.** `testConnection()` backs the settings "Test" button with
  clear per-client messages (auth failed / unreachable / wrong endpoint).
- **Poll cycle resilience.** A failed `listTorrents()` cycle logs and returns
  without crashing; retried next cycle (matches current `fetchMaindata` try/catch).
- **addTorrent failure.** Grab marks `downloadHistory` failed + notifies; library
  reverts. No orphan "downloading" state.
- **SSRF.** Client URLs are user-supplied; outbound requests route through the
  existing `safeFetch` / `ssrf` guard.
- **Request logging.** Generalize `qbittorrentRequestLogs` →
  `downloadClientRequestLogs`, preserving the per-client debug/observability that
  exists today.

## Testing

- **Per-adapter unit tests** (highest-risk area — cover all three). Mock RPC
  responses using real qBittorrent / Transmission / Deluge payload fixtures; assert
  state-normalization mapping (raw states → `NormalizedState`) and the `addTorrent`
  request shape.
- **Reconcile logic tests.** Feed `NormalizedTorrent[]` and assert transitions:
  complete, stall-fail, max-age-fail, missing. Client-agnostic; no live client.
  Extends existing `completeDownloadByHash` / reconcile tests.
- **Adaptive cadence test.** Pending-progressing → fast tier; idle → slow tier.
- **Migration test.** Old `qbittorrent` row → `download-client` row with secret
  preserved.
- **Existing qBittorrent tests** refactored behind the interface — regression guard
  that the refactor preserves current behavior.

## Affected Areas (non-exhaustive)

- `apps/api/src/services/qbittorrent/` → refactor into
  `apps/api/src/services/downloadClient/` with `qbittorrentAdapter`,
  `transmissionAdapter`, `delugeAdapter`, a registry, and shared normalized types.
- `apps/api/src/workers/checkDownloadCompletion.ts` → generalized poll +
  reconcile + adaptive cadence + stall/max-age logic.
- `apps/api/src/services/mediaGrabberGrab.ts` → add via adapter registry.
- `apps/api/src/services/library/rescan.ts` → reconcile via adapter.
- `apps/api/src/routes/integrations/` (+ `qbittorrent/`) → `download-client`
  routes with `client_type`.
- `apps/api/src/routes/webhooks/` → remove qBittorrent webhook route.
- `apps/shared/src/types/integrations.ts` → `DownloadClientIntegration` replaces
  `QbittorrentIntegration`.
- `apps/web/src/pages/settings/` → download-client settings section with a client
  type selector (retire `useSetupQbittorrentAutorun` / webhook UI).
- DB migration for the integration record + dropped webhook fields.

## Open Later-Layer Items (out of scope, tracked for the future)

- Multiple simultaneous clients + priority routing.
- Auto-fallback re-grab on stall / failure.
- Per-client push accelerators (qBittorrent webhook, Deluge events).
- Additional clients via the same interface, in rough priority order (all are
  supported by Sonarr/Radarr and controllable over HTTP/RPC, so each is a new
  `create*Adapter` + state normalizer, no interface change):
  1. **rTorrent / ruTorrent** — XML-RPC (or SCGI); the seedbox default.
  2. **Download Station** (Synology / QNAP) — HTTP API; the NAS crowd.
  3. **Aria2** — JSON-RPC; easiest to implement (clean protocol).
  4. **Flood** — REST API; modern web UI fronting rTorrent/qBittorrent.
  5. **uTorrent** — legacy Web API; long tail but still requested.

  Clients explicitly NOT planned: Vuze, Hadouken, Freebox, Torrent Blackhole,
  and all Usenet clients (BitTorrent-only scope).
