import { Elysia, t } from "elysia";

import { badRequest, serverError } from "@rawkoon/api/errors";
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
import { requireUser, ensureAdmin } from "@rawkoon/api/middleware/auth";

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
export const libraryJobWorkerRoutes = new Elysia()
  .use(requireUser)
  .post("/reindex-languages", async ({ user, set }) => {
    const denied = ensureAdmin(user, set);
    if (denied) return denied;
    try {
      const job = await libraryReindexLanguagesQueue.add(
        "library-reindex-languages",
        {},
        { jobId: "library-reindex-languages-singleton" },
      );
      const state = await job?.getState();
      if (state === "active" || state === "waiting") {
        return badRequest(set, "A language reindex job is already running");
      }
      return { job_id: job?.id };
    } catch {
      return serverError(set, "Failed to enqueue reindex job");
    }
  })

  .get("/reindex-languages/status", async ({ set }) => {
    try {
      const [active, waiting, completed, failed] = await Promise.all([
        libraryReindexLanguagesQueue.getJobs(["active"]),
        libraryReindexLanguagesQueue.getJobs(["waiting"]),
        libraryReindexLanguagesQueue.getJobs(["completed"], 0, 1, false),
        libraryReindexLanguagesQueue.getJobs(["failed"], 0, 1, false),
      ]);
      const job = active[0] ?? waiting[0] ?? completed[0] ?? failed[0] ?? null;
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
        (job.progress as LibraryReindexLanguagesProgress | null | number) ??
        null;
      const typedProgress =
        typeof progress === "object" && progress !== null
          ? (progress as LibraryReindexLanguagesProgress)
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
    } catch {
      return serverError(set, "Failed to fetch reindex status");
    }
  })

  .post(
    "/files/:fileId/remux",
    async ({ params, set, body, user }) => {
      const denied = ensureAdmin(user, set);
      if (denied) return denied;
      const fileId = parseInt(params.fileId, 10);
      if (!Number.isFinite(fileId)) return badRequest(set, "Invalid file id");
      if (!body.keep_audio_track_indices.length)
        return badRequest(set, "At least one audio track must be kept");
      try {
        const jobId = `library-remux-file-${fileId}`;
        const existing = await libraryRemuxQueue.getJob(jobId);
        const existingState = existing ? await existing.getState() : null;
        if (existingState === "active" || existingState === "waiting") {
          return badRequest(set, "A remux job for this file is already queued");
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
        return { job_id: job?.id };
      } catch {
        return serverError(set, "Failed to enqueue remux job");
      }
    },
    {
      body: t.Object({
        keep_audio_track_indices: t.Array(t.Number(), { minItems: 1 }),
        keep_subtitle_track_indices: t.Array(t.Number()),
      }),
    },
  )

  .get("/files/:fileId/remux/status", async ({ params, set }) => {
    const fileId = parseInt(params.fileId, 10);
    if (!Number.isFinite(fileId)) return badRequest(set, "Invalid file id");
    try {
      const jobId = `library-remux-file-${fileId}`;
      const job = await libraryRemuxQueue.getJob(jobId);
      if (!job) {
        return { state: "unknown", job_id: null, result: null, error: null };
      }
      const state = await job.getState();
      return {
        job_id: job.id ?? null,
        state,
        result: state === "completed" ? (job.returnvalue ?? null) : null,
        error: state === "failed" ? (job.failedReason ?? null) : null,
      };
    } catch {
      return serverError(set, "Failed to fetch remux status");
    }
  })

  .get("/events", ({ request, set }) => {
    set.headers["Content-Type"] = "text/event-stream";
    set.headers["Cache-Control"] = "no-cache";
    set.headers["Connection"] = "keep-alive";
    set.headers["X-Accel-Buffering"] = "no";

    const enc = new TextEncoder();
    let closed = false;
    let controller: ReadableStreamDefaultController<Uint8Array>;

    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        controller = c;
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

    function onUpdate(payload: { mediaId: number; ts: number }) {
      send(`data: ${JSON.stringify(payload)}\n\n`);
    }

    libraryEventBus.on("update", onUpdate);
    const heartbeat = setInterval(() => send(": ping\n\n"), 15_000);

    request.signal.addEventListener("abort", () => {
      closed = true;
      libraryEventBus.off("update", onUpdate);
      clearInterval(heartbeat);
      try {
        controller.close();
      } catch (e) {
        console.warn("[library SSE] controller.close on abort:", e);
      }
    });

    send(`data: ${JSON.stringify({ connected: true, ts: Date.now() })}\n\n`);

    return new Response(stream);
  })

  .get("/rss-status", async ({ set }) => {
    try {
      const [lastRun, history, repeatableJobs] = await Promise.all([
        getLastRssRun(),
        getRssRunHistory(),
        scheduledTasksQueue.getRepeatableJobs(),
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
      return {
        server_time: new Date().toISOString(),
        last_run: lastRun,
        history,
        next_run_at: nextRunAt,
      };
    } catch {
      return serverError(set, "Failed to fetch RSS status");
    }
  })

  .post(
    "/migrate",
    async ({ body, user, set }) => {
      const denied = ensureAdmin(user, set);
      if (denied) return denied;

      const { source, radarr_url, radarr_api_key, sonarr_url, sonarr_api_key } =
        body;

      try {
        const job = await libraryMigrateQueue.add(
          "library-migrate",
          {
            source,
            requested_by: user!.id,
            radarr_url: radarr_url?.trim() || undefined,
            radarr_api_key: radarr_api_key?.trim() || undefined,
            sonarr_url: sonarr_url?.trim() || undefined,
            sonarr_api_key: sonarr_api_key?.trim() || undefined,
          },
          { jobId: "library-migrate-singleton" },
        );
        const state = await job?.getState();
        if (state === "active" || state === "waiting") {
          return badRequest(set, "A migration job is already running");
        }
        return { job_id: job?.id };
      } catch {
        return serverError(set, "Failed to enqueue migration job");
      }
    },
    {
      body: t.Object({
        source: t.Union([
          t.Literal("radarr"),
          t.Literal("sonarr"),
          t.Literal("both"),
        ]),
        radarr_url: t.Optional(t.String()),
        radarr_api_key: t.Optional(t.String()),
        sonarr_url: t.Optional(t.String()),
        sonarr_api_key: t.Optional(t.String()),
      }),
    },
  )

  .get("/migrate/status", ({ request }) => {
    return createJsonSseResponse({
      request,
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
