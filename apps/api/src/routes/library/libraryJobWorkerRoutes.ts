import { Hono } from "hono";
import { z } from "zod";

import { badRequest, ok, serverError } from "@rawkoon/api/errors";
import type { Env } from "@rawkoon/api/honoEnv";
import {
  libraryMigrateQueue,
  libraryReindexLanguagesQueue,
  libraryRemuxQueue,
  scheduledTasksQueue,
  SCHEDULED_JOB_NAMES,
} from "@rawkoon/api/services/queueService";
import { createJsonSseResponse } from "@rawkoon/api/utils/sse";
import type { LibraryMigrateProgress } from "@rawkoon/api/services/jobs/libraryMigrateTypes";
import type { LibraryReindexLanguagesProgress } from "@rawkoon/api/services/jobs/libraryReindexLanguagesWorker";
import type { LibraryRemuxJobData } from "@rawkoon/api/services/jobs/libraryRemuxWorker";
import {
  getLastRssRun,
  getRssRunHistory,
} from "@rawkoon/api/services/rssRunStatus";
import { libraryEventBus } from "@rawkoon/api/services/libraryEvents";
import { ensureAdmin, requireUser } from "@rawkoon/api/middleware/hono/auth";
import { jsonV } from "@rawkoon/api/middleware/validate";

/**
 * POST /api/library/reindex-languages
 * GET /api/library/reindex-languages/status
 * POST /api/library/files/:fileId/remux
 * GET /api/library/files/:fileId/remux/status
 * GET /api/library/events (SSE)
 * GET /api/library/rss-status
 * POST /api/library/migrate
 * GET /api/library/migrate/status
 */
export const libraryJobWorkerRoutes = new Hono<Env>()
  .post("/reindex-languages", requireUser, async (c) => {
    const denied = ensureAdmin(c.get("user"));
    if (denied) return denied;
    try {
      const job = await libraryReindexLanguagesQueue.add(
        "library-reindex-languages",
        {},
        { jobId: "library-reindex-languages-singleton" },
      );
      const state = await job?.getState();
      if (state === "active" || state === "waiting") {
        return badRequest("A language reindex job is already running");
      }
      return ok({ job_id: job?.id });
    } catch {
      return serverError("Failed to enqueue reindex job");
    }
  })

  .get("/reindex-languages/status", requireUser, async () => {
    try {
      const [active, waiting, completed, failed] = await Promise.all([
        libraryReindexLanguagesQueue.getJobs(["active"]),
        libraryReindexLanguagesQueue.getJobs(["waiting"]),
        libraryReindexLanguagesQueue.getJobs(["completed"], 0, 1, false),
        libraryReindexLanguagesQueue.getJobs(["failed"], 0, 1, false),
      ]);
      const job = active[0] ?? waiting[0] ?? completed[0] ?? failed[0] ?? null;
      if (!job) {
        return ok({
          state: "unknown",
          job_id: null,
          progress: null,
          result: null,
          error: null,
          started_at: null,
          finished_at: null,
        });
      }
      const state = await job.getState();
      const progress =
        (job.progress as LibraryReindexLanguagesProgress | null | number) ??
        null;
      const typedProgress =
        typeof progress === "object" && progress !== null
          ? (progress as LibraryReindexLanguagesProgress)
          : null;
      return ok({
        job_id: job.id ?? null,
        state,
        progress: typedProgress,
        result: state === "completed" ? (job.returnvalue ?? null) : null,
        error: state === "failed" ? (job.failedReason ?? null) : null,
        started_at: job.processedOn
          ? new Date(job.processedOn).toISOString()
          : null,
        finished_at: job.finishedOn
          ? new Date(job.finishedOn).toISOString()
          : null,
      });
    } catch {
      return serverError("Failed to fetch reindex status");
    }
  })

  .post(
    "/files/:fileId/remux",
    requireUser,
    jsonV(
      z.object({
        keep_audio_track_indices: z.array(z.number()),
        keep_subtitle_track_indices: z.array(z.number()),
      }),
    ),
    async (c) => {
      const denied = ensureAdmin(c.get("user"));
      if (denied) return denied;
      const fileId = parseInt(c.req.param("fileId"), 10);
      if (!Number.isFinite(fileId)) return badRequest("Invalid file id");
      const body = c.req.valid("json");
      if (!body.keep_audio_track_indices.length)
        return badRequest("At least one audio track must be kept");
      try {
        const jobId = `library-remux-file-${fileId}`;
        const existing = await libraryRemuxQueue.getJob(jobId);
        const existingState = existing ? await existing.getState() : null;
        if (existingState === "active" || existingState === "waiting") {
          return badRequest("A remux job for this file is already queued");
        }
        const job = await libraryRemuxQueue.add(
          "library-remux-file",
          {
            file_id: fileId,
            keep_audio_track_indices: body.keep_audio_track_indices,
            keep_subtitle_track_indices: body.keep_subtitle_track_indices,
          } satisfies LibraryRemuxJobData,
          { jobId },
        );
        return ok({ job_id: job?.id });
      } catch {
        return serverError("Failed to enqueue remux job");
      }
    },
  )

  .get("/files/:fileId/remux/status", requireUser, async (c) => {
    const fileId = parseInt(c.req.param("fileId"), 10);
    if (!Number.isFinite(fileId)) return badRequest("Invalid file id");
    try {
      const jobId = `library-remux-file-${fileId}`;
      const job = await libraryRemuxQueue.getJob(jobId);
      if (!job) {
        return ok({
          state: "unknown",
          job_id: null,
          result: null,
          error: null,
        });
      }
      const state = await job.getState();
      return ok({
        job_id: job.id ?? null,
        state,
        result: state === "completed" ? (job.returnvalue ?? null) : null,
        error: state === "failed" ? (job.failedReason ?? null) : null,
      });
    } catch {
      return serverError("Failed to fetch remux status");
    }
  })

  .get("/events", requireUser, (c) => {
    const enc = new TextEncoder();
    let closed = false;
    let controller: ReadableStreamDefaultController<Uint8Array>;

    const stream = new ReadableStream<Uint8Array>({
      start(ctrl) {
        controller = ctrl;
      },
      cancel() {
        closed = true;
      },
    });

    function send(chunk: string) {
      if (closed) return;
      try {
        controller.enqueue(enc.encode(chunk));
      } catch {
        closed = true;
      }
    }

    // `kind` lets one connection serve both domains. Media events keep their
    // original shape so an older client still understands them.
    function onUpdate(payload: { mediaId: number; ts: number }) {
      send(`data: ${JSON.stringify({ kind: "media", ...payload })}\n\n`);
    }

    function onBookUpdate(payload: { bookId: number; ts: number }) {
      send(`data: ${JSON.stringify({ kind: "book", ...payload })}\n\n`);
    }

    libraryEventBus.on("update", onUpdate);
    libraryEventBus.on("book-update", onBookUpdate);
    const heartbeat = setInterval(() => send(": ping\n\n"), 15_000);

    c.req.raw.signal.addEventListener("abort", () => {
      closed = true;
      libraryEventBus.off("update", onUpdate);
      libraryEventBus.off("book-update", onBookUpdate);
      clearInterval(heartbeat);
      try {
        controller.close();
      } catch (e) {
        console.warn("[library SSE] controller.close on abort:", e);
      }
    });

    send(`data: ${JSON.stringify({ connected: true, ts: Date.now() })}\n\n`);

    // Headers go on the Response directly (framework-neutral; Hono has no
    // `set.headers`).
    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  })

  .get("/rss-status", requireUser, async () => {
    try {
      const [lastRun, history, repeatableJobs] = await Promise.all([
        getLastRssRun(),
        getRssRunHistory(),
        scheduledTasksQueue.getJobSchedulers(),
      ]);
      const rssJob = repeatableJobs.find(
        (j) => j.name === SCHEDULED_JOB_NAMES.POLL_INDEXER_RSS,
      );
      const bullNext = rssJob?.next ? new Date(rssJob.next) : null;
      const now = new Date();
      const nextRunAt =
        bullNext && bullNext > now
          ? bullNext.toISOString()
          : (() => {
              const mins = now.getUTCMinutes();
              const nextMins = Math.ceil((mins + 1) / 15) * 15;
              return new Date(
                Date.UTC(
                  now.getUTCFullYear(),
                  now.getUTCMonth(),
                  now.getUTCDate(),
                  now.getUTCHours() + Math.floor(nextMins / 60),
                  nextMins % 60,
                  0,
                  0,
                ),
              ).toISOString();
            })();
      return ok({
        server_time: new Date().toISOString(),
        last_run: lastRun,
        history,
        next_run_at: nextRunAt,
      });
    } catch {
      return serverError("Failed to fetch RSS status");
    }
  })

  .post(
    "/migrate",
    requireUser,
    jsonV(
      z.object({
        source: z.union([
          z.literal("radarr"),
          z.literal("sonarr"),
          z.literal("both"),
        ]),
        radarr_url: z.string().optional(),
        radarr_api_key: z.string().optional(),
        sonarr_url: z.string().optional(),
        sonarr_api_key: z.string().optional(),
      }),
    ),
    async (c) => {
      const denied = ensureAdmin(c.get("user"));
      if (denied) return denied;

      const { source, radarr_url, radarr_api_key, sonarr_url, sonarr_api_key } =
        c.req.valid("json");

      try {
        const job = await libraryMigrateQueue.add(
          "library-migrate",
          {
            source,
            requested_by: c.get("user").id,
            radarr_url: radarr_url?.trim() || undefined,
            radarr_api_key: radarr_api_key?.trim() || undefined,
            sonarr_url: sonarr_url?.trim() || undefined,
            sonarr_api_key: sonarr_api_key?.trim() || undefined,
          },
          { jobId: "library-migrate-singleton" },
        );
        const state = await job?.getState();
        if (state === "active" || state === "waiting") {
          return badRequest("A migration job is already running");
        }
        return ok({ job_id: job?.id });
      } catch {
        return serverError("Failed to enqueue migration job");
      }
    },
  )

  .get("/migrate/status", requireUser, (c) => {
    return createJsonSseResponse({
      request: c.req.raw,
      logLabel: "LibraryMigrate",
      intervalMs: (data) => {
        if ((data as { state?: string })?.state === "active") return 1500;
        return 3000;
      },
      poll: async () => {
        const [active, waiting, completed, failed] = await Promise.all([
          libraryMigrateQueue.getJobs(["active"]),
          libraryMigrateQueue.getJobs(["waiting"]),
          libraryMigrateQueue.getJobs(["completed"], 0, 1, false),
          libraryMigrateQueue.getJobs(["failed"], 0, 1, false),
        ]);

        const job =
          active[0] ?? waiting[0] ?? completed[0] ?? failed[0] ?? null;

        if (!job) {
          return {
            state: "unknown",
            job_id: null,
            progress: null,
            result: null,
            error: null,
            started_at: null,
            finished_at: null,
          };
        }

        const state = await job.getState();
        const progress =
          (job.progress as LibraryMigrateProgress | null | number) ?? null;
        const typedProgress =
          typeof progress === "object" && progress !== null
            ? (progress as LibraryMigrateProgress)
            : null;

        return {
          job_id: job.id ?? null,
          state,
          progress: typedProgress,
          result: state === "completed" ? (job.returnvalue ?? null) : null,
          error: state === "failed" ? (job.failedReason ?? null) : null,
          started_at: job.processedOn
            ? new Date(job.processedOn).toISOString()
            : null,
          finished_at: job.finishedOn
            ? new Date(job.finishedOn).toISOString()
            : null,
        };
      },
    });
  });
