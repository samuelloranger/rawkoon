import { Hono } from "hono";
import { getConnInfo } from "hono/bun";
import { rateLimiter } from "hono-rate-limiter";
import type { Context } from "hono";
import { prisma } from "@rawkoon/api/db";
import { badRequest, ok, unauthorized } from "@rawkoon/api/errors";
import type { Env } from "@rawkoon/api/honoEnv";
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

function hookClientIp(c: Context): string {
  const req = c.req.raw;
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
    req.headers.get("x-real-ip") ||
    (() => {
      try {
        return getConnInfo(c).remote.address;
      } catch {
        return undefined;
      }
    })() ||
    "unknown"
  );
}

// Scoped to the hook route only (120/min per IP), so a book-open burst of SPA
// asset/API requests is never policed by this limiter.
const hookRateLimit = rateLimiter<Env>({
  windowMs: 60 * 1000,
  limit: 120,
  keyGenerator: (c) => `hook:${hookClientIp(c)}`,
  message: "Too many requests. Please try again later.",
  standardHeaders: true,
});

// Mounted at /api/download-client by the edge (route paths relative).
export const downloadClientHookRoutes = new Hono<Env>().post(
  "/hook/complete",
  hookRateLimit,
  async (c) => {
    const result = await handleCompletionHook(
      {
        token: c.req.header("x-rawkoon-token") ?? null,
        hash: c.req.query("hash") ?? null,
      },
      liveDeps,
    );
    if (result.status === 401) return unauthorized();
    if (result.status === 400) return badRequest("Invalid torrent hash");
    return ok(result.body, 202);
  },
);
