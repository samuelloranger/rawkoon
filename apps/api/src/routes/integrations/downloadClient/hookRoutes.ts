import { Elysia, t } from "elysia";
import { rateLimit } from "elysia-rate-limit";
import { prisma } from "@rawkoon/api/db";
import { badRequest, unauthorized } from "@rawkoon/api/errors";
import { verifyHookToken } from "@rawkoon/api/services/downloadClient/hookToken";
import {
  scheduledTasksQueue,
  SCHEDULED_JOB_NAMES,
} from "@rawkoon/api/services/queueService";
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
    if (!owned)
      return { status: 202, body: { accepted: true, matched: false } };
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
    try {
      await scheduledTasksQueue.add(
        SCHEDULED_JOB_NAMES.CHECK_LIBRARY_DOWNLOAD_COMPLETION,
        {},
      );
    } catch (error) {
      // A queue outage must not fail the hook. The gate is already open, so the
      // next scheduled tick reconciles this within one cadence interval anyway —
      // the hook only ever buys latency. Letting this throw would instead drop
      // the client's connection, which reads as "the hook is broken" and, with
      // curl -fsS, logs an error in the download client on every completion.
      console.warn(
        `[download-hook] wake enqueue failed, falling back to the timer: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  },
};

export const downloadClientHookRoutes = new Elysia({
  prefix: "/api/download-client",
})
  .use(
    rateLimit({
      duration: 60 * 1000,
      max: 120,
      // elysia-rate-limit scopes its hook globally, so without this the hook
      // limiter policed every route in the application: 120 requests a minute
      // per IP, with no authenticated bypass. Opening a book fires a burst of
      // document, asset and API requests, and everything past the 120th came
      // back 429 — the SPA and its JavaScript included. Same shape as
      // strictAuthRateLimit: count only the paths this limiter is for.
      skip: (req) =>
        !new URL(req.url).pathname.startsWith("/api/download-client/hook"),
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
