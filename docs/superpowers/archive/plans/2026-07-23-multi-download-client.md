> Shipped in #11.

# Multi Download-Client Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Support qBittorrent, Transmission, and Deluge behind one normalized download-client adapter interface, with a single active client, polling-based completion detection, and stall handling.

**Architecture:** Introduce a `DownloadClientAdapter` interface mirroring the existing `IndexerManagerAdapter` pattern. Three adapters (qBittorrent wraps the current service; Transmission and Deluge are new) normalize each client's RPC into a shared `NormalizedTorrent`. A registry resolves the one active client from a generalized `download-client` integration record. The completion worker polls `adapter.listTorrents()` on an adaptive cadence and reconciles pending downloads on normalized fields only, with stall/max-age detection.

**Tech Stack:** Bun + TypeScript monorepo, Elysia API (`apps/api`), Prisma (PostgreSQL), React web (`apps/web`), shared types (`apps/shared`). Tests: `bun test`. Lint/format: Biome.

## Global Constraints

- BitTorrent only. No Usenet/NZB/HTTP-DDL.
- Single active download client for v1. Multiple simultaneous clients / priority routing is OUT OF SCOPE (later layer) — do not build routing logic, but do not hardcode assumptions that block it.
- Polling is the completion backbone. The qBittorrent webhook is RETIRED. Do not add per-client push mechanisms.
- On stall/max-age: mark `downloadHistory` failed + notify. NO auto-fallback re-grab (later layer).
- Secrets encrypted at rest via existing `encrypt`/`decrypt` (`@rawkoon/api/services/crypto`). Plaintext secrets NEVER returned to the web client; expose `password_set: boolean` only.
- User-supplied client URLs must go through the existing SSRF-safe fetch path where one exists; adapters otherwise use plain `fetch` to the configured URL exactly as the current qBittorrent client does (localhost/LAN RPC).
- Existing qBittorrent users must require ZERO reconfiguration — a data migration converts their record.
- Follow existing file conventions: services under `apps/api/src/services/`, one responsibility per file, kebab/camel naming as in neighbours.
- Default config values (settings columns): active poll interval `20` s, idle poll interval `1800` s, stall timeout `2700` s (45 min), max age `604800` s (7 days).

---

## File Structure

New directory `apps/api/src/services/downloadClient/`:

- `types.ts` — `DownloadClientType`, `NormalizedState`, `NormalizedTorrent`, `AddTorrentInput`, `DownloadClientAdapter` interface, `DownloadClientError`.
- `registry.ts` — `resolveActiveAdapter()` builds the adapter for the active `download-client` config.
- `config.ts` — `DownloadClientIntegrationConfig` type, `getDownloadClientIntegrationConfig()`, cache invalidation. Generalizes `qbittorrent/config.ts`.
- `qbittorrentAdapter.ts` — implements `DownloadClientAdapter`, wraps existing `qbittorrent/*` functions, normalizes state.
- `transmissionAdapter.ts` — new; Transmission RPC.
- `delugeAdapter.ts` — new; Deluge JSON-RPC.
- `stateNormalize.ts` — pure per-client raw-state → `NormalizedState` mappers (unit-tested in isolation).

Modified:

- `apps/shared/src/types/integrations.ts` — add `DownloadClientIntegration` (+ update response). Keep `QbittorrentIntegration` temporarily only if referenced; remove once web migrates (Task 11).
- `apps/api/src/services/mediaGrabberGrab.ts` — add via registry instead of `addQbittorrent*`.
- `apps/api/src/workers/checkDownloadCompletion.ts` — poll via adapter, reconcile on normalized fields, stall/max-age, adaptive cadence.
- `apps/api/src/services/jobs/scheduledTasksWorker.ts` — adaptive cadence scheduling.
- `apps/api/prisma/schema.prisma` + migration — new `MediaSettings` columns.
- `apps/api/src/routes/integrations/` — `download-client` routes (replaces `qbittorrent` route file).
- `apps/api/src/routes/webhooks/index.ts` — remove qBittorrent webhook route.
- `apps/web/src/pages/settings/` — download-client settings section + client type selector; remove `useSetupQbittorrentAutorun`.

Tests live beside existing API tests in `apps/api/test/` and `apps/api/src/__tests__/`.

---

## Task 1: Normalized types + adapter interface

**Files:**
- Create: `apps/api/src/services/downloadClient/types.ts`

**Interfaces:**
- Produces: `DownloadClientType`, `NormalizedState`, `NormalizedTorrent`, `AddTorrentInput`, `DownloadClientAdapter`, `DownloadClientError` — consumed by every later task.

- [ ] **Step 1: Write the type module (no test — pure type/interface declarations verified by typecheck)**

```ts
// apps/api/src/services/downloadClient/types.ts

export type DownloadClientType = "qbittorrent" | "transmission" | "deluge";

export type NormalizedState =
  | "downloading"
  | "completed"
  | "stalled"
  | "error"
  | "paused";

export interface NormalizedTorrent {
  hash: string;
  name: string;
  state: NormalizedState;
  /** 0..1 */
  progress: number;
  savePath: string;
  /** Absolute path to the downloaded top-level content, or null if unknown */
  contentPath: string | null;
  seeds: number;
  peers: number;
  /** bytes/s */
  dlSpeed: number;
  sizeBytes: number;
}

export interface AddTorrentInput {
  /** magnet: URI or http(s) .torrent URL */
  magnetOrUrl?: string;
  /** raw .torrent bytes (mutually exclusive with magnetOrUrl) */
  fileBuffer?: Uint8Array;
  fileName?: string;
  /** label/tag applied to the torrent, e.g. "rawkoon-dh-123" */
  tag: string;
  /** optional category, e.g. "rawkoon-movies" */
  category?: string;
  /** optional download-dir override */
  savePath?: string;
}

export interface DownloadClientAdapter {
  readonly type: DownloadClientType;
  testConnection(): Promise<{ ok: boolean; error?: string }>;
  /** Returns the info-hash if the client reports it on add, else null (matched later by tag). */
  addTorrent(input: AddTorrentInput): Promise<{ hash: string | null }>;
  listTorrents(): Promise<NormalizedTorrent[]>;
  getTorrent(hash: string): Promise<NormalizedTorrent | null>;
  pause(hash: string): Promise<void>;
  resume(hash: string): Promise<void>;
  remove(hash: string, deleteData: boolean): Promise<void>;
}

export class DownloadClientError extends Error {
  constructor(
    message: string,
    readonly clientType: DownloadClientType,
  ) {
    super(message);
    this.name = "DownloadClientError";
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `bun run --filter @rawkoon/api typecheck`
Expected: PASS (no errors).

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/services/downloadClient/types.ts
git commit -m "feat(downloads): add normalized download-client adapter types"
```

---

## Task 2: State normalization mappers

**Files:**
- Create: `apps/api/src/services/downloadClient/stateNormalize.ts`
- Test: `apps/api/test/downloadClientStateNormalize.test.ts`

**Interfaces:**
- Consumes: `NormalizedState` from Task 1.
- Produces: `normalizeQbState(raw: string): NormalizedState`, `normalizeTransmissionState(status: number, opts: { isStalled?: boolean; errorNo?: number; percentDone: number }): NormalizedState`, `normalizeDelugeState(raw: string): NormalizedState`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/test/downloadClientStateNormalize.test.ts
import { describe, expect, it } from "bun:test";
import {
  normalizeQbState,
  normalizeTransmissionState,
  normalizeDelugeState,
} from "@rawkoon/api/services/downloadClient/stateNormalize";

describe("normalizeQbState", () => {
  it("maps completed states", () => {
    for (const s of ["uploading", "pausedUP", "stoppedUP", "stalledUP", "queuedUP", "forcedUP"]) {
      expect(normalizeQbState(s)).toBe("completed");
    }
  });
  it("maps error states", () => {
    expect(normalizeQbState("error")).toBe("error");
    expect(normalizeQbState("missingFiles")).toBe("error");
  });
  it("maps stalled download", () => {
    expect(normalizeQbState("stalledDL")).toBe("stalled");
  });
  it("maps paused download", () => {
    expect(normalizeQbState("pausedDL")).toBe("paused");
    expect(normalizeQbState("stoppedDL")).toBe("paused");
  });
  it("defaults to downloading", () => {
    expect(normalizeQbState("downloading")).toBe("downloading");
    expect(normalizeQbState("metaDL")).toBe("downloading");
  });
});

describe("normalizeTransmissionState", () => {
  it("seeding/finished is completed", () => {
    expect(normalizeTransmissionState(6, { percentDone: 1 })).toBe("completed");
    expect(normalizeTransmissionState(5, { percentDone: 1 })).toBe("completed");
  });
  it("stopped with full progress is completed", () => {
    expect(normalizeTransmissionState(0, { percentDone: 1 })).toBe("completed");
  });
  it("stopped mid-download is paused", () => {
    expect(normalizeTransmissionState(0, { percentDone: 0.4 })).toBe("paused");
  });
  it("error field wins", () => {
    expect(normalizeTransmissionState(4, { percentDone: 0.2, errorNo: 3 })).toBe("error");
  });
  it("stalled flag maps to stalled", () => {
    expect(normalizeTransmissionState(4, { percentDone: 0.2, isStalled: true })).toBe("stalled");
  });
  it("downloading otherwise", () => {
    expect(normalizeTransmissionState(4, { percentDone: 0.2 })).toBe("downloading");
  });
});

describe("normalizeDelugeState", () => {
  it("seeding is completed", () => {
    expect(normalizeDelugeState("Seeding")).toBe("completed");
  });
  it("error is error", () => {
    expect(normalizeDelugeState("Error")).toBe("error");
  });
  it("paused is paused", () => {
    expect(normalizeDelugeState("Paused")).toBe("paused");
  });
  it("downloading/queued/checking are downloading", () => {
    expect(normalizeDelugeState("Downloading")).toBe("downloading");
    expect(normalizeDelugeState("Queued")).toBe("downloading");
    expect(normalizeDelugeState("Checking")).toBe("downloading");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test apps/api/test/downloadClientStateNormalize.test.ts`
Expected: FAIL — module not found / functions not defined.

- [ ] **Step 3: Write minimal implementation**

```ts
// apps/api/src/services/downloadClient/stateNormalize.ts
import type { NormalizedState } from "./types";

const QB_COMPLETED = new Set([
  "uploading",
  "pausedUP",
  "stoppedUP",
  "stalledUP",
  "queuedUP",
  "forcedUP",
]);
const QB_ERROR = new Set(["error", "missingFiles"]);
const QB_PAUSED = new Set(["pausedDL", "stoppedDL"]);

export function normalizeQbState(raw: string): NormalizedState {
  if (QB_COMPLETED.has(raw)) return "completed";
  if (QB_ERROR.has(raw)) return "error";
  if (raw === "stalledDL") return "stalled";
  if (QB_PAUSED.has(raw)) return "paused";
  return "downloading";
}

export function normalizeTransmissionState(
  status: number,
  opts: { isStalled?: boolean; errorNo?: number; percentDone: number },
): NormalizedState {
  if (opts.errorNo && opts.errorNo !== 0) return "error";
  // 5 = seed-wait, 6 = seeding; or complete + stopped
  if (status === 5 || status === 6) return "completed";
  if (status === 0) return opts.percentDone >= 1 ? "completed" : "paused";
  if (opts.percentDone >= 1) return "completed";
  if (opts.isStalled) return "stalled";
  return "downloading";
}

const DELUGE_COMPLETED = new Set(["Seeding"]);

export function normalizeDelugeState(raw: string): NormalizedState {
  if (DELUGE_COMPLETED.has(raw)) return "completed";
  if (raw === "Error") return "error";
  if (raw === "Paused") return "paused";
  // Deluge lacks a distinct stalled state; a 0-peer stall is inferred by the
  // reconcile layer via lastProgressAt, so map remaining states to downloading.
  return "downloading";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test apps/api/test/downloadClientStateNormalize.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/downloadClient/stateNormalize.ts apps/api/test/downloadClientStateNormalize.test.ts
git commit -m "feat(downloads): add per-client state normalizers"
```

---

## Task 3: Generalized download-client config + data migration

**Files:**
- Create: `apps/api/src/services/downloadClient/config.ts`
- Create migration: `apps/api/prisma/migrations/<timestamp>_download_client_integration/migration.sql`
- Modify: `apps/shared/src/types/integrations.ts`
- Test: `apps/api/test/downloadClientConfig.test.ts`

**Interfaces:**
- Consumes: `DownloadClientType` from Task 1; `encrypt`/`decrypt` from `@rawkoon/api/services/crypto`; `prisma` from `@rawkoon/api/db`; cache helpers from `@rawkoon/api/services/cache`.
- Produces: `DownloadClientIntegrationConfig` type; `getDownloadClientIntegrationConfig(): Promise<{ enabled: boolean; clientType: DownloadClientType | null; config: DownloadClientIntegrationConfig | null }>`; `invalidateDownloadClientIntegrationConfigCache()`; `normalizeDownloadClientConfig(raw, clientType)`. Shared type `DownloadClientIntegration`.

- [ ] **Step 1: Add the shared type**

In `apps/shared/src/types/integrations.ts`, add (leave `QbittorrentIntegration` in place for now; removed in Task 11):

```ts
export type DownloadClientType = "qbittorrent" | "transmission" | "deluge";

export interface DownloadClientIntegration {
  type: "download-client";
  enabled: boolean;
  client_type: DownloadClientType;
  website_url: string;
  username: string;
  password_set: boolean;
  label: string;
  save_path?: string;
}

export interface DownloadClientIntegrationUpdateResponse {
  success: boolean;
  integration: DownloadClientIntegration;
}
```

- [ ] **Step 2: Write the failing test**

```ts
// apps/api/test/downloadClientConfig.test.ts
import { describe, expect, it } from "bun:test";
import { normalizeDownloadClientConfig } from "@rawkoon/api/services/downloadClient/config";
import { encrypt } from "@rawkoon/api/services/crypto";

describe("normalizeDownloadClientConfig", () => {
  it("decrypts password and strips trailing slash", () => {
    const raw = {
      website_url: "http://localhost:8080/",
      username: "admin",
      password: encrypt("secret"),
      label: "rawkoon",
    };
    const cfg = normalizeDownloadClientConfig(raw, "qbittorrent");
    expect(cfg).toEqual({
      website_url: "http://localhost:8080",
      username: "admin",
      password: "secret",
      label: "rawkoon",
      save_path: undefined,
    });
  });

  it("returns null when required fields missing", () => {
    expect(normalizeDownloadClientConfig({ website_url: "x" }, "qbittorrent")).toBeNull();
  });

  it("allows blank username for deluge", () => {
    const raw = {
      website_url: "http://localhost:8112",
      username: "",
      password: encrypt("dpass"),
      label: "rawkoon",
    };
    const cfg = normalizeDownloadClientConfig(raw, "deluge");
    expect(cfg?.username).toBe("");
    expect(cfg?.password).toBe("dpass");
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `bun test apps/api/test/downloadClientConfig.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Write the implementation**

```ts
// apps/api/src/services/downloadClient/config.ts
import { prisma } from "@rawkoon/api/db";
import {
  getJsonCache,
  setJsonCache,
  deleteCache,
} from "@rawkoon/api/services/cache";
import { decrypt } from "@rawkoon/api/services/crypto";
import {
  toRecord,
  toStringOrNull,
} from "@rawkoon/api/services/qbittorrent/clientNormalizers";
import type { DownloadClientType } from "./types";

export interface DownloadClientIntegrationConfig {
  website_url: string;
  username: string;
  password: string;
  label: string;
  save_path?: string;
}

export const normalizeDownloadClientConfig = (
  config: unknown,
  clientType: DownloadClientType,
): DownloadClientIntegrationConfig | null => {
  const cfg = toRecord(config);
  if (!cfg) return null;

  const websiteUrl = toStringOrNull(cfg.website_url);
  const username = toStringOrNull(cfg.username) ?? "";
  let password = toStringOrNull(cfg.password);
  if (password) {
    try {
      password = decrypt(password);
    } catch (error) {
      console.error(
        `[download-client] failed to decrypt password — treating as unconfigured until re-saved: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      password = null;
    }
  }

  // Deluge authenticates with password only; username may be blank.
  const requiresUsername = clientType !== "deluge";
  if (!websiteUrl || !password) return null;
  if (requiresUsername && !username) return null;

  const label = toStringOrNull(cfg.label) ?? "rawkoon";
  const savePath = toStringOrNull(cfg.save_path) ?? undefined;

  return {
    website_url: websiteUrl.replace(/\/+$/, ""),
    username,
    password,
    label,
    save_path: savePath,
  };
};

const CACHE_KEY = "download-client:integration_config";
const CACHE_TTL_SECONDS = 86400;

const VALID_TYPES: DownloadClientType[] = [
  "qbittorrent",
  "transmission",
  "deluge",
];

const parseClientType = (raw: unknown): DownloadClientType | null => {
  const cfg = toRecord(raw);
  const t = cfg ? toStringOrNull(cfg.client_type) : null;
  return VALID_TYPES.includes(t as DownloadClientType)
    ? (t as DownloadClientType)
    : null;
};

export const getDownloadClientIntegrationConfig = async (): Promise<{
  enabled: boolean;
  clientType: DownloadClientType | null;
  config: DownloadClientIntegrationConfig | null;
}> => {
  const cached = await getJsonCache<{ enabled: boolean; config: unknown }>(
    CACHE_KEY,
  );
  const build = (enabled: boolean, rawConfig: unknown) => {
    const clientType = enabled ? parseClientType(rawConfig) : null;
    return {
      enabled,
      clientType,
      config:
        enabled && clientType
          ? normalizeDownloadClientConfig(rawConfig, clientType)
          : null,
    };
  };

  if (cached) return build(cached.enabled, cached.config);

  const integration = await prisma.integration.findFirst({
    where: { type: "download-client" },
    select: { enabled: true, config: true },
  });
  const enabled = integration?.enabled ?? false;
  const rawConfig = integration?.config ?? null;

  await setJsonCache(CACHE_KEY, { enabled, config: rawConfig }, CACHE_TTL_SECONDS);
  return build(enabled, rawConfig);
};

export const invalidateDownloadClientIntegrationConfigCache = async () => {
  await deleteCache(CACHE_KEY);
};
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test apps/api/test/downloadClientConfig.test.ts`
Expected: PASS.

- [ ] **Step 6: Write the data migration**

Create the migration directory + `migration.sql`. This converts an existing `qbittorrent` integration row into a `download-client` row and stamps `client_type` into the JSON config. `webhook_secret` / `rawkoon_base_url` keys are left in the JSON (harmless, ignored by the new normalizer).

```sql
-- apps/api/prisma/migrations/<timestamp>_download_client_integration/migration.sql
-- Convert the single qBittorrent integration into a generalized download-client record.
UPDATE "integrations"
SET
  "type" = 'download-client',
  "config" = COALESCE("config", '{}'::jsonb)
    || jsonb_build_object('client_type', 'qbittorrent')
    || CASE
         WHEN ("config" ->> 'label') IS NULL
         THEN jsonb_build_object('label', 'rawkoon')
         ELSE '{}'::jsonb
       END
WHERE "type" = 'qbittorrent';
```

> If `config` is stored as `json` (not `jsonb`), cast accordingly: `"config"::jsonb`. Verify the column type with `\d integrations` before finalizing; adjust the cast so the migration applies cleanly.

- [ ] **Step 7: Apply and verify the migration**

Run: `bun run db:migrate:dev`
Expected: migration applies; a previously-`qbittorrent` row now has `type = 'download-client'` and `config->>'client_type' = 'qbittorrent'`. Verify with `bun run db:studio` or a psql query.

- [ ] **Step 8: Typecheck + commit**

Run: `bun run --filter @rawkoon/api typecheck && bun run --filter @rawkoon/shared typecheck`
Expected: PASS.

```bash
git add apps/api/src/services/downloadClient/config.ts apps/shared/src/types/integrations.ts apps/api/prisma/migrations apps/api/test/downloadClientConfig.test.ts
git commit -m "feat(downloads): generalized download-client config + migration"
```

---

## Task 4: qBittorrent adapter (wraps existing service)

**Files:**
- Create: `apps/api/src/services/downloadClient/qbittorrentAdapter.ts`
- Test: `apps/api/test/qbittorrentAdapter.test.ts`

**Interfaces:**
- Consumes: `DownloadClientAdapter`, `NormalizedTorrent`, `AddTorrentInput` (Task 1); `normalizeQbState` (Task 2); `DownloadClientIntegrationConfig` (Task 3); existing `addQbittorrentMagnet`/`addQbittorrentTorrentFile` (`qbittorrent/torrentAdd`), `fetchMaindata` (`qbittorrent/clientFetch`), `pauseQbittorrentTorrent`/`resumeQbittorrentTorrent`/`deleteQbittorrentTorrent` (`qbittorrent/torrentMutations`).
- Produces: `createQbittorrentAdapter(config: QbittorrentIntegrationConfig): DownloadClientAdapter`.

Note: the qBittorrent `torrents/add` API does not return a hash, so `addTorrent` returns `{ hash: null }` for `.torrent` files and the info-hash parsed from a magnet when available (the registry caller already computes this in grab; the adapter returns null and lets the caller keep its magnet-derived hash).

- [ ] **Step 1: Write the failing test** (map a raw maindata torrent → NormalizedTorrent)

```ts
// apps/api/test/qbittorrentAdapter.test.ts
import { describe, expect, it } from "bun:test";
import { qbRawToNormalized } from "@rawkoon/api/services/downloadClient/qbittorrentAdapter";

describe("qbRawToNormalized", () => {
  it("maps a qBittorrent maindata torrent row", () => {
    const n = qbRawToNormalized("abc123", {
      name: "Movie.2024.1080p",
      state: "stalledDL",
      progress: 0.5,
      save_path: "/downloads",
      content_path: "/downloads/Movie.2024.1080p",
      num_seeds: 2,
      num_leechs: 1,
      dlspeed: 1000,
      size: 42,
    });
    expect(n).toEqual({
      hash: "abc123",
      name: "Movie.2024.1080p",
      state: "stalled",
      progress: 0.5,
      savePath: "/downloads",
      contentPath: "/downloads/Movie.2024.1080p",
      seeds: 2,
      peers: 1,
      dlSpeed: 1000,
      sizeBytes: 42,
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test apps/api/test/qbittorrentAdapter.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the adapter**

```ts
// apps/api/src/services/downloadClient/qbittorrentAdapter.ts
import type { QbittorrentIntegrationConfig } from "@rawkoon/api/services/qbittorrent/clientTypes";
import {
  addQbittorrentMagnet,
  addQbittorrentTorrentFile,
} from "@rawkoon/api/services/qbittorrent/torrentAdd";
import { fetchMaindata } from "@rawkoon/api/services/qbittorrent/clientFetch";
import { resetMaindataState } from "@rawkoon/api/services/qbittorrent/clientSession";
import {
  pauseQbittorrentTorrent,
  resumeQbittorrentTorrent,
  deleteQbittorrentTorrent,
} from "@rawkoon/api/services/qbittorrent/torrentMutations";
import { normalizeQbState } from "./stateNormalize";
import {
  DownloadClientError,
  type AddTorrentInput,
  type DownloadClientAdapter,
  type NormalizedTorrent,
} from "./types";

const num = (v: unknown, d = 0): number =>
  typeof v === "number" && Number.isFinite(v) ? v : d;
const str = (v: unknown, d = ""): string => (typeof v === "string" ? v : d);

export function qbRawToNormalized(
  hash: string,
  raw: Record<string, unknown>,
): NormalizedTorrent {
  const contentPath = str(raw.content_path, "");
  return {
    hash,
    name: str(raw.name),
    state: normalizeQbState(str(raw.state)),
    progress: num(raw.progress),
    savePath: str(raw.save_path),
    contentPath: contentPath || null,
    seeds: num(raw.num_seeds),
    peers: num(raw.num_leechs),
    dlSpeed: num(raw.dlspeed),
    sizeBytes: num(raw.size),
  };
}

export function createQbittorrentAdapter(
  config: QbittorrentIntegrationConfig,
): DownloadClientAdapter {
  const fail = (msg: string): never => {
    throw new DownloadClientError(msg, "qbittorrent");
  };

  return {
    type: "qbittorrent",

    async testConnection() {
      try {
        await fetchMaindata(config);
        return { ok: true };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : "unreachable" };
      }
    },

    async addTorrent(input: AddTorrentInput) {
      const tags = [input.tag];
      if (input.magnetOrUrl?.startsWith("magnet:")) {
        const res = await addQbittorrentMagnet(config, true, {
          magnet: input.magnetOrUrl,
          category: input.category ?? null,
          tags,
          save_path: input.savePath ?? null,
        });
        if (!res.success) fail(res.error ?? "magnet add failed");
      } else if (input.fileBuffer) {
        const file = new File([input.fileBuffer], input.fileName ?? "torrent.torrent");
        const res = await addQbittorrentTorrentFile(config, true, {
          torrent: file,
          category: input.category ?? null,
          tags,
          save_path: input.savePath ?? null,
        });
        if (!res.success) fail(res.error ?? "torrent add failed");
      } else {
        fail("addTorrent requires magnetOrUrl or fileBuffer");
      }
      // qBittorrent add API returns no hash.
      return { hash: null };
    },

    async listTorrents() {
      resetMaindataState();
      const { torrents } = await fetchMaindata(config);
      const out: NormalizedTorrent[] = [];
      for (const [hash, raw] of torrents) out.push(qbRawToNormalized(hash, raw));
      return out;
    },

    async getTorrent(hash: string) {
      const all = await this.listTorrents();
      return all.find((t) => t.hash.toLowerCase() === hash.toLowerCase()) ?? null;
    },

    async pause(hash: string) {
      const r = await pauseQbittorrentTorrent(config, true, { hash });
      if (!r.success) fail(r.error ?? "pause failed");
    },

    async resume(hash: string) {
      const r = await resumeQbittorrentTorrent(config, true, { hash });
      if (!r.success) fail(r.error ?? "resume failed");
    },

    async remove(hash: string, deleteData: boolean) {
      const r = await deleteQbittorrentTorrent(config, true, {
        hash,
        delete_files: deleteData,
      });
      if (!r.success) fail(r.error ?? "delete failed");
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test apps/api/test/qbittorrentAdapter.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/downloadClient/qbittorrentAdapter.ts apps/api/test/qbittorrentAdapter.test.ts
git commit -m "feat(downloads): qBittorrent adapter over existing client"
```

---

## Task 5: Transmission adapter

**Files:**
- Create: `apps/api/src/services/downloadClient/transmissionAdapter.ts`
- Test: `apps/api/test/transmissionAdapter.test.ts`

**Interfaces:**
- Consumes: `DownloadClientAdapter`, `NormalizedTorrent`, `AddTorrentInput`, `DownloadClientError` (Task 1); `normalizeTransmissionState` (Task 2); `DownloadClientIntegrationConfig` (Task 3).
- Produces: `createTransmissionAdapter(config: DownloadClientIntegrationConfig): DownloadClientAdapter`; `transmissionRowToNormalized(raw)`.

Transmission RPC notes: POST JSON to `<url>/transmission/rpc` (config `website_url` is the base; append if missing). Requires `X-Transmission-Session-Id` — on HTTP 409 the response header `X-Transmission-Session-Id` carries the token; store and retry. Basic auth via `Authorization: Basic base64(user:pass)`. `torrent-add` returns `arguments.torrent-added.hashString` (or `torrent-duplicate`). `torrent-get` fields: `hashString,name,percentDone,status,rateDownload,peersGettingFromUs? ,peersConnected,downloadDir,sizeWhenDone,errorString,error,isStalled`. Transmission `status`: 0 stopped, 4 downloading, 5 seed-wait, 6 seeding.

- [ ] **Step 1: Write the failing test** (row → normalized)

```ts
// apps/api/test/transmissionAdapter.test.ts
import { describe, expect, it } from "bun:test";
import { transmissionRowToNormalized } from "@rawkoon/api/services/downloadClient/transmissionAdapter";

describe("transmissionRowToNormalized", () => {
  it("maps a downloading torrent", () => {
    const n = transmissionRowToNormalized({
      hashString: "DEAD",
      name: "Show.S01E01",
      percentDone: 0.25,
      status: 4,
      rateDownload: 2048,
      peersConnected: 5,
      downloadDir: "/dl",
      sizeWhenDone: 100,
      error: 0,
      isStalled: false,
    });
    expect(n).toEqual({
      hash: "dead",
      name: "Show.S01E01",
      state: "downloading",
      progress: 0.25,
      savePath: "/dl",
      contentPath: "/dl/Show.S01E01",
      seeds: 0,
      peers: 5,
      dlSpeed: 2048,
      sizeBytes: 100,
    });
  });

  it("maps a stalled torrent", () => {
    const n = transmissionRowToNormalized({
      hashString: "BEEF",
      name: "x",
      percentDone: 0.1,
      status: 4,
      rateDownload: 0,
      peersConnected: 0,
      downloadDir: "/dl",
      sizeWhenDone: 10,
      error: 0,
      isStalled: true,
    });
    expect(n.state).toBe("stalled");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test apps/api/test/transmissionAdapter.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the adapter**

```ts
// apps/api/src/services/downloadClient/transmissionAdapter.ts
import type { DownloadClientIntegrationConfig } from "./config";
import { normalizeTransmissionState } from "./stateNormalize";
import {
  DownloadClientError,
  type AddTorrentInput,
  type DownloadClientAdapter,
  type NormalizedTorrent,
} from "./types";

const num = (v: unknown, d = 0): number =>
  typeof v === "number" && Number.isFinite(v) ? v : d;
const str = (v: unknown, d = ""): string => (typeof v === "string" ? v : d);

const TORRENT_FIELDS = [
  "hashString",
  "name",
  "percentDone",
  "status",
  "rateDownload",
  "peersConnected",
  "peersSendingToUs",
  "downloadDir",
  "sizeWhenDone",
  "error",
  "isStalled",
];

export function transmissionRowToNormalized(
  raw: Record<string, unknown>,
): NormalizedTorrent {
  const dir = str(raw.downloadDir);
  const name = str(raw.name);
  return {
    hash: str(raw.hashString).toLowerCase(),
    name,
    state: normalizeTransmissionState(num(raw.status), {
      isStalled: raw.isStalled === true,
      errorNo: num(raw.error),
      percentDone: num(raw.percentDone),
    }),
    progress: num(raw.percentDone),
    savePath: dir,
    contentPath: dir && name ? `${dir.replace(/\/+$/, "")}/${name}` : null,
    seeds: num(raw.peersSendingToUs),
    peers: num(raw.peersConnected),
    dlSpeed: num(raw.rateDownload),
    sizeBytes: num(raw.sizeWhenDone),
  };
}

export function createTransmissionAdapter(
  config: DownloadClientIntegrationConfig,
): DownloadClientAdapter {
  const rpcUrl = config.website_url.match(/\/transmission\/rpc\/?$/)
    ? config.website_url
    : `${config.website_url.replace(/\/+$/, "")}/transmission/rpc`;

  let sessionId = "";

  const authHeader = () =>
    config.username || config.password
      ? {
          Authorization:
            "Basic " +
            Buffer.from(`${config.username}:${config.password}`).toString("base64"),
        }
      : {};

  const rpc = async <T = Record<string, unknown>>(
    method: string,
    args: Record<string, unknown> = {},
  ): Promise<T> => {
    const doFetch = () =>
      fetch(rpcUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Transmission-Session-Id": sessionId,
          ...authHeader(),
        },
        body: JSON.stringify({ method, arguments: args }),
      });

    let res = await doFetch();
    if (res.status === 409) {
      sessionId = res.headers.get("X-Transmission-Session-Id") ?? "";
      res = await doFetch();
    }
    if (!res.ok) {
      throw new DownloadClientError(
        `Transmission RPC ${method} failed: HTTP ${res.status}`,
        "transmission",
      );
    }
    const body = (await res.json()) as { result: string; arguments: T };
    if (body.result !== "success") {
      throw new DownloadClientError(
        `Transmission RPC ${method}: ${body.result}`,
        "transmission",
      );
    }
    return body.arguments;
  };

  return {
    type: "transmission",

    async testConnection() {
      try {
        await rpc("session-get");
        return { ok: true };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : "unreachable" };
      }
    },

    async addTorrent(input: AddTorrentInput) {
      const args: Record<string, unknown> = { labels: [input.tag] };
      if (input.savePath) args["download-dir"] = input.savePath;
      if (input.magnetOrUrl) {
        args.filename = input.magnetOrUrl;
      } else if (input.fileBuffer) {
        args.metainfo = Buffer.from(input.fileBuffer).toString("base64");
      } else {
        throw new DownloadClientError(
          "addTorrent requires magnetOrUrl or fileBuffer",
          "transmission",
        );
      }
      const out = await rpc<{
        "torrent-added"?: { hashString?: string };
        "torrent-duplicate"?: { hashString?: string };
      }>("torrent-add", args);
      const hash =
        out["torrent-added"]?.hashString ??
        out["torrent-duplicate"]?.hashString ??
        null;
      return { hash: hash ? hash.toLowerCase() : null };
    },

    async listTorrents() {
      const out = await rpc<{ torrents: Record<string, unknown>[] }>(
        "torrent-get",
        { fields: TORRENT_FIELDS },
      );
      return (out.torrents ?? []).map(transmissionRowToNormalized);
    },

    async getTorrent(hash: string) {
      const out = await rpc<{ torrents: Record<string, unknown>[] }>(
        "torrent-get",
        { fields: TORRENT_FIELDS, ids: [hash] },
      );
      const row = (out.torrents ?? [])[0];
      return row ? transmissionRowToNormalized(row) : null;
    },

    async pause(hash: string) {
      await rpc("torrent-stop", { ids: [hash] });
    },

    async resume(hash: string) {
      await rpc("torrent-start", { ids: [hash] });
    },

    async remove(hash: string, deleteData: boolean) {
      await rpc("torrent-remove", {
        ids: [hash],
        "delete-local-data": deleteData,
      });
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test apps/api/test/transmissionAdapter.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/downloadClient/transmissionAdapter.ts apps/api/test/transmissionAdapter.test.ts
git commit -m "feat(downloads): Transmission adapter"
```

---

## Task 6: Deluge adapter

**Files:**
- Create: `apps/api/src/services/downloadClient/delugeAdapter.ts`
- Test: `apps/api/test/delugeAdapter.test.ts`

**Interfaces:**
- Consumes: Task 1 types; `normalizeDelugeState` (Task 2); `DownloadClientIntegrationConfig` (Task 3).
- Produces: `createDelugeAdapter(config: DownloadClientIntegrationConfig): DownloadClientAdapter`; `delugeRowToNormalized(hash, raw)`.

Deluge Web JSON-RPC notes: POST JSON `{ method, params, id }` to `<url>/json`. Must call `auth.login` with `[password]` first; the Web daemon returns a session cookie which must be sent on subsequent calls. `web.update_ui` or `core.get_torrents_status` returns a map keyed by hash. Fields: `name,progress(0..100),state,download_payload_rate,num_seeds,num_peers,save_path,total_wanted`. `core.add_torrent_magnet(uri, options)` / `core.add_torrent_file(filename, base64, options)` return the hash. Labels via the Label plugin (`label.set_torrent`) — best-effort; if the plugin is absent, swallow the error (matching still works by hash).

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/test/delugeAdapter.test.ts
import { describe, expect, it } from "bun:test";
import { delugeRowToNormalized } from "@rawkoon/api/services/downloadClient/delugeAdapter";

describe("delugeRowToNormalized", () => {
  it("maps a seeding torrent and scales progress to 0..1", () => {
    const n = delugeRowToNormalized("abcd", {
      name: "Movie",
      progress: 100,
      state: "Seeding",
      download_payload_rate: 0,
      num_seeds: 4,
      num_peers: 1,
      save_path: "/dl",
      total_wanted: 500,
    });
    expect(n).toEqual({
      hash: "abcd",
      name: "Movie",
      state: "completed",
      progress: 1,
      savePath: "/dl",
      contentPath: "/dl/Movie",
      seeds: 4,
      peers: 1,
      dlSpeed: 0,
      sizeBytes: 500,
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test apps/api/test/delugeAdapter.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the adapter**

```ts
// apps/api/src/services/downloadClient/delugeAdapter.ts
import type { DownloadClientIntegrationConfig } from "./config";
import { normalizeDelugeState } from "./stateNormalize";
import {
  DownloadClientError,
  type AddTorrentInput,
  type DownloadClientAdapter,
  type NormalizedTorrent,
} from "./types";

const num = (v: unknown, d = 0): number =>
  typeof v === "number" && Number.isFinite(v) ? v : d;
const str = (v: unknown, d = ""): string => (typeof v === "string" ? v : d);

const STATUS_FIELDS = [
  "name",
  "progress",
  "state",
  "download_payload_rate",
  "num_seeds",
  "num_peers",
  "save_path",
  "total_wanted",
];

export function delugeRowToNormalized(
  hash: string,
  raw: Record<string, unknown>,
): NormalizedTorrent {
  const dir = str(raw.save_path);
  const name = str(raw.name);
  return {
    hash: hash.toLowerCase(),
    name,
    state: normalizeDelugeState(str(raw.state)),
    progress: num(raw.progress) / 100,
    savePath: dir,
    contentPath: dir && name ? `${dir.replace(/\/+$/, "")}/${name}` : null,
    seeds: num(raw.num_seeds),
    peers: num(raw.num_peers),
    dlSpeed: num(raw.download_payload_rate),
    sizeBytes: num(raw.total_wanted),
  };
}

export function createDelugeAdapter(
  config: DownloadClientIntegrationConfig,
): DownloadClientAdapter {
  const jsonUrl = config.website_url.match(/\/json\/?$/)
    ? config.website_url
    : `${config.website_url.replace(/\/+$/, "")}/json`;

  let cookie = "";
  let rpcId = 0;
  let loggedIn = false;

  const rawCall = async <T>(method: string, params: unknown[]): Promise<T> => {
    const res = await fetch(jsonUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(cookie ? { Cookie: cookie } : {}),
      },
      body: JSON.stringify({ method, params, id: ++rpcId }),
    });
    const setCookie = res.headers.get("set-cookie");
    if (setCookie) cookie = setCookie.split(";")[0];
    if (!res.ok) {
      throw new DownloadClientError(
        `Deluge RPC ${method} failed: HTTP ${res.status}`,
        "deluge",
      );
    }
    const body = (await res.json()) as { result: T; error: unknown };
    if (body.error) {
      throw new DownloadClientError(
        `Deluge RPC ${method}: ${JSON.stringify(body.error)}`,
        "deluge",
      );
    }
    return body.result;
  };

  const ensureLogin = async () => {
    if (loggedIn) return;
    const ok = await rawCall<boolean>("auth.login", [config.password]);
    if (!ok) throw new DownloadClientError("Deluge auth failed", "deluge");
    loggedIn = true;
  };

  const call = async <T>(method: string, params: unknown[]): Promise<T> => {
    await ensureLogin();
    try {
      return await rawCall<T>(method, params);
    } catch (e) {
      // Session may have expired — re-login once and retry.
      loggedIn = false;
      await ensureLogin();
      return rawCall<T>(method, params);
    }
  };

  const setLabelBestEffort = async (hash: string, label: string) => {
    try {
      await call("label.set_torrent", [hash, label]);
    } catch {
      // Label plugin not installed — matching still works by hash.
    }
  };

  return {
    type: "deluge",

    async testConnection() {
      try {
        await ensureLogin();
        return { ok: true };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : "unreachable" };
      }
    },

    async addTorrent(input: AddTorrentInput) {
      const options: Record<string, unknown> = {};
      if (input.savePath) options.download_location = input.savePath;
      let hash: string | null = null;
      if (input.magnetOrUrl) {
        hash = await call<string>("core.add_torrent_magnet", [
          input.magnetOrUrl,
          options,
        ]);
      } else if (input.fileBuffer) {
        const b64 = Buffer.from(input.fileBuffer).toString("base64");
        hash = await call<string>("core.add_torrent_file", [
          input.fileName ?? "torrent.torrent",
          b64,
          options,
        ]);
      } else {
        throw new DownloadClientError(
          "addTorrent requires magnetOrUrl or fileBuffer",
          "deluge",
        );
      }
      if (hash) await setLabelBestEffort(hash, input.tag);
      return { hash: hash ? hash.toLowerCase() : null };
    },

    async listTorrents() {
      const map = await call<Record<string, Record<string, unknown>>>(
        "core.get_torrents_status",
        [{}, STATUS_FIELDS],
      );
      return Object.entries(map ?? {}).map(([hash, raw]) =>
        delugeRowToNormalized(hash, raw),
      );
    },

    async getTorrent(hash: string) {
      const raw = await call<Record<string, unknown>>("core.get_torrent_status", [
        hash,
        STATUS_FIELDS,
      ]);
      return raw && Object.keys(raw).length
        ? delugeRowToNormalized(hash, raw)
        : null;
    },

    async pause(hash: string) {
      await call("core.pause_torrent", [[hash]]);
    },

    async resume(hash: string) {
      await call("core.resume_torrent", [[hash]]);
    },

    async remove(hash: string, deleteData: boolean) {
      await call("core.remove_torrent", [hash, deleteData]);
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test apps/api/test/delugeAdapter.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/downloadClient/delugeAdapter.ts apps/api/test/delugeAdapter.test.ts
git commit -m "feat(downloads): Deluge adapter"
```

---

## Task 7: Adapter registry

**Files:**
- Create: `apps/api/src/services/downloadClient/registry.ts`
- Test: `apps/api/test/downloadClientRegistry.test.ts`

**Interfaces:**
- Consumes: `getDownloadClientIntegrationConfig` (Task 3); `createQbittorrentAdapter` (Task 4), `createTransmissionAdapter` (Task 5), `createDelugeAdapter` (Task 6).
- Produces: `resolveActiveAdapter(): Promise<{ adapter: DownloadClientAdapter; label: string; savePath?: string } | null>` (null when disabled/unconfigured); `buildAdapter(clientType, config): DownloadClientAdapter` (pure, testable without DB).

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/test/downloadClientRegistry.test.ts
import { describe, expect, it } from "bun:test";
import { buildAdapter } from "@rawkoon/api/services/downloadClient/registry";

const cfg = {
  website_url: "http://localhost",
  username: "u",
  password: "p",
  label: "rawkoon",
};

describe("buildAdapter", () => {
  it("builds the right adapter per client type", () => {
    expect(buildAdapter("qbittorrent", cfg).type).toBe("qbittorrent");
    expect(buildAdapter("transmission", cfg).type).toBe("transmission");
    expect(buildAdapter("deluge", cfg).type).toBe("deluge");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test apps/api/test/downloadClientRegistry.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the registry**

```ts
// apps/api/src/services/downloadClient/registry.ts
import {
  getDownloadClientIntegrationConfig,
  type DownloadClientIntegrationConfig,
} from "./config";
import { createQbittorrentAdapter } from "./qbittorrentAdapter";
import { createTransmissionAdapter } from "./transmissionAdapter";
import { createDelugeAdapter } from "./delugeAdapter";
import type { DownloadClientAdapter, DownloadClientType } from "./types";

export function buildAdapter(
  clientType: DownloadClientType,
  config: DownloadClientIntegrationConfig,
): DownloadClientAdapter {
  switch (clientType) {
    case "qbittorrent":
      // qBittorrent adapter reuses the existing config shape (url/user/pass).
      return createQbittorrentAdapter({
        website_url: config.website_url,
        username: config.username,
        password: config.password,
      });
    case "transmission":
      return createTransmissionAdapter(config);
    case "deluge":
      return createDelugeAdapter(config);
  }
}

export async function resolveActiveAdapter(): Promise<{
  adapter: DownloadClientAdapter;
  label: string;
  savePath?: string;
} | null> {
  const { enabled, clientType, config } =
    await getDownloadClientIntegrationConfig();
  if (!enabled || !clientType || !config) return null;
  return {
    adapter: buildAdapter(clientType, config),
    label: config.label,
    savePath: config.save_path,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test apps/api/test/downloadClientRegistry.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/downloadClient/registry.ts apps/api/test/downloadClientRegistry.test.ts
git commit -m "feat(downloads): active download-client adapter registry"
```

---

## Task 8: Route grab through the registry

**Files:**
- Modify: `apps/api/src/services/mediaGrabberGrab.ts`
- Test: `apps/api/test/grabViaAdapter.test.ts`

**Interfaces:**
- Consumes: `resolveActiveAdapter` (Task 7); `AddTorrentInput` (Task 1).
- Produces: no new exports; `grabRelease` now adds via the active adapter and stores the adapter-returned hash when present.

The tag passed to the adapter is `rawkoon-dh-${dhRow.id}` so the completion worker can match by tag when the client returns no hash. The category continues to come from `qbCategoryForLibraryType(media.type)`.

- [ ] **Step 1: Write the failing test** — grab adds via the resolved adapter and records the tag

```ts
// apps/api/test/grabViaAdapter.test.ts
import { describe, expect, it, mock, beforeEach } from "bun:test";

const addTorrent = mock(async () => ({ hash: "resolvedhash" }));

mock.module("@rawkoon/api/services/downloadClient/registry", () => ({
  resolveActiveAdapter: async () => ({
    adapter: {
      type: "transmission",
      addTorrent,
      listTorrents: async () => [],
      getTorrent: async () => null,
      pause: async () => {},
      resume: async () => {},
      remove: async () => {},
      testConnection: async () => ({ ok: true }),
    },
    label: "rawkoon",
  }),
}));

// NOTE: this test also mocks prisma + helpers used by grabRelease. See the
// existing apps/api/test/libraryDownloadAction.test.ts for the established
// prisma-mock scaffolding to copy; reuse the same downloadHistory.create mock
// returning { id: 123 }.

describe("grabRelease via adapter", () => {
  beforeEach(() => addTorrent.mockClear());

  it("passes tag rawkoon-dh-<id> and a magnet to the adapter", async () => {
    const { grabRelease } = await import("@rawkoon/api/services/mediaGrabberGrab");
    const res = await grabRelease({
      mediaId: 1,
      downloadUrl: "magnet:?xt=urn:btih:deadbeef",
      releaseTitle: "Movie 2024 1080p",
    });
    expect(res.grabbed).toBe(true);
    expect(addTorrent).toHaveBeenCalledTimes(1);
    const arg = addTorrent.mock.calls[0][0];
    expect(arg.tag).toBe("rawkoon-dh-123");
    expect(arg.magnetOrUrl).toContain("magnet:");
  });
});
```

> Copy the prisma/helper mock setup from `apps/api/test/libraryDownloadAction.test.ts` (same directory) so `prisma.libraryMedia.findUnique` returns a movie and `prisma.downloadHistory.create` returns `{ id: 123 }`. Do not invent new mock helpers.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test apps/api/test/grabViaAdapter.test.ts`
Expected: FAIL — grab still calls `addQbittorrentMagnet`, adapter mock not invoked.

- [ ] **Step 3: Refactor `grabRelease`**

Replace the qBittorrent-specific imports and add-calls:

Remove imports:
```ts
import {
  addQbittorrentMagnet,
  addQbittorrentTorrentFile,
} from "@rawkoon/api/services/qbittorrent/torrentAdd";
import { getQbittorrentIntegrationConfig } from "@rawkoon/api/services/qbittorrent/config";
```
Add import:
```ts
import { resolveActiveAdapter } from "@rawkoon/api/services/downloadClient/registry";
```

Replace the config gate (lines ~81-84):
```ts
    const active = await resolveActiveAdapter();
    if (!active) {
      return { grabbed: false, reason: "No download client configured" };
    }
    const { adapter } = active;
```

Replace the magnet-add branch (lines ~114-141) with an adapter call that supplies the tag. Keep the existing `tryAdoptQbDuplicate` fallback ONLY for the qBittorrent client (it is qB-specific); for other clients, on failure mark the download failed:
```ts
    const tag = `rawkoon-dh-${dhRow.id}`;

    if (isMagnet) {
      try {
        const added = await adapter.addTorrent({
          magnetOrUrl: downloadUrl,
          category,
          tag,
        });
        if (added.hash) torrentHash = added.hash;
      } catch (e) {
        if (adapter.type === "qbittorrent") {
          const adopted = await tryAdoptQbDuplicate({
            dhRowId: dhRow.id,
            mediaId,
            episodeId: episodeId ?? null,
            mediaType: media.type,
            torrentHash,
            releaseTitle,
            qJson,
            isUpgrade: opts.isUpgrade,
          });
          if (adopted) {
            grabCommittedOk = true;
            successReleaseTitle = releaseTitle;
            return { grabbed: true, releaseTitle };
          }
        }
        const reason = e instanceof Error ? e.message : "Magnet add failed";
        await prisma.downloadHistory.update({
          where: { id: dhRow.id },
          data: { failed: true, failReason: reason },
        });
        return { grabbed: false, reason };
      }
    } else {
      // ... existing .torrent fetch code stays; where it currently calls
      // addQbittorrentTorrentFile(...), replace with:
      //   const added = await adapter.addTorrent({
      //     fileBuffer: new Uint8Array(await fetchedFile.arrayBuffer()),
      //     fileName: fetchedFile.name,
      //     category, tag,
      //   });
      //   if (added.hash) torrentHash = added.hash;
      // wrapped in try/catch mirroring the magnet branch above.
    }
```

Then persist the resolved `torrentHash` to the `downloadHistory` row after a successful add (add/adjust the existing update that sets status; include `torrentHash` when non-null):
```ts
    if (torrentHash) {
      await prisma.downloadHistory.update({
        where: { id: dhRow.id },
        data: { torrentHash },
      });
    }
```

> Read the current lines 142-260 of `mediaGrabberGrab.ts` before editing the `.torrent` branch — preserve the existing safe-fetch, size-limit, and magnet-fallback logic verbatim; only swap the `addQbittorrentTorrentFile` call for `adapter.addTorrent({ fileBuffer, fileName, category, tag })` inside the same try/catch shape shown above.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test apps/api/test/grabViaAdapter.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the existing grab-related tests + typecheck**

Run: `bun test apps/api/test/libraryDownloadAction.test.ts apps/api/test/tryAdoptQbDuplicate.test.ts && bun run --filter @rawkoon/api typecheck`
Expected: PASS (no regressions).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/services/mediaGrabberGrab.ts apps/api/test/grabViaAdapter.test.ts
git commit -m "feat(downloads): route grab through active download-client adapter"
```

---

## Task 9: MediaSettings poll/stall columns

**Files:**
- Modify: `apps/api/prisma/schema.prisma` (MediaSettings model, near line 503)
- Create migration: `apps/api/prisma/migrations/<timestamp>_download_poll_settings/migration.sql`

**Interfaces:**
- Produces: four new `MediaSettings` columns read by Task 10: `downloadPollActiveSecs`, `downloadPollIdleSecs`, `downloadStallTimeoutSecs`, `downloadMaxAgeSecs`.

- [ ] **Step 1: Add columns to the Prisma model**

In `model MediaSettings` add (matching the existing `@map` snake_case convention):
```prisma
  downloadPollActiveSecs   Int @default(20)     @map("download_poll_active_secs")
  downloadPollIdleSecs     Int @default(1800)   @map("download_poll_idle_secs")
  downloadStallTimeoutSecs Int @default(2700)   @map("download_stall_timeout_secs")
  downloadMaxAgeSecs       Int @default(604800) @map("download_max_age_secs")
```

- [ ] **Step 2: Generate the migration**

Run: `bun run db:migrate:dev`
(Prisma prompts for a name — use `download_poll_settings`.)
Expected: migration created + applied; `bun run db:generate` runs (or run it explicitly) so the Prisma client types include the new fields.

- [ ] **Step 3: Typecheck**

Run: `bun run --filter @rawkoon/api typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations
git commit -m "feat(downloads): add poll/stall/max-age settings columns"
```

---

## Task 10: Generalize the completion worker (poll + reconcile + stall + adaptive cadence)

**Files:**
- Modify: `apps/api/src/workers/checkDownloadCompletion.ts`
- Modify: `apps/api/src/services/jobs/scheduledTasksWorker.ts` (cadence)
- Test: `apps/api/test/reconcileNormalized.test.ts`

**Interfaces:**
- Consumes: `resolveActiveAdapter` (Task 7); `NormalizedTorrent` (Task 1); existing `markDownloadHistoryComplete`, `completeDownloadByHash`, `revertLibraryDownloadingIfNoOtherActiveGrabs`, `enqueueLibraryPostProcess`, `emitLibraryUpdate`; `prisma`.
- Produces: `reconcilePendingDownloadsNormalized(pending, torrents, opts)`; `computeNextPollDelaySecs(torrents, pending, settings)`; keeps `checkDownloadCompletion()` as the scheduled entrypoint.

The reconcile logic now reads `NormalizedTorrent.state`/`progress` instead of qBittorrent raw states. Stall is tracked with the existing `downloadHistory` fields plus two new nullable columns is NOT required — instead track `lastProgress`/`lastProgressAt` in a per-process in-memory map keyed by `downloadHistory.id` (persistence across restarts is unnecessary: on restart the map resets and the stall grace window simply restarts, which is safe/conservative).

- [ ] **Step 1: Write the failing test** (pure reconcile over normalized torrents)

```ts
// apps/api/test/reconcileNormalized.test.ts
import { describe, expect, it } from "bun:test";
import { classifyPendingAgainstTorrent } from "@rawkoon/api/workers/checkDownloadCompletion";
import type { NormalizedTorrent } from "@rawkoon/api/services/downloadClient/types";

const base: NormalizedTorrent = {
  hash: "h",
  name: "n",
  state: "downloading",
  progress: 0.5,
  savePath: "/dl",
  contentPath: "/dl/n",
  seeds: 1,
  peers: 1,
  dlSpeed: 1,
  sizeBytes: 10,
};

const now = 1_000_000;
const settings = { stallTimeoutSecs: 100, maxAgeSecs: 1000 };

describe("classifyPendingAgainstTorrent", () => {
  it("completed when state completed", () => {
    const r = classifyPendingAgainstTorrent(
      { ...base, state: "completed" },
      { createdAtMs: now, lastProgress: 0.5, lastProgressAtMs: now },
      now,
      settings,
    );
    expect(r.outcome).toBe("complete");
  });

  it("completed when progress >= 1", () => {
    const r = classifyPendingAgainstTorrent(
      { ...base, state: "downloading", progress: 1 },
      { createdAtMs: now, lastProgress: 1, lastProgressAtMs: now },
      now,
      settings,
    );
    expect(r.outcome).toBe("complete");
  });

  it("error state fails", () => {
    const r = classifyPendingAgainstTorrent(
      { ...base, state: "error" },
      { createdAtMs: now, lastProgress: 0.5, lastProgressAtMs: now },
      now,
      settings,
    );
    expect(r.outcome).toBe("fail");
    expect(r.reason).toContain("error");
  });

  it("progressing torrent keeps waiting and updates lastProgress", () => {
    const r = classifyPendingAgainstTorrent(
      { ...base, progress: 0.7 },
      { createdAtMs: now, lastProgress: 0.5, lastProgressAtMs: now - 50_000 },
      now,
      settings,
    );
    expect(r.outcome).toBe("wait");
    expect(r.progressed).toBe(true);
  });

  it("stalled past timeout fails", () => {
    const r = classifyPendingAgainstTorrent(
      { ...base, state: "stalled", progress: 0.5 },
      { createdAtMs: now - 500_000, lastProgress: 0.5, lastProgressAtMs: now - 200_000 },
      now,
      settings,
    );
    expect(r.outcome).toBe("fail");
    expect(r.reason).toContain("stalled");
  });

  it("no-progress past stall timeout fails even if state=downloading", () => {
    const r = classifyPendingAgainstTorrent(
      { ...base, state: "downloading", progress: 0.5 },
      { createdAtMs: now - 500_000, lastProgress: 0.5, lastProgressAtMs: now - 200_000 },
      now,
      settings,
    );
    expect(r.outcome).toBe("fail");
  });

  it("exceeding max age fails", () => {
    const r = classifyPendingAgainstTorrent(
      { ...base, progress: 0.9 },
      { createdAtMs: now - 2_000_000, lastProgress: 0.9, lastProgressAtMs: now - 10_000 },
      now,
      settings,
    );
    expect(r.outcome).toBe("fail");
    expect(r.reason).toContain("max age");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test apps/api/test/reconcileNormalized.test.ts`
Expected: FAIL — `classifyPendingAgainstTorrent` not exported.

- [ ] **Step 3: Add the pure classifier + progress tracker to the worker**

Add to `apps/api/src/workers/checkDownloadCompletion.ts`:

```ts
import type { NormalizedTorrent } from "@rawkoon/api/services/downloadClient/types";

export interface StallTrack {
  createdAtMs: number;
  lastProgress: number;
  lastProgressAtMs: number;
}

export interface ReconcileSettings {
  stallTimeoutSecs: number;
  maxAgeSecs: number;
}

export type PendingOutcome =
  | { outcome: "complete" }
  | { outcome: "fail"; reason: string }
  | { outcome: "wait"; progressed: boolean };

export function classifyPendingAgainstTorrent(
  torrent: NormalizedTorrent,
  track: StallTrack,
  nowMs: number,
  settings: ReconcileSettings,
): PendingOutcome {
  if (nowMs - track.createdAtMs > settings.maxAgeSecs * 1000) {
    return { outcome: "fail", reason: "exceeded max age with no completion" };
  }
  if (torrent.state === "completed" || torrent.progress >= 1) {
    return { outcome: "complete" };
  }
  if (torrent.state === "error") {
    return { outcome: "fail", reason: "download client reported error state" };
  }
  const progressed = torrent.progress > track.lastProgress + 1e-9;
  if (progressed) {
    return { outcome: "wait", progressed: true };
  }
  const noProgressMs = nowMs - track.lastProgressAtMs;
  const stalledLongEnough = noProgressMs > settings.stallTimeoutSecs * 1000;
  if (stalledLongEnough && (torrent.state === "stalled" || torrent.state === "downloading")) {
    return {
      outcome: "fail",
      reason:
        torrent.state === "stalled"
          ? "stalled - no progress"
          : "no progress before stall timeout",
    };
  }
  return { outcome: "wait", progressed: false };
}

// Per-process progress tracker, keyed by downloadHistory.id.
const stallTracks = new Map<number, StallTrack>();

export function getOrInitTrack(
  id: number,
  createdAtMs: number,
  progress: number,
  nowMs: number,
): StallTrack {
  const existing = stallTracks.get(id);
  if (existing) return existing;
  const t: StallTrack = {
    createdAtMs,
    lastProgress: progress,
    lastProgressAtMs: nowMs,
  };
  stallTracks.set(id, t);
  return t;
}

export function updateTrackProgress(id: number, progress: number, nowMs: number) {
  const t = stallTracks.get(id);
  if (t) {
    t.lastProgress = progress;
    t.lastProgressAtMs = nowMs;
  }
}

export function clearTrack(id: number) {
  stallTracks.delete(id);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test apps/api/test/reconcileNormalized.test.ts`
Expected: PASS.

- [ ] **Step 5: Rewrite `reconcilePendingDownloads` + `checkDownloadCompletion` to use the adapter**

Replace the body of `reconcilePendingDownloads` so it uses the active adapter's normalized torrents and the classifier. Keep the tag-matching fallback (`rawkoon-dh-${id}`) and the existing DB-update helpers. Replace the qBittorrent-specific imports (`fetchMaindata`, `resetMaindataState`, `getQbittorrentIntegrationConfig`) with `resolveActiveAdapter`.

```ts
export async function reconcilePendingDownloads(
  pending: Array<{
    id: number;
    mediaId: number | null;
    episodeId: number | null;
    torrentHash: string | null;
    createdAt?: Date | null;
  }>,
  opts: { treatMissingAsFailed?: boolean; settings?: ReconcileSettings } = {},
): Promise<PendingReconcileResult> {
  const result: PendingReconcileResult = { completed: 0, failed: 0, missing: 0 };
  if (!pending.length) return result;

  const active = await resolveActiveAdapter();
  if (!active) return result;

  let torrents: NormalizedTorrent[];
  try {
    torrents = await active.adapter.listTorrents();
  } catch (e) {
    console.warn("[reconcilePendingDownloads] listTorrents failed:", e);
    return result;
  }

  const settings: ReconcileSettings =
    opts.settings ?? { stallTimeoutSecs: 2700, maxAgeSecs: 604800 };
  const nowMs = Date.now();

  const byHash = new Map<string, NormalizedTorrent>();
  for (const t of torrents) byHash.set(t.hash.toLowerCase(), t);

  for (let dh of pending) {
    try {
      let match: NormalizedTorrent | undefined;
      if (dh.torrentHash) match = byHash.get(dh.torrentHash.toLowerCase());
      if (!match) {
        // Fallback: match by label/name tag rawkoon-dh-<id> is not exposed on
        // NormalizedTorrent; instead, if the client returned a hash on add it is
        // already stored. When no hash is known, match by name containment of the
        // release is unreliable — so only hash matching is used here. Downloads
        // whose hash is still unknown are handled by the qB tag path in
        // completeDownloadByHash-less flows below.
      }

      if (!match) {
        if (opts.treatMissingAsFailed) {
          await prisma.downloadHistory.update({
            where: { id: dh.id },
            data: { failed: true, failReason: "torrent missing from download client" },
          });
          await revertLibraryDownloadingIfNoOtherActiveGrabs(dh);
          if (dh.mediaId != null) emitLibraryUpdate(dh.mediaId);
          clearTrack(dh.id);
          result.missing += 1;
        }
        continue;
      }

      const createdAtMs = dh.createdAt ? dh.createdAt.getTime() : nowMs;
      const track = getOrInitTrack(dh.id, createdAtMs, match.progress, nowMs);
      const verdict = classifyPendingAgainstTorrent(match, track, nowMs, settings);

      if (verdict.outcome === "wait") {
        if (verdict.progressed) updateTrackProgress(dh.id, match.progress, nowMs);
        continue;
      }

      if (verdict.outcome === "fail") {
        await prisma.downloadHistory.update({
          where: { id: dh.id },
          data: { failed: true, failReason: verdict.reason },
        });
        await revertLibraryDownloadingIfNoOtherActiveGrabs(dh);
        if (dh.mediaId != null) emitLibraryUpdate(dh.mediaId);
        clearTrack(dh.id);
        result.failed += 1;
        continue;
      }

      // complete
      let completedId: number | null = null;
      if (dh.torrentHash) {
        completedId = await completeDownloadByHash(dh.torrentHash);
      }
      if (completedId == null) {
        await markDownloadHistoryComplete(dh);
        completedId = dh.id;
      }
      if (completedId != null) {
        enqueueLibraryPostProcess(completedId);
        clearTrack(dh.id);
        result.completed += 1;
      }
    } catch (e) {
      console.warn(`[reconcilePendingDownloads] Failed for download_history ${dh.id}:`, e);
    }
  }

  return result;
}
```

Update `checkDownloadCompletion` to select `createdAt` and pass settings:
```ts
export async function checkDownloadCompletion(): Promise<void> {
  const pending = await prisma.downloadHistory.findMany({
    where: { completedAt: null, failed: false },
    select: {
      id: true,
      mediaId: true,
      episodeId: true,
      torrentHash: true,
      createdAt: true,
    },
  });
  if (!pending.length) return;

  const settings = await prisma.mediaSettings.findUnique({ where: { id: 1 } });
  await reconcilePendingDownloads(pending, {
    settings: {
      stallTimeoutSecs: settings?.downloadStallTimeoutSecs ?? 2700,
      maxAgeSecs: settings?.downloadMaxAgeSecs ?? 604800,
    },
  });
}
```

> The `content_path`-based hash discovery that the old qBittorrent tag loop performed is dropped: clients that return a hash on add (Transmission, Deluge) store it at grab time; qBittorrent stores the magnet info-hash at grab time (Task 8) so `dh.torrentHash` is populated for magnets. `.torrent`-file qBittorrent grabs without a pre-known hash rely on `completeDownloadByHash`/post-process via the downloads scanner (unchanged). Note this limitation in the PR description.

- [ ] **Step 6: Adaptive cadence in the scheduler**

Read `apps/api/src/services/jobs/scheduledTasksWorker.ts` to find where `checkDownloadCompletion` is scheduled (currently a fixed 30-min interval). Add `computeNextPollDelaySecs` and reschedule dynamically:

```ts
// in checkDownloadCompletion.ts
export async function hasProgressingPending(): Promise<boolean> {
  const count = await prisma.downloadHistory.count({
    where: { completedAt: null, failed: false },
  });
  return count > 0;
}

export async function computeNextPollDelaySecs(): Promise<number> {
  const settings = await prisma.mediaSettings.findUnique({ where: { id: 1 } });
  const active = settings?.downloadPollActiveSecs ?? 20;
  const idle = settings?.downloadPollIdleSecs ?? 1800;
  return (await hasProgressingPending()) ? active : idle;
}
```

In `scheduledTasksWorker.ts`, replace the fixed-interval registration for download completion with a self-rescheduling timer: after each `checkDownloadCompletion()` run, `setTimeout(runner, (await computeNextPollDelaySecs()) * 1000)`. Follow the file's existing timer/register pattern — if it uses a cron-style registry, register the fast tier and gate the body so it early-returns when no pending downloads exist (keeping cost negligible), rather than restructuring the scheduler.

- [ ] **Step 7: Run tests + typecheck**

Run: `bun test apps/api/test/reconcileNormalized.test.ts apps/api/test/completeDownloadByHash.test.ts && bun run --filter @rawkoon/api typecheck`
Expected: PASS. (If `completeDownloadByHash.test.ts` mocks qBittorrent config, update its mock to the adapter registry per the mock pattern in Task 8.)

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/workers/checkDownloadCompletion.ts apps/api/src/services/jobs/scheduledTasksWorker.ts apps/api/test/reconcileNormalized.test.ts
git commit -m "feat(downloads): adapter-based polling reconcile with stall + adaptive cadence"
```

---

## Task 11: API routes + web settings + remove webhook

**Files:**
- Create: `apps/api/src/routes/integrations/downloadClient/index.ts`
- Modify: `apps/api/src/routes/integrations/index.ts` (register new route, drop qbittorrent route)
- Delete: `apps/api/src/routes/integrations/qbittorrent/index.ts`
- Modify: `apps/api/src/routes/webhooks/index.ts` (remove qBittorrent webhook route)
- Modify: `apps/web/src/pages/settings/` — new `DownloadClientIntegrationSection.tsx` + hook; remove `QbittorrentIntegrationSection.tsx`, `useQbittorrentIntegration.ts`, `useUpdateQbittorrentIntegration.ts`, `useSetupQbittorrentAutorun.ts`
- Modify: `apps/web/src/lib/endpoints/integrations.ts`, `apps/shared/src/types/integrations.ts` (remove `QbittorrentIntegration`)
- Modify: `apps/api/src/routes/dashboard/downloads/index.ts` (use adapter for the downloads panel)
- Test: `apps/api/test/downloadClientRoutes.test.ts`

**Interfaces:**
- Consumes: `getDownloadClientIntegrationConfig`, `invalidateDownloadClientIntegrationConfigCache` (Task 3); `resolveActiveAdapter` (Task 7); `encrypt` (crypto); shared `DownloadClientIntegration` (Task 3).
- Produces: `GET /integrations/download-client` (returns `DownloadClientIntegration`, never the secret); `PUT /integrations/download-client` (saves `client_type` + connection, encrypts password, invalidates cache); `POST /integrations/download-client/test` (calls `adapter.testConnection`).

- [ ] **Step 1: Write the failing test** — GET returns a redacted integration; PUT persists client_type and never echoes the password

```ts
// apps/api/test/downloadClientRoutes.test.ts
import { describe, expect, it } from "bun:test";
import { buildDownloadClientIntegrationView } from "@rawkoon/api/routes/integrations/downloadClient/index";

describe("buildDownloadClientIntegrationView", () => {
  it("redacts the password and exposes password_set", () => {
    const view = buildDownloadClientIntegrationView({
      enabled: true,
      config: {
        client_type: "transmission",
        website_url: "http://localhost:9091",
        username: "admin",
        password: "ENCRYPTED",
        label: "rawkoon",
      },
    });
    expect(view).toEqual({
      type: "download-client",
      enabled: true,
      client_type: "transmission",
      website_url: "http://localhost:9091",
      username: "admin",
      password_set: true,
      label: "rawkoon",
      save_path: undefined,
    });
    expect(JSON.stringify(view)).not.toContain("ENCRYPTED");
  });

  it("reports password_set false when absent", () => {
    const view = buildDownloadClientIntegrationView({
      enabled: false,
      config: {
        client_type: "qbittorrent",
        website_url: "",
        username: "",
        label: "rawkoon",
      },
    });
    expect(view.password_set).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test apps/api/test/downloadClientRoutes.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the route module** (mirror the structure of the existing `qbittorrent/index.ts` route — read it first for the Elysia handler/auth/validation conventions to copy)

```ts
// apps/api/src/routes/integrations/downloadClient/index.ts
import type { DownloadClientIntegration } from "@rawkoon/shared/types/integrations";

interface RawView {
  enabled: boolean;
  config: {
    client_type: DownloadClientIntegration["client_type"];
    website_url: string;
    username: string;
    password?: string;
    label: string;
    save_path?: string;
  };
}

export function buildDownloadClientIntegrationView(
  raw: RawView,
): DownloadClientIntegration {
  return {
    type: "download-client",
    enabled: raw.enabled,
    client_type: raw.config.client_type,
    website_url: raw.config.website_url,
    username: raw.config.username,
    password_set: Boolean(raw.config.password),
    label: raw.config.label,
    save_path: raw.config.save_path,
  };
}

// Elysia route group: GET / , PUT / , POST /test
// - GET: load prisma.integration where type="download-client"; return
//   buildDownloadClientIntegrationView(...).
// - PUT: validate client_type in ("qbittorrent"|"transmission"|"deluge");
//   encrypt(password) with @rawkoon/api/services/crypto ONLY when a new
//   non-empty password is supplied (otherwise preserve the stored one);
//   upsert prisma.integration (type "download-client"); then
//   await invalidateDownloadClientIntegrationConfigCache().
// - POST /test: const active = await resolveActiveAdapter(); if (!active)
//   return { ok:false, error:"not configured" }; return active.adapter.testConnection().
// Copy the exact Elysia handler signature, auth guard, and body schema from the
// existing qbittorrent route module.
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test apps/api/test/downloadClientRoutes.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire routes; remove qBittorrent route + webhook**

- Register the new route group in `apps/api/src/routes/integrations/index.ts`; remove the qbittorrent route registration and delete `apps/api/src/routes/integrations/qbittorrent/index.ts`.
- In `apps/api/src/routes/webhooks/index.ts`, remove the qBittorrent added/completed webhook route and its handler wiring. Leave other webhooks intact.
- Update `apps/api/src/routes/dashboard/downloads/index.ts` to source its torrent list from `resolveActiveAdapter().adapter.listTorrents()` (map `NormalizedTorrent` into the existing dashboard response shape) instead of `fetchMaindata`.

- [ ] **Step 6: Update the web app**

- Create `apps/web/src/pages/settings/_component/integrations/DownloadClientIntegrationSection.tsx`: a client-type `<select>` (qBittorrent / Transmission / Deluge) plus URL, username (hidden/disabled when Deluge), password, label, optional save-path fields, a Test button hitting `POST /integrations/download-client/test`, using `IntegrationSectionCard` + `IntegrationUrlInput`. Model it on the removed `QbittorrentIntegrationSection.tsx`.
- Create `useDownloadClientIntegration.ts` + `useUpdateDownloadClientIntegration.ts` (copy the query/mutation shape from the qBittorrent hooks; endpoints under `/integrations/download-client`).
- Update `apps/web/src/pages/settings/_component/IntegrationsTab.tsx` to render `DownloadClientIntegrationSection` in place of `QbittorrentIntegrationSection`.
- Delete `QbittorrentIntegrationSection.tsx`, `useQbittorrentIntegration.ts`, `useUpdateQbittorrentIntegration.ts`, `useSetupQbittorrentAutorun.ts`.
- Update `apps/web/src/lib/endpoints/integrations.ts` (rename qbittorrent endpoints to download-client) and remove `QbittorrentIntegration` from `apps/shared/src/types/integrations.ts`.

- [ ] **Step 7: Full typecheck, lint, and test sweep**

Run: `bun run typecheck && bun run lint && bun run test`
Expected: PASS. Fix any remaining references to removed qBittorrent symbols (grep for `qbittorrent` under `apps/web/src` and `apps/api/src/routes`).

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(downloads): download-client routes + settings UI, remove webhook"
```

---

## Task 12: Cleanup + docs + request-log rename

**Files:**
- Modify: `apps/api/src/services/qbittorrent/requestLogs.ts` usage — keep for qBittorrent adapter, but confirm no dangling references to removed webhook secret fields.
- Modify: docs — `README.md` / `docs/` integration setup section for download clients.
- Modify: `docker-compose.yml` / `docker-compose.prod-example.yml` — remove the qBittorrent webhook env wiring if present; keep client examples.

- [ ] **Step 1: Grep for dead references**

Run: `grep -rn "webhook_secret\|rawkoon_base_url\|useSetupQbittorrentAutorun\|QbittorrentIntegration\b" apps/ docs/`
Expected: only intentional/historical matches (migrations, changelog). Remove live code references.

- [ ] **Step 2: Update docs**

Edit the integration docs to describe selecting one of qBittorrent / Transmission / Deluge, the connection fields per client, and that completion is detected by polling (no webhook setup needed). Remove qBittorrent "run external program" webhook setup instructions.

- [ ] **Step 3: Full sweep**

Run: `bun run typecheck && bun run lint && bun run test`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore(downloads): docs + cleanup for multi download-client support"
```

---

## Self-Review

**Spec coverage:**
- Adapter interface + registry → Tasks 1, 7. ✅
- qBittorrent / Transmission / Deluge adapters → Tasks 4, 5, 6. ✅
- Normalized states → Task 2 (+ per-adapter row mappers in 4/5/6). ✅
- Generalized config + migration + zero-reconfig → Task 3. ✅
- Polling backbone + adaptive cadence → Task 10. ✅
- Stall + max-age detection, mark failed + notify, no auto-fallback → Task 10 (`classifyPendingAgainstTorrent`; notify via existing `emitLibraryUpdate` + revert). ✅
- Settings for poll/stall/max-age → Task 9. ✅
- Routes + test connection + secret redaction → Task 11. ✅
- Web settings section + client selector → Task 11. ✅
- Retire webhook → Tasks 11, 12. ✅
- SSRF / request logging preserved → qBittorrent adapter reuses existing client; grab keeps `isHttpUrlSafeForServerTorrentFetch`/`fetchHttpWithSafeRedirects` (Task 8). ✅
- Post-processing unchanged → confirmed; adapter exposes `contentPath`; no post-processor edits. ✅

**Known scope notes carried into PR description:**
- Notifications on stall/fail reuse the existing library-update/revert path; if a dedicated user notification channel is desired for "download failed", that is an incremental follow-up (existing behavior already reverts + surfaces failed rows in the UI).
- qBittorrent `.torrent`-file grabs without a pre-known info-hash rely on the existing downloads-scanner/post-process path rather than hash reconcile (documented in Task 10 Step 5).

**Placeholder scan:** route handler bodies in Task 11 Step 3 are described as structured comments rather than full Elysia code because they must mirror the existing (unread-in-full) qbittorrent route's auth/validation conventions verbatim — the step explicitly instructs reading that file and copying its shape. All pure logic (view builder, config, adapters, reconcile, normalizers) has complete runnable code + tests.

**Type consistency:** `NormalizedTorrent`, `DownloadClientAdapter`, `AddTorrentInput`, `DownloadClientIntegrationConfig`, `classifyPendingAgainstTorrent`, `resolveActiveAdapter`, `buildAdapter` names are used consistently across tasks.

---

## Future Clients (out of scope — later layers)

Each is a new `create*Adapter` + state normalizer implementing the same
`DownloadClientAdapter` interface (plus a new `DownloadClientType` union member and
a `buildAdapter` case). No interface or reconcile changes required. Priority order:

1. **rTorrent / ruTorrent** — XML-RPC (or SCGI). Seedbox default; highest marginal coverage.
2. **Download Station** (Synology / QNAP) — HTTP API with session token auth. NAS crowd.
3. **Aria2** — JSON-RPC. Easiest to implement; clean protocol.
4. **Flood** — REST API; web UI fronting rTorrent/qBittorrent.
5. **uTorrent** — legacy Web API; long tail.

Explicitly NOT planned: Vuze, Hadouken, Freebox, Torrent Blackhole, and all Usenet
clients (BitTorrent-only scope).
