# Event-Driven Download Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the download client notify Rawkoon the instant a torrent finishes, so Rawkoon stops polling to discover it — and fix the qBittorrent sync cursor that makes every list a full snapshot.

**Architecture:** The hook is a *wake signal*, not an event: the endpoint authenticates, clears the poll gate, and enqueues the existing reconcile job, which then confirms completion against the client exactly as it does on a timer today. No new completion path, no new transition logic. The timer keeps sole ownership of failures, stalls, max-age, and missing torrents, because clients only fire on success. Separately, deleting one line restores qBittorrent's already-implemented delta sync.

**Tech Stack:** Bun, Elysia, Prisma 7 (Postgres 17), BullMQ + ioredis, `bun:test`, React 19 + TanStack Query, i18next.

**Spec:** [`docs/superpowers/specs/2026-08-06-download-completion-hook-design.md`](../specs/2026-08-06-download-completion-hook-design.md)

## Global Constraints

- **Never module-mock in tests. Inject dependencies.** `mock.module` is process-global in Bun, so a mock registered in one file leaks into every other file and whichever runs last wins. `apps/api/test/reconcilePendingDownloads.test.ts:27-31` documents this the hard way. Every seam this plan adds is an optional `deps`/`opts` parameter with a real default.
- **Two modules in this codebase are already poisoned by existing mocks. Do not import them in a new test.**
  - `services/downloadClient/registry` — `libraryDownloadAction`, `grabViaAdapter`, `libraryDownloadsLive`, and `rescan` all stub it with `buildAdapter: (type) => ({ type })`, an object with **no methods**. Call the concrete factory (`createQbittorrentAdapter`, …) directly instead of going through `buildAdapter`.
  - `services/qbittorrent/clientFetch` — `qbittorrentTorrentControl.test.ts` mocks it. As of Task 1 that mock spreads the real module, so it is now non-destructive; keep it that way. If you add a `mock.module` for a module anyone else imports, **spread the real module first** (`const real = await import(...)`) and override only what you need.
  - A new test passing in isolation but failing in the full `bun test` run is almost always this. Verify with `bun test <file>` versus `bun test`.
- **API code imports itself as `@rawkoon/api/<path>`**, never by relative path. (Files inside `services/qbittorrent/` use relative imports among themselves — follow the local file's existing style.)
- **Errors are returned, not thrown.** Use the helpers in `apps/api/src/errors.ts` (`badRequest`, `unauthorized`, …); they set `set.status` and return `{ error }`. The global `onError` swallows unmapped errors into a generic 500, so no error message you throw will reach the client.
- **TS is strict:** `noUnusedLocals`, `noUnusedParameters`, `noImplicitReturns`. Both `bun run typecheck` and `bun run typecheck:native` must pass — CI gates on both, and tsgo occasionally disagrees with tsc.
- **Biome covers `apps/web` and `apps/api`.** Run `bun run format` before committing.
- **Shared types are the contract.** Anything crossing the API/web boundary is typed in `apps/shared`, not redeclared on one side.
- **Web query keys are centralized** in `apps/web/src/lib/queryKeys.ts`.
- **Never run `db:migrate:dev` or `db:push` against production.**
- **Do not add `Co-Authored-By` trailers to commits.**
- **Writing to `MediaSettings` always uses `upsert`, never `update`.** Nothing seeds row 1 — no migration inserts it — so `update({where:{id:1}})` throws `P2025` on a fresh install. Follow `indexerManager/factory.ts:18`.
- Route prefix for the hook: `/api/download-client`. Endpoint path: `/api/download-client/hook/complete`.
- Auth header name: `X-Rawkoon-Token`.
- Token format: 32 random bytes, `base64url`. Encrypted at rest via `apps/api/src/services/crypto.ts` (`encrypt`/`decrypt`).
- Hook-recent window: 24 hours. Hooked active cadence default: 120s. Unhooked: 20s (unchanged).

---

## File Structure

**Created:**

| File | Responsibility |
|---|---|
| `apps/api/src/services/downloadClient/hookToken.ts` | Get-or-create, rotate, and constant-time-verify the hook token. Sole owner of token encryption. |
| `apps/api/src/services/downloadClient/hookCommands.ts` | Pure generators: the qBittorrent autorun command line and the Deluge/Transmission shell scripts. No I/O. |
| `apps/api/src/services/qbittorrent/preferences.ts` | `getPreferences` / `setPreferences` wrappers plus the autorun reconcile decision. |
| `apps/api/src/routes/integrations/downloadClient/hookRoutes.ts` | The unauthenticated-by-session hook endpoint and its own rate limiter. |
| `apps/api/prisma/migrations/<ts>_download_completion_hook/migration.sql` | Five `media_settings` columns. |
| `apps/api/test/qbittorrentMaindataSync.test.ts` | rid progression, delta merge, removals. |
| `apps/api/test/downloadHookToken.test.ts` | Token round-trip and verification. |
| `apps/api/test/downloadHookCommands.test.ts` | Command/script generation. |
| `apps/api/test/downloadHookRoutes.test.ts` | Endpoint auth, validation, wake behavior. |
| `apps/api/test/qbittorrentAutorun.test.ts` | Autorun reconcile decision + token containment. |

**Modified:**

| File | Change |
|---|---|
| `apps/api/prisma/schema.prisma` | Five `MediaSettings` fields. |
| `apps/api/src/services/qbittorrent/clientFetch.ts` | Optional injected `fetchJson` on `fetchMaindata`. |
| `apps/api/src/services/downloadClient/qbittorrentAdapter.ts` | Remove the cursor reset; narrow `getTorrent`; accept optional deps. |
| `apps/api/src/services/downloadClient/registry.ts` | Thread optional deps through `buildAdapter`. |
| `apps/api/src/workers/checkDownloadCompletion.ts` | Export `requestImmediatePoll`; hook-aware cadence selection. |
| `apps/api/src/routes/integrations/downloadClient/index.ts` | Expose hook config, rotate action, autorun status. |
| `apps/api/src/index.ts` | Mount `downloadClientHookRoutes`. |
| `apps/shared/src/types/*` | Hook config response type. |
| `apps/web/src/pages/settings/_component/integrations/DownloadClientIntegrationSection.tsx` | Hook UI. |
| `apps/web/src/locales/{en,fr}/*` | Strings. |
| `apps/web/src/lib/queryKeys.ts` | Hook config key. |

**Task order rationale:** Task 1 is fully independent and shippable alone. Tasks 2–3 build the storage and token primitives that 4–8 consume. Task 9 is the only web work and depends on the API surface from Task 8.

---

### Task 1: Preserve the qBittorrent sync cursor

Independent of every other task. Ship it alone if you like.

**Files:**
- Modify: `apps/api/src/services/qbittorrent/clientFetch.ts:166-266`
- Modify: `apps/api/src/services/downloadClient/qbittorrentAdapter.ts:100-113`
- Test: `apps/api/test/qbittorrentMaindataSync.test.ts` (create)
- Modify: `apps/api/test/qbittorrentTorrentControl.test.ts` (make its `clientFetch` mock non-destructive)

**Status: DONE** — committed as `cf51899`. `registry.ts` was deliberately left untouched: threading `deps` through `buildAdapter` would have been dead surface, because four other test files stub the registry and no test can reach the real one.

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: `fetchMaindata(config, deps?: MaindataDeps)` where `type MaindataDeps = { fetchJson?: <T>(config: QbittorrentIntegrationConfig, path: string) => Promise<T> }`; `createQbittorrentAdapter(config, deps?: { maindata?: MaindataDeps })`. No later task depends on these.

**Background the implementer needs:**

`clientFetch.ts:189-256` already implements complete revision-based sync against `/api/v2/sync/maindata?rid=<n>` — `full_update`, per-torrent delta merge, `torrents_removed`, `server_state` accumulation. It never takes effect because `qbittorrentAdapter.ts:101` calls `resetMaindataState()` at the top of every `listTorrents()`, so every request goes out as `rid=0` and returns the whole list.

That line arrived with the original multi-client adapter (`9b2576e`), not as a fix for a stale-state bug. Removing it does not reintroduce one.

Do **not** touch `clientSession.ts:103` — that reset fires when the client config changes and is correct.

Two gotchas for the test:
- `fetchMaindata` short-circuits to a cached snapshot within `MAINDATA_REUSE_WINDOW_MS` (750ms). Call `setLastMaindataSnapshot(null)` between calls to exercise a real request instead of sleeping.
- The cursor lives in module state, so reset it in `beforeEach` with `resetMaindataState()`.

- [ ] **Step 1: Add the injectable fetcher to `fetchMaindata`**

In `apps/api/src/services/qbittorrent/clientFetch.ts`, export the deps type and add the optional parameter. Replace the signature and the single `qbFetchJson` call inside:

```ts
export type MaindataDeps = {
  fetchJson?: <T>(
    config: QbittorrentIntegrationConfig,
    path: string,
  ) => Promise<T>;
};

export const fetchMaindata = async (
  config: QbittorrentIntegrationConfig,
  deps?: MaindataDeps,
): Promise<{
  serverState: Record<string, unknown>;
  torrents: Map<string, Record<string, unknown>>;
}> => {
```

Then inside the `fetchPromise` body, change the fetch line from `qbFetchJson<MaindataRaw>(config, ...)` to:

```ts
    const fetchJson = deps?.fetchJson ?? qbFetchJson;
    const maindataState = getMaindataState();
    const rid = maindataState?.rid ?? 0;
    const raw = await fetchJson<MaindataRaw>(
      config,
      `/api/v2/sync/maindata?rid=${rid}`,
    );
```

Leave everything else in that function untouched.

- [ ] **Step 2: Write the failing test**

Create `apps/api/test/qbittorrentMaindataSync.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "bun:test";
import { fetchMaindata } from "@rawkoon/api/services/qbittorrent/clientFetch";
import {
  resetMaindataState,
  setLastMaindataSnapshot,
} from "@rawkoon/api/services/qbittorrent/clientSession";

const config = {
  website_url: "http://localhost:8080",
  username: "u",
  password: "p",
  label: "rawkoon",
};

// Injected rather than module-mocked: Bun's mock.module is process-global and
// would leak into every other test file in the run.
function recordingFetcher(responses: unknown[]) {
  const paths: string[] = [];
  let i = 0;
  return {
    paths,
    fetchJson: <T,>(_c: unknown, path: string): Promise<T> => {
      paths.push(path);
      return Promise.resolve(responses[i++] as T);
    },
  };
}

describe("fetchMaindata cursor", () => {
  beforeEach(() => {
    resetMaindataState();
    setLastMaindataSnapshot(null);
  });

  it("sends rid=0 first, then the revision returned by the client", async () => {
    const f = recordingFetcher([
      {
        rid: 5,
        full_update: true,
        server_state: { dl_info_speed: 100 },
        torrents: { aaa: { progress: 0.5 } },
      },
      { rid: 9, torrents: { aaa: { progress: 0.9 } } },
    ]);

    await fetchMaindata(config, { fetchJson: f.fetchJson });
    setLastMaindataSnapshot(null);
    await fetchMaindata(config, { fetchJson: f.fetchJson });

    expect(f.paths).toEqual([
      "/api/v2/sync/maindata?rid=0",
      "/api/v2/sync/maindata?rid=5",
    ]);
  });

  it("merges deltas into the retained projection", async () => {
    const f = recordingFetcher([
      {
        rid: 1,
        full_update: true,
        torrents: { aaa: { progress: 0.5, name: "A" } },
      },
      { rid: 2, torrents: { aaa: { progress: 1 } } },
    ]);

    await fetchMaindata(config, { fetchJson: f.fetchJson });
    setLastMaindataSnapshot(null);
    const second = await fetchMaindata(config, { fetchJson: f.fetchJson });

    expect(second.torrents.get("aaa")).toMatchObject({
      progress: 1,
      name: "A",
      hash: "aaa",
    });
  });

  it("drops torrents the client reports as removed", async () => {
    const f = recordingFetcher([
      { rid: 1, full_update: true, torrents: { aaa: {}, bbb: {} } },
      { rid: 2, torrents_removed: ["aaa"] },
    ]);

    await fetchMaindata(config, { fetchJson: f.fetchJson });
    setLastMaindataSnapshot(null);
    const second = await fetchMaindata(config, { fetchJson: f.fetchJson });

    expect([...second.torrents.keys()]).toEqual(["bbb"]);
  });
});
```

- [ ] **Step 3: Run the test — the first case must fail**

```bash
cd apps/api && bun test test/qbittorrentMaindataSync.test.ts
```

Expected: the merge and removal cases pass (the machinery already works); the rid case may pass too, because this test calls `fetchMaindata` directly and never goes through the adapter that resets. That is fine — these three lock in the behavior the adapter change is about to start relying on. **Do not skip them.** If any fail, the merge logic is broken and that must be fixed before continuing.

- [ ] **Step 4: Remove the reset and narrow `getTorrent`**

In `apps/api/src/services/downloadClient/qbittorrentAdapter.ts`, replace lines 100-113:

```ts
    async listTorrents() {
      const { torrents } = await fetchMaindata(config, deps?.maindata);
      return [...torrents].map(([hash, raw]) => qbRawToNormalized(hash, raw));
    },

    async getTorrent(hash: string) {
      const { torrents } = await fetchMaindata(config, deps?.maindata);
      const wanted = hash.toLowerCase();
      for (const [key, raw] of torrents) {
        if (key.toLowerCase() === wanted) return qbRawToNormalized(key, raw);
      }
      return null;
    },
```

Delete the now-unused `resetMaindataState` import at line 2 — `noUnusedLocals` will fail the build otherwise.

Add the optional `deps` parameter to the adapter factory in the same file (match the existing factory signature; it takes `config` today) and thread it from `buildAdapter` in `registry.ts`, defaulting to `undefined`.

- [ ] **Step 5: Add the adapter regression test**

Append to `apps/api/test/qbittorrentMaindataSync.test.ts`:

```ts
import { buildAdapter } from "@rawkoon/api/services/downloadClient/registry";
import { getMaindataState } from "@rawkoon/api/services/qbittorrent/clientSession";

describe("qbittorrent adapter reuses the cursor", () => {
  beforeEach(() => {
    resetMaindataState();
    setLastMaindataSnapshot(null);
  });

  it("does not reset the cursor between listTorrents calls", async () => {
    const f = recordingFetcher([
      { rid: 7, full_update: true, torrents: { aaa: { progress: 0.1 } } },
      { rid: 11, torrents: { aaa: { progress: 0.2 } } },
    ]);
    const adapter = buildAdapter("qbittorrent", config, {
      maindata: { fetchJson: f.fetchJson },
    });

    await adapter.listTorrents();
    setLastMaindataSnapshot(null);
    await adapter.listTorrents();

    expect(f.paths).toEqual([
      "/api/v2/sync/maindata?rid=0",
      "/api/v2/sync/maindata?rid=7",
    ]);
    expect(getMaindataState()?.rid).toBe(11);
  });

  it("getTorrent returns the matching entry from a multi-torrent projection", async () => {
    const f = recordingFetcher([
      {
        rid: 1,
        full_update: true,
        torrents: {
          AAA: { name: "first" },
          bbb: { name: "second" },
          ccc: { name: "third" },
        },
      },
    ]);
    const adapter = buildAdapter("qbittorrent", config, {
      maindata: { fetchJson: f.fetchJson },
    });

    const found = await adapter.getTorrent("aaa");

    expect(found?.hash.toLowerCase()).toBe("aaa");
  });
});
```

- [ ] **Step 6: Run the full API suite**

```bash
cd apps/api && bun test
```

Expected: PASS, including the pre-existing `reconcilePendingDownloads.test.ts`, `completeDownloadByHash.test.ts`, `downloadClientRegistry.test.ts`, `downloadClientRoutes.test.ts`.

- [ ] **Step 7: Typecheck, lint, commit**

```bash
cd /home/samuelloranger/sites/rawkoon
bun run typecheck && bun run typecheck:native && bun run lint && bun run format
git add apps/api/src/services/qbittorrent/clientFetch.ts \
        apps/api/src/services/downloadClient/qbittorrentAdapter.ts \
        apps/api/src/services/downloadClient/registry.ts \
        apps/api/test/qbittorrentMaindataSync.test.ts
git commit -m "fix: preserve the qBittorrent sync revision between list calls"
```

---

### Task 2: Schema and settings columns

**Files:**
- Modify: `apps/api/prisma/schema.prisma:528-550` (`MediaSettings`)
- Create: `apps/api/prisma/migrations/<timestamp>_download_completion_hook/migration.sql`

**Interfaces:**
- Consumes: nothing.
- Produces: `MediaSettings` fields `downloadHookToken: string | null`, `downloadHookCallbackUrl: string | null`, `downloadHookAutoConfigure: boolean`, `downloadHookLastSeenAt: Date | null`, `downloadPollActiveHookedSecs: number`. Tasks 3, 4, 5, 6, 8 all read these.

- [ ] **Step 1: Add the fields**

In `apps/api/prisma/schema.prisma`, inside `model MediaSettings`, immediately after the `downloadMaxAgeSecs` line:

```prisma
  downloadHookToken            String?   @map("download_hook_token")
  downloadHookCallbackUrl      String?   @map("download_hook_callback_url")
  downloadHookAutoConfigure    Boolean   @default(true) @map("download_hook_auto_configure")
  downloadHookLastSeenAt       DateTime? @map("download_hook_last_seen_at")
  downloadPollActiveHookedSecs Int       @default(120) @map("download_poll_active_hooked_secs")
```

- [ ] **Step 2: Generate the migration**

```bash
cd /home/samuelloranger/sites/rawkoon
bun run dev:services
bun run db:migrate:dev --name download_completion_hook
```

If this errors with "DATABASE_URL not found", the root `.env` is missing — every `db:*` script sources it via `set -a && . ../../.env`.

- [ ] **Step 3: Verify the generated SQL**

```bash
cat apps/api/prisma/migrations/*_download_completion_hook/migration.sql
```

Expected: five `ALTER TABLE "media_settings" ADD COLUMN` statements, with `DEFAULT true` on `download_hook_auto_configure` and `DEFAULT 120` on `download_poll_active_hooked_secs`. No `DROP` statements — if you see one, the schema drifted and you must stop and investigate rather than apply it.

- [ ] **Step 4: Confirm the client regenerated**

```bash
cd /home/samuelloranger/sites/rawkoon && bun run typecheck
```

Expected: PASS. `db:migrate:dev` runs `prisma generate`; if the new fields are not on the type, run `bun run db:generate`.

- [ ] **Step 5: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations
git commit -m "feat: add download completion hook settings columns"
```

---

### Task 3: Hook token service

**Files:**
- Create: `apps/api/src/services/downloadClient/hookToken.ts`
- Test: `apps/api/test/downloadHookToken.test.ts` (create)

**Interfaces:**
- Consumes: `MediaSettings.downloadHookToken` from Task 2; `encrypt`/`decrypt` from `apps/api/src/services/crypto.ts`.
- Produces:
  - `generateHookToken(): string` — 32 random bytes, base64url.
  - `tokensMatch(provided: string, expected: string): boolean` — constant-time.
  - `getOrCreateHookToken(): Promise<string>` — plaintext token, creating and persisting one on first call.
  - `rotateHookToken(): Promise<string>` — new plaintext token, persisted.
  - `verifyHookToken(provided: string | null): Promise<boolean>` — false when no token is configured or none was provided.

  Task 5 calls `verifyHookToken`. Tasks 6, 7, 8 call `getOrCreateHookToken`. Task 8 calls `rotateHookToken`.

**Background:** `crypto.ts` exports `encrypt(text): string`, `decrypt(text): string`, and `DecryptError`. `decrypt` throws on tampered or key-mismatched input — `downloadClient/config.ts:31-41` shows the established handling: catch, log, and treat the value as unconfigured rather than crashing.

`timingSafeEqual` throws when the two buffers differ in length, so length must be compared first — and that comparison is deliberately not constant-time, which is fine because token length is not a secret.

- [ ] **Step 1: Write the failing test**

Create `apps/api/test/downloadHookToken.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import {
  generateHookToken,
  tokensMatch,
} from "@rawkoon/api/services/downloadClient/hookToken";

describe("generateHookToken", () => {
  it("produces a url-safe token of stable length", () => {
    const token = generateHookToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(token.length).toBeGreaterThanOrEqual(43);
  });

  it("produces a different token each call", () => {
    expect(generateHookToken()).not.toBe(generateHookToken());
  });
});

describe("tokensMatch", () => {
  it("accepts an identical token", () => {
    const token = generateHookToken();
    expect(tokensMatch(token, token)).toBe(true);
  });

  it("rejects a different token of the same length", () => {
    const a = generateHookToken();
    const b = generateHookToken();
    expect(tokensMatch(a, b)).toBe(false);
  });

  it("rejects a token of a different length without throwing", () => {
    const token = generateHookToken();
    expect(tokensMatch("short", token)).toBe(false);
  });

  it("rejects an empty provided token", () => {
    expect(tokensMatch("", generateHookToken())).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd apps/api && bun test test/downloadHookToken.test.ts
```

Expected: FAIL — cannot resolve `@rawkoon/api/services/downloadClient/hookToken`.

- [ ] **Step 3: Implement the service**

Create `apps/api/src/services/downloadClient/hookToken.ts`:

```ts
import { randomBytes, timingSafeEqual } from "node:crypto";
import { prisma } from "@rawkoon/api/db";
import { decrypt, encrypt } from "@rawkoon/api/services/crypto";

/** 32 random bytes, base64url — safe to paste into a shell command unquoted. */
export function generateHookToken(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * Constant-time token comparison.
 *
 * The length check is deliberately not constant-time: `timingSafeEqual` throws
 * on mismatched buffer lengths, and a token's length is not a secret.
 */
export function tokensMatch(provided: string, expected: string): boolean {
  if (!provided || !expected) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

const readStoredToken = async (): Promise<string | null> => {
  const settings = await prisma.mediaSettings.findUnique({
    where: { id: 1 },
    select: { downloadHookToken: true },
  });
  const stored = settings?.downloadHookToken;
  if (!stored) return null;
  try {
    return decrypt(stored);
  } catch (error) {
    // Same posture as downloadClient/config.ts: an undecryptable secret means
    // "unconfigured", not "crash". A rotation re-establishes it.
    console.error(
      `[download-hook] failed to decrypt hook token — treating as unconfigured until rotated: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return null;
  }
};

const persistToken = async (plaintext: string): Promise<void> => {
  await prisma.mediaSettings.update({
    where: { id: 1 },
    data: { downloadHookToken: encrypt(plaintext) },
  });
};

/** The current token, creating and persisting one on first use. */
export async function getOrCreateHookToken(): Promise<string> {
  const existing = await readStoredToken();
  if (existing) return existing;
  const token = generateHookToken();
  await persistToken(token);
  return token;
}

/** Replace the token. Callers must re-run client auto-configuration after this. */
export async function rotateHookToken(): Promise<string> {
  const token = generateHookToken();
  await persistToken(token);
  return token;
}

/** False when no token is configured or none was provided. */
export async function verifyHookToken(
  provided: string | null,
): Promise<boolean> {
  if (!provided) return false;
  const expected = await readStoredToken();
  if (!expected) return false;
  return tokensMatch(provided, expected);
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd apps/api && bun test test/downloadHookToken.test.ts
```

Expected: PASS, all six cases. The pure functions need no database; `getOrCreateHookToken` and friends are covered end-to-end in Task 5.

- [ ] **Step 5: Commit**

```bash
cd /home/samuelloranger/sites/rawkoon
bun run typecheck && bun run lint && bun run format
git add apps/api/src/services/downloadClient/hookToken.ts apps/api/test/downloadHookToken.test.ts
git commit -m "feat: add download client hook token service"
```

---

### Task 4: Immediate-poll seam and hook-aware cadence

**Files:**
- Modify: `apps/api/src/workers/checkDownloadCompletion.ts` (`pollState` at :144, `checkDownloadCompletion` at :336-371)
- Test: `apps/api/test/reconcilePendingDownloads.test.ts` (extend)

**Interfaces:**
- Consumes: `MediaSettings.downloadHookLastSeenAt` and `downloadPollActiveHookedSecs` from Task 2.
- Produces:
  - `requestImmediatePoll(): void` — clears the poll gate.
  - `selectActiveCadenceSecs(input: { hookLastSeenAt: Date | null; nowMs: number; activeSecs: number; hookedActiveSecs: number }): number` — exported pure function.

  Task 5 calls `requestImmediatePoll`.

**Background the implementer needs:**

`pollState` is module-private (`checkDownloadCompletion.ts:144`), so the hook route cannot reach it. That is what `requestImmediatePoll` is for.

**The ordering is load-bearing.** `checkDownloadCompletion()` returns early at line 353 when `nowMs < pollState.nextPollAtMs`. An ad-hoc job enqueued while that gate is still closed does nothing at all. The gate must be cleared *before* the job is enqueued — Task 5 depends on this.

The cadence today is already adaptive, which is easy to miss: zero pending rows sleeps `downloadPollIdleSecs` (1800) without contacting the client, a newly-appeared pending row bypasses the timer entirely, and `computeNextPollDelaySecs` backs off via `idlePasses`. This task changes only *which* active interval feeds that existing machinery.

- [ ] **Step 1: Write the failing test**

Append to `apps/api/test/reconcilePendingDownloads.test.ts`:

```ts
import { selectActiveCadenceSecs } from "@rawkoon/api/workers/checkDownloadCompletion";

describe("selectActiveCadenceSecs", () => {
  const nowMs = 1_800_000_000_000;
  const base = { nowMs, activeSecs: 20, hookedActiveSecs: 120 };

  it("uses the fast cadence when no hook has ever been received", () => {
    expect(selectActiveCadenceSecs({ ...base, hookLastSeenAt: null })).toBe(20);
  });

  it("uses the slow cadence when a hook arrived recently", () => {
    expect(
      selectActiveCadenceSecs({
        ...base,
        hookLastSeenAt: new Date(nowMs - 60_000),
      }),
    ).toBe(120);
  });

  it("falls back to the fast cadence once the hook goes quiet for a day", () => {
    expect(
      selectActiveCadenceSecs({
        ...base,
        hookLastSeenAt: new Date(nowMs - 25 * 60 * 60 * 1000),
      }),
    ).toBe(20);
  });

  it("treats a hook exactly at the window edge as stale", () => {
    expect(
      selectActiveCadenceSecs({
        ...base,
        hookLastSeenAt: new Date(nowMs - 24 * 60 * 60 * 1000),
      }),
    ).toBe(20);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd apps/api && bun test test/reconcilePendingDownloads.test.ts
```

Expected: FAIL — `selectActiveCadenceSecs` is not exported.

- [ ] **Step 3: Implement both exports**

In `apps/api/src/workers/checkDownloadCompletion.ts`, add near the top-level declarations (after `const pollState = createReconcileState();` at line 144):

```ts
/** How long a received hook keeps the slow cadence in effect. */
export const HOOK_RECENT_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Clear the poll gate so the next `checkDownloadCompletion()` runs immediately.
 *
 * Callers MUST invoke this *before* enqueuing the check job: the job returns
 * early while the gate is closed, so enqueuing first makes the wake a no-op.
 */
export function requestImmediatePoll(): void {
  pollState.nextPollAtMs = 0;
}

/**
 * Pick the active poll interval.
 *
 * A hook that has gone quiet — never configured, broken, or pointing at a stale
 * token — yields the unhooked interval, so a silently broken hook can never make
 * detection slower than it was before hooks existed.
 */
export function selectActiveCadenceSecs(input: {
  hookLastSeenAt: Date | null;
  nowMs: number;
  activeSecs: number;
  hookedActiveSecs: number;
}): number {
  const { hookLastSeenAt, nowMs, activeSecs, hookedActiveSecs } = input;
  if (!hookLastSeenAt) return activeSecs;
  const age = nowMs - hookLastSeenAt.getTime();
  if (age < 0 || age >= HOOK_RECENT_WINDOW_MS) return activeSecs;
  return hookedActiveSecs;
}
```

Then in `checkDownloadCompletion()`, replace the `computeNextPollDelaySecs` call (line 362) so it receives the selected interval instead of the raw setting:

```ts
  const activeSecs = selectActiveCadenceSecs({
    hookLastSeenAt: settings?.downloadHookLastSeenAt ?? null,
    nowMs,
    activeSecs: settings?.downloadPollActiveSecs ?? 20,
    hookedActiveSecs: settings?.downloadPollActiveHookedSecs ?? 120,
  });
  const delaySecs = computeNextPollDelaySecs(
    pollState.lastReconcileHadActive,
    activeSecs,
    settings?.downloadPollIdleSecs ?? 1800,
    pollState.idlePasses,
  );
```

The `settings` variable is already in scope from line 340. Do not add another query.

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd apps/api && bun test test/reconcilePendingDownloads.test.ts
```

Expected: PASS — the four new cases plus every pre-existing case in the file.

- [ ] **Step 5: Commit**

```bash
cd /home/samuelloranger/sites/rawkoon
bun run typecheck && bun run typecheck:native && bun run lint && bun run format
git add apps/api/src/workers/checkDownloadCompletion.ts apps/api/test/reconcilePendingDownloads.test.ts
git commit -m "feat: hook-aware download poll cadence and immediate-poll seam"
```

---

### Task 5: Hook endpoint

**Files:**
- Create: `apps/api/src/routes/integrations/downloadClient/hookRoutes.ts`
- Modify: `apps/api/src/index.ts`
- Test: `apps/api/test/downloadHookRoutes.test.ts` (create)

**Interfaces:**
- Consumes: `verifyHookToken` (Task 3), `requestImmediatePoll` (Task 4), `MediaSettings.downloadHookLastSeenAt` (Task 2).
- Produces:
  - `handleCompletionHook(input: { token: string | null; hash: string | null }, deps: HookDeps): Promise<{ status: number; body: unknown }>` — the pure decision function.
  - `type HookDeps = { verifyToken: (t: string | null) => Promise<boolean>; hasPendingForHash: (hash: string) => Promise<boolean>; stampHookSeen: () => Promise<void>; wake: () => Promise<void> }`
  - `downloadClientHookRoutes` — the Elysia instance.

**Background the implementer needs:**

This router must **not** be mounted under `integrationsRoutes`, which applies `requireAdmin` (`routes/integrations/downloadClient/index.ts:60`). The caller is a container with no session and no cookie.

It carries its own rate limiter rather than relying on `globalRateLimit`, whose `skip` performs a better-auth session lookup on every request — pointless here, and 1000/hour is the wrong budget for this endpoint.

`rateLimit` comes from `elysia-rate-limit`; copy the `generator` from `middleware/rateLimit.ts:26` so the key is the client IP behind a proxy.

The token check must precede all database work so an unauthenticated flood costs one decrypt rather than a query.

Return `202` on every accepted request, including the "hash I don't own" case, and keep the body minimal. Use `apps/api/src/errors.ts` helpers for 401/400 — return them, never throw.

The decision logic is extracted into `handleCompletionHook` with injected deps so it is testable without a live database or HTTP server, per the no-module-mocking constraint.

- [ ] **Step 1: Write the failing test**

Create `apps/api/test/downloadHookRoutes.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { handleCompletionHook } from "@rawkoon/api/routes/integrations/downloadClient/hookRoutes";

const VALID = "a".repeat(40);

function deps(over: {
  tokenOk?: boolean;
  pending?: boolean;
} = {}) {
  const calls = { stamped: 0, woke: 0 };
  return {
    calls,
    deps: {
      verifyToken: () => Promise.resolve(over.tokenOk ?? true),
      hasPendingForHash: () => Promise.resolve(over.pending ?? true),
      stampHookSeen: () => {
        calls.stamped++;
        return Promise.resolve();
      },
      wake: () => {
        calls.woke++;
        return Promise.resolve();
      },
    },
  };
}

describe("handleCompletionHook", () => {
  it("rejects a bad token with 401 and touches nothing", async () => {
    const d = deps({ tokenOk: false });
    const res = await handleCompletionHook({ token: "nope", hash: VALID }, d.deps);
    expect(res.status).toBe(401);
    expect(d.calls).toEqual({ stamped: 0, woke: 0 });
  });

  it("rejects a missing token with 401", async () => {
    const d = deps({ tokenOk: false });
    const res = await handleCompletionHook({ token: null, hash: VALID }, d.deps);
    expect(res.status).toBe(401);
  });

  it("rejects a malformed hash with 400 after auth", async () => {
    const d = deps();
    const res = await handleCompletionHook({ token: "t", hash: "zzz" }, d.deps);
    expect(res.status).toBe(400);
    expect(d.calls.woke).toBe(0);
  });

  it("accepts a 40-hex hash and wakes the poller", async () => {
    const d = deps();
    const res = await handleCompletionHook({ token: "t", hash: VALID }, d.deps);
    expect(res.status).toBe(202);
    expect(d.calls).toEqual({ stamped: 1, woke: 1 });
  });

  it("accepts a 64-hex v2 hash", async () => {
    const d = deps();
    const res = await handleCompletionHook(
      { token: "t", hash: "b".repeat(64) },
      d.deps,
    );
    expect(res.status).toBe(202);
    expect(d.calls.woke).toBe(1);
  });

  it("stamps but does not wake for a hash Rawkoon does not own", async () => {
    const d = deps({ pending: false });
    const res = await handleCompletionHook({ token: "t", hash: VALID }, d.deps);
    expect(res.status).toBe(202);
    expect(d.calls).toEqual({ stamped: 1, woke: 0 });
  });

  it("wakes without a hash filter when no hash is supplied", async () => {
    const d = deps({ pending: false });
    const res = await handleCompletionHook({ token: "t", hash: null }, d.deps);
    expect(res.status).toBe(202);
    expect(d.calls).toEqual({ stamped: 1, woke: 1 });
  });

  it("accepts an uppercase hash", async () => {
    const d = deps();
    const res = await handleCompletionHook(
      { token: "t", hash: "A".repeat(40) },
      d.deps,
    );
    expect(res.status).toBe(202);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd apps/api && bun test test/downloadHookRoutes.test.ts
```

Expected: FAIL — cannot resolve the module.

- [ ] **Step 3: Implement the route module**

Create `apps/api/src/routes/integrations/downloadClient/hookRoutes.ts`:

```ts
import { Elysia, t } from "elysia";
import { rateLimit } from "elysia-rate-limit";
import { prisma } from "@rawkoon/api/db";
import { badRequest, unauthorized } from "@rawkoon/api/errors";
import { verifyHookToken } from "@rawkoon/api/services/downloadClient/hookToken";
import { scheduledTasksQueue, SCHEDULED_JOB_NAMES } from "@rawkoon/api/services/queueService";
import { requestImmediatePoll } from "@rawkoon/api/workers/checkDownloadCompletion";

const HASH_PATTERN = /^(?:[0-9a-fA-F]{40}|[0-9a-fA-F]{64})$/;

export type HookDeps = {
  verifyToken: (token: string | null) => Promise<boolean>;
  hasPendingForHash: (hash: string) => Promise<boolean>;
  stampHookSeen: () => Promise<void>;
  wake: () => Promise<void>;
};

/**
 * Decide what a completion hook should do.
 *
 * Wake-signal semantics: this never completes a download. It asks the reconcile
 * loop to run now, and that loop confirms completion against the client. So a
 * replayed or duplicated hook is a redundant reconcile pass, not a double import.
 */
export async function handleCompletionHook(
  input: { token: string | null; hash: string | null },
  deps: HookDeps,
): Promise<{ status: number; body: unknown }> {
  if (!(await deps.verifyToken(input.token))) {
    return { status: 401, body: { error: "Unauthorized" } };
  }

  if (input.hash != null && !HASH_PATTERN.test(input.hash)) {
    return { status: 400, body: { error: "Invalid torrent hash" } };
  }

  // Stamped even for torrents Rawkoon does not own: an unrelated torrent
  // finishing still proves the hook is wired up and reachable.
  await deps.stampHookSeen();

  if (input.hash) {
    const owned = await deps.hasPendingForHash(input.hash.toLowerCase());
    if (!owned) return { status: 202, body: { accepted: true, matched: false } };
  }

  await deps.wake();
  return { status: 202, body: { accepted: true, matched: true } };
}

const liveDeps: HookDeps = {
  verifyToken: verifyHookToken,
  hasPendingForHash: async (hash) => {
    const row = await prisma.downloadHistory.findFirst({
      where: { torrentHash: hash, completedAt: null, failed: false },
      select: { id: true },
    });
    return row !== null;
  },
  stampHookSeen: async () => {
    // upsert, not update: nothing seeds media_settings row 1, so `update`
    // throws P2025 on a fresh install. See indexerManager/factory.ts:18.
    const downloadHookLastSeenAt = new Date();
    await prisma.mediaSettings.upsert({
      where: { id: 1 },
      update: { downloadHookLastSeenAt },
      create: { id: 1, downloadHookLastSeenAt },
    });
  },
  wake: async () => {
    // Order is load-bearing: checkDownloadCompletion() returns early while the
    // poll gate is closed, so clearing it must happen before the job is queued.
    requestImmediatePoll();
    await scheduledTasksQueue.add(
      SCHEDULED_JOB_NAMES.CHECK_LIBRARY_DOWNLOAD_COMPLETION,
      {},
    );
  },
};

export const downloadClientHookRoutes = new Elysia({
  prefix: "/api/download-client",
})
  .use(
    rateLimit({
      duration: 60 * 1000,
      max: 120,
      generator: (req) =>
        `hook:${req.headers.get("x-forwarded-for")?.split(",")[0].trim() || req.headers.get("x-real-ip") || "unknown"}`,
      errorResponse: "Too many requests. Please try again later.",
    }),
  )
  .post(
    "/hook/complete",
    async ({ headers, query, set }) => {
      const result = await handleCompletionHook(
        {
          token: headers["x-rawkoon-token"] ?? null,
          hash: query.hash ?? null,
        },
        liveDeps,
      );
      if (result.status === 401) return unauthorized(set);
      if (result.status === 400) return badRequest(set, "Invalid torrent hash");
      set.status = 202;
      return result.body;
    },
    { query: t.Object({ hash: t.Optional(t.String()) }) },
  );
```

Check the exact signatures of `unauthorized` and `badRequest` in `apps/api/src/errors.ts` before writing this — match them rather than assuming the argument order above.

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd apps/api && bun test test/downloadHookRoutes.test.ts
```

Expected: PASS, all eight cases.

- [ ] **Step 5: Mount the router**

In `apps/api/src/index.ts`, add the import alongside the other route imports and `.use()` it in the chain **before** `.use(globalRateLimit)` (line 117), so the hook is not subject to the global limiter's session lookup:

```ts
  .use(downloadClientHookRoutes)
```

- [ ] **Step 6: Verify the endpoint is reachable and rejects anonymous callers**

```bash
cd /home/samuelloranger/sites/rawkoon && bun run dev:api
```

In another shell:

```bash
curl -i -X POST "http://localhost:3000/api/download-client/hook/complete?hash=$(printf 'a%.0s' {1..40})"
```

Expected: `HTTP/1.1 401`. A `404` means the router was not mounted; a `403` means it landed behind `requireAdmin` and must be moved out of `integrationsRoutes`.

- [ ] **Step 7: Commit**

```bash
cd /home/samuelloranger/sites/rawkoon
bun run typecheck && bun run typecheck:native && bun run lint && bun run format
git add apps/api/src/routes/integrations/downloadClient/hookRoutes.ts \
        apps/api/src/index.ts apps/api/test/downloadHookRoutes.test.ts
git commit -m "feat: add download client completion hook endpoint"
```

---

### Task 6: qBittorrent autorun auto-configuration

**Files:**
- Create: `apps/api/src/services/qbittorrent/preferences.ts`
- Test: `apps/api/test/qbittorrentAutorun.test.ts` (create)

**Interfaces:**
- Consumes: `qbFetchJson` and `qbFetchText` from `clientFetch.ts`; the command string from Task 7 is passed in as an argument, so Task 6 and Task 7 can be built in either order.
- Produces:
  - `decideAutorunUpdate(input: { current: string | null; desired: string; hookPath: string }): { action: "write" | "skip-foreign" | "noop"; program: string }`
  - `getQbittorrentPreferences(config): Promise<Record<string, unknown>>`
  - `applyQbittorrentAutorun(config, desiredCommand, hookPath): Promise<{ action: "write" | "skip-foreign" | "noop" }>`

  Task 8 calls `applyQbittorrentAutorun`.

**Background the implementer needs:**

**Verify the preference key names before implementing.** They are expected to be `autorun_enabled` and `autorun_program`, but the naming shifted across qBittorrent 4.x and 5.x. `GET /api/v2/app/preferences` returns the full set and is self-documenting:

```bash
curl -s -b cookies.txt "http://localhost:8080/api/v2/app/preferences" | jq 'keys | map(select(startswith("autorun")))'
```

Use whatever that returns. If the keys differ from the names below, use the real ones and note it in the commit message.

**The token must go in the request body, never the query string.** `setPreferences` accepts a `json=<urlencoded>` form field, so the body is natural. This matters because `logQbittorrentRequest` persists `requestPath` (`${pathname}${search}`) and `meta.query` (built from `url.searchParams` at `clientFetch.ts:33`) into `qbittorrent_request_logs`. No log site records a request body, so the body is safe and no redaction work is needed.

Never overwrite a program the user wrote. Ownership is detected by the presence of our hook path in the existing string — no separate marker is needed, and that also makes rewrites idempotent.

- [ ] **Step 1: Write the failing test**

Create `apps/api/test/qbittorrentAutorun.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { decideAutorunUpdate } from "@rawkoon/api/services/qbittorrent/preferences";

const HOOK_PATH = "/api/download-client/hook/complete";
const desired = `curl -fsS -m 10 -X POST -H "X-Rawkoon-Token: tok" "http://rawkoon:3000${HOOK_PATH}?hash=%I"`;

describe("decideAutorunUpdate", () => {
  it("writes when no program is configured", () => {
    const r = decideAutorunUpdate({ current: null, desired, hookPath: HOOK_PATH });
    expect(r.action).toBe("write");
    expect(r.program).toBe(desired);
  });

  it("writes when the program is blank whitespace", () => {
    const r = decideAutorunUpdate({ current: "   ", desired, hookPath: HOOK_PATH });
    expect(r.action).toBe("write");
  });

  it("rewrites its own stale command, e.g. after a token rotation", () => {
    const stale = `curl -fsS -m 10 -X POST -H "X-Rawkoon-Token: OLD" "http://rawkoon:3000${HOOK_PATH}?hash=%I"`;
    const r = decideAutorunUpdate({ current: stale, desired, hookPath: HOOK_PATH });
    expect(r.action).toBe("write");
    expect(r.program).toBe(desired);
  });

  it("is a noop when the command already matches exactly", () => {
    const r = decideAutorunUpdate({ current: desired, desired, hookPath: HOOK_PATH });
    expect(r.action).toBe("noop");
  });

  it("never overwrites a program the user wrote", () => {
    const foreign = "/usr/local/bin/my-own-script.sh %I";
    const r = decideAutorunUpdate({ current: foreign, desired, hookPath: HOOK_PATH });
    expect(r.action).toBe("skip-foreign");
    expect(r.program).toBe(foreign);
  });
});

describe("token containment", () => {
  it("keeps the token out of the hook URL query string", () => {
    const url = new URL(desired.match(/"(https?:\/\/[^"]+)"/)![1]);
    expect(url.search).toBe("?hash=%I");
    expect(url.search).not.toContain("tok");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd apps/api && bun test test/qbittorrentAutorun.test.ts
```

Expected: FAIL — cannot resolve the module.

- [ ] **Step 3: Implement the preferences service**

Create `apps/api/src/services/qbittorrent/preferences.ts`:

```ts
import { qbFetchJson, qbFetchText } from "./clientFetch";
import type { QbittorrentIntegrationConfig } from "./clientTypes";
import { toStringOrNull } from "./clientNormalizers";

/** Confirm these against a live GET /api/v2/app/preferences before shipping. */
const AUTORUN_ENABLED_KEY = "autorun_enabled";
const AUTORUN_PROGRAM_KEY = "autorun_program";

export type AutorunDecision = {
  action: "write" | "skip-foreign" | "noop";
  program: string;
};

/**
 * Decide whether we may write our autorun command.
 *
 * Ownership is detected by our hook path appearing in the existing string. That
 * doubles as the idempotency marker: our own stale command (say, after a token
 * rotation) is ours to replace, but anything else belongs to the user and is
 * left alone.
 */
export function decideAutorunUpdate(input: {
  current: string | null;
  desired: string;
  hookPath: string;
}): AutorunDecision {
  const current = input.current?.trim() ?? "";
  if (!current) return { action: "write", program: input.desired };
  if (current === input.desired.trim())
    return { action: "noop", program: current };
  if (current.includes(input.hookPath))
    return { action: "write", program: input.desired };
  return { action: "skip-foreign", program: current };
}

export async function getQbittorrentPreferences(
  config: QbittorrentIntegrationConfig,
): Promise<Record<string, unknown>> {
  return await qbFetchJson<Record<string, unknown>>(
    config,
    "/api/v2/app/preferences",
  );
}

/**
 * Reconcile qBittorrent's autorun command with ours.
 *
 * The payload goes in the request body, never the query string: request bodies
 * are never logged, but `requestPath` and `meta.query` are persisted to
 * qbittorrent_request_logs, and the command contains the hook token.
 */
export async function applyQbittorrentAutorun(
  config: QbittorrentIntegrationConfig,
  desiredCommand: string,
  hookPath: string,
): Promise<{ action: AutorunDecision["action"] }> {
  const prefs = await getQbittorrentPreferences(config);
  const decision = decideAutorunUpdate({
    current: toStringOrNull(prefs[AUTORUN_PROGRAM_KEY]),
    desired: desiredCommand,
    hookPath,
  });

  if (decision.action === "skip-foreign") return { action: decision.action };

  const alreadyEnabled = prefs[AUTORUN_ENABLED_KEY] === true;
  if (decision.action === "noop" && alreadyEnabled)
    return { action: "noop" };

  const body = new URLSearchParams({
    json: JSON.stringify({
      [AUTORUN_ENABLED_KEY]: true,
      [AUTORUN_PROGRAM_KEY]: decision.program,
    }),
  });

  await qbFetchText(config, "/api/v2/app/setPreferences", {
    method: "POST",
    body,
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });

  return { action: "write" };
}
```

Verify `toStringOrNull` is exported from `clientNormalizers.ts` — `downloadClient/config.ts:10` imports it from there, so it is, but confirm the import path style matches the other files in `services/qbittorrent/`.

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd apps/api && bun test test/qbittorrentAutorun.test.ts
```

Expected: PASS, all six cases.

- [ ] **Step 5: Commit**

```bash
cd /home/samuelloranger/sites/rawkoon
bun run typecheck && bun run typecheck:native && bun run lint && bun run format
git add apps/api/src/services/qbittorrent/preferences.ts apps/api/test/qbittorrentAutorun.test.ts
git commit -m "feat: reconcile qBittorrent autorun command for completion hooks"
```

---

### Task 7: Hook command and script generators

**Files:**
- Create: `apps/api/src/services/downloadClient/hookCommands.ts`
- Test: `apps/api/test/downloadHookCommands.test.ts` (create)

**Interfaces:**
- Consumes: nothing — pure functions, no I/O.
- Produces:
  - `HOOK_PATH = "/api/download-client/hook/complete"`
  - `buildQbittorrentCommand(input: { baseUrl: string; token: string }): string`
  - `buildDelugeScript(input: { baseUrl: string; token: string }): string`
  - `buildTransmissionScript(input: { baseUrl: string; token: string }): string`

  Task 8 calls all four.

**Background the implementer needs:**

qBittorrent parses its autorun command itself rather than handing it to a shell, so the command must be a plain argv with no shell metacharacters, pipes, or substitutions. `%I` is qBittorrent's info-hash substitution.

Deluge's bundled Execute plugin and Transmission's `script-torrent-done-filename` both take a *path to an executable file*, not an inline command — hence scripts rather than one-liners for those two. Deluge's Execute passes `torrent_id`, `torrent_name`, `torrent_path` as `$1 $2 $3`, and a Deluge torrent id *is* the info hash. Transmission exposes `TR_TORRENT_HASH` in the environment.

Trailing slashes in `baseUrl` must be stripped, matching `downloadClient/config.ts:48` (`websiteUrl.replace(/\/+$/, "")`).

- [ ] **Step 1: Write the failing test**

Create `apps/api/test/downloadHookCommands.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import {
  buildDelugeScript,
  buildQbittorrentCommand,
  buildTransmissionScript,
  HOOK_PATH,
} from "@rawkoon/api/services/downloadClient/hookCommands";

const input = { baseUrl: "http://rawkoon:3000", token: "TOKEN123" };

describe("buildQbittorrentCommand", () => {
  it("substitutes the info hash with %I and carries the token in a header", () => {
    const cmd = buildQbittorrentCommand(input);
    expect(cmd).toContain(`http://rawkoon:3000${HOOK_PATH}?hash=%I`);
    expect(cmd).toContain('-H "X-Rawkoon-Token: TOKEN123"');
  });

  it("strips a trailing slash from the base URL", () => {
    const cmd = buildQbittorrentCommand({ ...input, baseUrl: "http://rawkoon:3000/" });
    expect(cmd).toContain("http://rawkoon:3000/api/download-client");
    expect(cmd).not.toContain("3000//api");
  });

  it("keeps the token out of the query string", () => {
    const cmd = buildQbittorrentCommand(input);
    const url = new URL(cmd.match(/"(https?:\/\/[^"]+)"/)![1]);
    expect(url.search).toBe("?hash=%I");
  });

  it("uses no shell metacharacters, since qBittorrent does not use a shell", () => {
    const cmd = buildQbittorrentCommand(input);
    expect(cmd).not.toMatch(/[|;&><$`]/);
  });
});

describe("buildDelugeScript", () => {
  it("reads the info hash from the Execute plugin's first argument", () => {
    const script = buildDelugeScript(input);
    expect(script.startsWith("#!/bin/sh")).toBe(true);
    expect(script).toContain('hash="$1"');
    expect(script).toContain("X-Rawkoon-Token: TOKEN123");
    expect(script).toContain(`${HOOK_PATH}?hash=`);
  });
});

describe("buildTransmissionScript", () => {
  it("reads the info hash from TR_TORRENT_HASH", () => {
    const script = buildTransmissionScript(input);
    expect(script.startsWith("#!/bin/sh")).toBe(true);
    expect(script).toContain("$TR_TORRENT_HASH");
    expect(script).toContain("X-Rawkoon-Token: TOKEN123");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd apps/api && bun test test/downloadHookCommands.test.ts
```

Expected: FAIL — cannot resolve the module.

- [ ] **Step 3: Implement the generators**

Create `apps/api/src/services/downloadClient/hookCommands.ts`:

```ts
/** The endpoint every client hook posts to. Also the autorun ownership marker. */
export const HOOK_PATH = "/api/download-client/hook/complete";

const normalizeBase = (baseUrl: string) => baseUrl.replace(/\/+$/, "");

/**
 * qBittorrent's "run external program on torrent finished" command.
 *
 * qBittorrent parses this argv itself rather than invoking a shell, so it must
 * contain no shell metacharacters. `%I` is its info-hash substitution.
 */
export function buildQbittorrentCommand(input: {
  baseUrl: string;
  token: string;
}): string {
  const url = `${normalizeBase(input.baseUrl)}${HOOK_PATH}?hash=%I`;
  return `curl -fsS -m 10 -X POST -H "X-Rawkoon-Token: ${input.token}" "${url}"`;
}

/**
 * Script for Deluge's bundled Execute plugin ("Torrent Complete").
 *
 * Execute takes an executable path, not an inline command, and passes
 * torrent_id, torrent_name, torrent_path as $1 $2 $3. A Deluge torrent id is
 * the info hash.
 */
export function buildDelugeScript(input: {
  baseUrl: string;
  token: string;
}): string {
  const base = normalizeBase(input.baseUrl);
  return `#!/bin/sh
# Rawkoon download completion hook (Deluge Execute plugin)
hash="$1"
curl -fsS -m 10 -X POST \\
  -H "X-Rawkoon-Token: ${input.token}" \\
  "${base}${HOOK_PATH}?hash=$hash"
`;
}

/**
 * Script for Transmission's `script-torrent-done-filename`.
 *
 * Transmission exposes the info hash as TR_TORRENT_HASH in the environment.
 */
export function buildTransmissionScript(input: {
  baseUrl: string;
  token: string;
}): string {
  const base = normalizeBase(input.baseUrl);
  return `#!/bin/sh
# Rawkoon download completion hook (Transmission script-torrent-done)
curl -fsS -m 10 -X POST \\
  -H "X-Rawkoon-Token: ${input.token}" \\
  "${base}${HOOK_PATH}?hash=$TR_TORRENT_HASH"
`;
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd apps/api && bun test test/downloadHookCommands.test.ts
```

Expected: PASS, all six cases.

- [ ] **Step 5: Commit**

```bash
cd /home/samuelloranger/sites/rawkoon
bun run typecheck && bun run typecheck:native && bun run lint && bun run format
git add apps/api/src/services/downloadClient/hookCommands.ts apps/api/test/downloadHookCommands.test.ts
git commit -m "feat: generate per-client download completion hook commands"
```

---

### Task 8: Hook settings API surface

**Files:**
- Modify: `apps/api/src/routes/integrations/downloadClient/index.ts`
- Modify: `apps/shared/src/types/` (the module already carrying download-client types)
- Test: `apps/api/test/downloadClientRoutes.test.ts` (extend)

**Interfaces:**
- Consumes: `getOrCreateHookToken` / `rotateHookToken` (Task 3), `applyQbittorrentAutorun` (Task 6), all four generators (Task 7).
- Produces: shared type `DownloadClientHookConfig` and three endpoints. Task 9 consumes all of it.

```ts
export type DownloadClientHookStatus =
  | "not-configured"   // no callback URL set
  | "awaiting-first"   // configured, nothing received yet
  | "active"           // hook seen within 24h
  | "stale"            // seen, but not for over 24h
  | "foreign-program"; // qBittorrent autorun belongs to the user

export type DownloadClientHookConfig = {
  status: DownloadClientHookStatus;
  callbackUrl: string | null;
  autoConfigure: boolean;
  lastSeenAt: string | null;
  activeHookedSecs: number;
  token: string;
  qbittorrentCommand: string;
  delugeScript: string;
  transmissionScript: string;
};
```

**Background the implementer needs:**

The existing router is `downloadClientIntegrationRoutes` and it applies `requireAdmin` at line 60 — correct for these three endpoints, since they expose the token. The hook endpoint from Task 5 is deliberately a *separate* router and must stay out of this one.

Follow the file's existing shape: `.get("/download-client", …)` at line 61, `.put(…)` at line 90, `.post("/download-client/test", …)` at line 183.

`downloadHookCallbackUrl` has no sane default — Rawkoon cannot know what address the *client's* container can reach it at. When it is unset, return `status: "not-configured"` and skip auto-configuration entirely.

Endpoints:
- `GET /download-client/hook` → `DownloadClientHookConfig`
- `PUT /download-client/hook` → body `{ callbackUrl?: string | null; autoConfigure?: boolean; activeHookedSecs?: number }`, then re-run auto-configuration when the active client is qBittorrent and `autoConfigure` is on
- `POST /download-client/hook/rotate` → rotate, re-run auto-configuration, return the fresh config

- [ ] **Step 1: Write the failing test**

Append to `apps/api/test/downloadClientRoutes.test.ts` — match the file's existing harness style rather than introducing a new one:

```ts
import { computeHookStatus } from "@rawkoon/api/routes/integrations/downloadClient/index";

describe("computeHookStatus", () => {
  const nowMs = 1_800_000_000_000;

  it("reports not-configured without a callback URL", () => {
    expect(
      computeHookStatus({
        callbackUrl: null,
        lastSeenAt: null,
        foreignProgram: false,
        nowMs,
      }),
    ).toBe("not-configured");
  });

  it("reports awaiting-first once configured but never called", () => {
    expect(
      computeHookStatus({
        callbackUrl: "http://rawkoon:3000",
        lastSeenAt: null,
        foreignProgram: false,
        nowMs,
      }),
    ).toBe("awaiting-first");
  });

  it("reports active for a recent hook", () => {
    expect(
      computeHookStatus({
        callbackUrl: "http://rawkoon:3000",
        lastSeenAt: new Date(nowMs - 60_000),
        foreignProgram: false,
        nowMs,
      }),
    ).toBe("active");
  });

  it("reports stale for a hook older than the window", () => {
    expect(
      computeHookStatus({
        callbackUrl: "http://rawkoon:3000",
        lastSeenAt: new Date(nowMs - 25 * 60 * 60 * 1000),
        foreignProgram: false,
        nowMs,
      }),
    ).toBe("stale");
  });

  it("surfaces a foreign autorun program over every other state", () => {
    expect(
      computeHookStatus({
        callbackUrl: "http://rawkoon:3000",
        lastSeenAt: new Date(nowMs - 60_000),
        foreignProgram: true,
        nowMs,
      }),
    ).toBe("foreign-program");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd apps/api && bun test test/downloadClientRoutes.test.ts
```

Expected: FAIL — `computeHookStatus` is not exported.

- [ ] **Step 3: Add the shared type**

Add `DownloadClientHookStatus` and `DownloadClientHookConfig` (exactly as in the Interfaces block above) to the `apps/shared` module that already holds the download-client types. Find it with:

```bash
grep -rn "DownloadClientType" apps/shared/src/types/
```

Export it from that module's barrel so both sides import from `@rawkoon/shared/types`. `apps/shared` formats with prettier, not Biome:

```bash
cd apps/shared && bun run formatCheck
```

- [ ] **Step 4: Implement `computeHookStatus` and the three endpoints**

In `apps/api/src/routes/integrations/downloadClient/index.ts`, export the pure status function:

```ts
import { HOOK_RECENT_WINDOW_MS } from "@rawkoon/api/workers/checkDownloadCompletion";
import type { DownloadClientHookStatus } from "@rawkoon/shared/types";

/**
 * Foreign-program wins over every other state: the user has their own autorun
 * command, so nothing else we report about the hook is actionable until that is
 * resolved.
 */
export function computeHookStatus(input: {
  callbackUrl: string | null;
  lastSeenAt: Date | null;
  foreignProgram: boolean;
  nowMs: number;
}): DownloadClientHookStatus {
  if (input.foreignProgram) return "foreign-program";
  if (!input.callbackUrl) return "not-configured";
  if (!input.lastSeenAt) return "awaiting-first";
  const age = input.nowMs - input.lastSeenAt.getTime();
  return age >= 0 && age < HOOK_RECENT_WINDOW_MS ? "active" : "stale";
}
```

Then add the three routes to the existing chain, following the shape of the neighbouring handlers. Each reads `mediaSettings` (id 1), calls `getOrCreateHookToken()`, and builds the response with the Task 7 generators. `PUT` and `POST .../rotate` additionally call `applyQbittorrentAutorun(config, buildQbittorrentCommand({ baseUrl, token }), HOOK_PATH)` when the active client type is `qbittorrent`, `autoConfigure` is true, and `callbackUrl` is set — recording a `skip-foreign` result as `foreignProgram: true` in the returned status.

Resolve the active client with `resolveActiveAdapter()` from `@rawkoon/api/services/downloadClient/registry`, which the file's `/download-client/test` handler already uses.

Errors: return the `apps/api/src/errors.ts` helpers. A failed `applyQbittorrentAutorun` (client unreachable) must **not** fail the whole `PUT` — persist the settings, log the warning, and report `status` from the persisted state. The settings write is the user's intent; reaching the client is best-effort.

- [ ] **Step 5: Run the tests to verify they pass**

```bash
cd apps/api && bun test test/downloadClientRoutes.test.ts
```

Expected: PASS — the five new cases plus every pre-existing case.

- [ ] **Step 6: Verify the endpoints by hand**

With `bun run dev:api` running and an admin session cookie in `cookies.txt`:

```bash
curl -s -b cookies.txt http://localhost:3000/api/integrations/download-client/hook | jq
```

Expected: JSON matching `DownloadClientHookConfig`, `status: "not-configured"` on a fresh database, and a `qbittorrentCommand` containing `?hash=%I`.

- [ ] **Step 7: Commit**

```bash
cd /home/samuelloranger/sites/rawkoon
bun run typecheck && bun run typecheck:native && bun run lint && bun run format
cd apps/shared && bun run formatCheck && cd ..
git add apps/api/src/routes/integrations/downloadClient/index.ts \
        apps/shared/src apps/api/test/downloadClientRoutes.test.ts
git commit -m "feat: expose download completion hook settings API"
```

---

### Task 9: Settings UI

**Files:**
- Modify: `apps/web/src/pages/settings/_component/integrations/DownloadClientIntegrationSection.tsx`
- Modify: `apps/web/src/lib/queryKeys.ts`
- Modify: `apps/web/src/locales/en/…` and `apps/web/src/locales/fr/…`

**Interfaces:**
- Consumes: `DownloadClientHookConfig` from `@rawkoon/shared/types` and the three endpoints from Task 8.
- Produces: no API for later tasks.

**Background the implementer needs:**

`apps/web/src/routeTree.gen.ts` is gitignored and generated. If typecheck fails on missing routes, run `bun run dev:web` once or `bunx @tanstack/router-cli generate`.

Every string goes through i18next in both `en` and `fr` — no literals in JSX. Follow the existing keys in the same settings section for naming.

Query keys are centralized; add the hook key to `queryKeys.ts` rather than inlining an array.

- [ ] **Step 1: Add the query key**

In `apps/web/src/lib/queryKeys.ts`, add a `downloadClientHook` entry alongside the existing download-client keys, following the file's established factory shape.

- [ ] **Step 2: Add the strings**

Add to both `en` and `fr` locale files, under the existing download-client settings namespace:

- section title, e.g. "Completion notifications"
- explanation that the client notifies Rawkoon instead of Rawkoon polling
- callback URL label plus the helper text "The address your download client can reach Rawkoon at, e.g. `http://rawkoon:3000`"
- auto-configure toggle label, qBittorrent-only note
- one message per `DownloadClientHookStatus` value: `not-configured`, `awaiting-first`, `active`, `stale`, `foreign-program`
- rotate-token button label and its confirmation copy, stating that the client must be reconfigured afterwards
- headings for the Deluge and Transmission manual instructions

- [ ] **Step 3: Build the UI**

In `DownloadClientIntegrationSection.tsx`, add a hook subsection:

- `useQuery` on the new key → `GET /api/integrations/download-client/hook`
- callback URL text input, auto-configure switch, and hooked-cadence number input, saved via a `useMutation` → `PUT`, invalidating the hook key on success
- a status badge driven by `config.status`; render `foreign-program` as a warning that shows `config.qbittorrentCommand` for manual pasting
- rotate button → `POST .../hook/rotate`, behind a confirmation dialog, invalidating the hook key
- collapsible manual instructions for Deluge and Transmission, each showing its script from `config.delugeScript` / `config.transmissionScript` with copy-to-clipboard, plus the two setup steps (make the file executable; point the client's setting at it)
- when `status === "not-configured"`, keep the instruction blocks collapsed and prompt for the callback URL first — the scripts are useless without it

Follow the section's existing form, switch, and mutation patterns rather than introducing new ones.

- [ ] **Step 4: Verify in the browser**

```bash
cd /home/samuelloranger/sites/rawkoon
bun run dev:api    # one shell
bun run dev:web    # another
```

Open Settings → Integrations → Download client. Confirm: the section renders; saving a callback URL persists across reload; the status badge changes from `not-configured` to `awaiting-first`; both language variants render with no missing-key warnings in the console.

- [ ] **Step 5: Run the web checks**

```bash
cd /home/samuelloranger/sites/rawkoon
bun run test && bun run typecheck && bun run typecheck:native && bun run lint && bun run format && bun run build
```

Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src
git commit -m "feat: download completion hook settings UI"
```

---

## Final verification

- [ ] **Full gate**

```bash
cd /home/samuelloranger/sites/rawkoon
bun run test && bun run typecheck && bun run typecheck:native && bun run lint && bun run knip && bun run build
cd apps/shared && bun run formatCheck
```

- [ ] **End-to-end against a real qBittorrent**

1. Point Rawkoon at a qBittorrent instance and set the callback URL to an address that container can actually reach.
2. Confirm in qBittorrent's Options → Downloads that the autorun command was written.
3. Grab something small and let it finish.
4. Confirm the API log shows the hook arriving, and that completion is detected within a couple of seconds rather than up to twenty.
5. Confirm the settings badge reads `active`.
6. Set the autorun program to a script of your own and save settings again — confirm Rawkoon reports `foreign-program` and did **not** overwrite it.

- [ ] **Regression: no hook configured**

On an instance with no callback URL, confirm completion is still detected on the timer and the active cadence is still 20s. This is the guarantee the whole design rests on — a broken or absent hook must never be slower than the behavior before this work.

- [ ] **Token containment**

```sql
SELECT request_path, meta FROM qbittorrent_request_logs
WHERE endpoint = '/api/v2/app/setPreferences' ORDER BY id DESC LIMIT 5;
```

Expected: no token in either column.
