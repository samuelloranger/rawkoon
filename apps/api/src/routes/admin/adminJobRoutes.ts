import { Hono } from "hono";
import { z } from "zod";
import type { Job, Queue, JobState } from "bullmq";
import { logActivity } from "@rawkoon/api/utils/activityLogs";
import { badRequest, notFound, ok, serverError } from "@rawkoon/api/errors";
import type { Env } from "@rawkoon/api/honoEnv";
import {
  scheduledTasksQueue,
  expressQueue,
  libraryMigrateQueue,
  QUEUE_NAMES,
  addJob,
  SCHEDULED_JOB_NAMES,
} from "@rawkoon/api/services/queueService";
import { createJsonSseResponse } from "@rawkoon/api/utils/sse";
import { jsonV } from "@rawkoon/api/middleware/validate";

const queueMap: Record<string, Queue> = {
  "scheduled-tasks": scheduledTasksQueue,
  express: expressQueue,
  "library-migrate": libraryMigrateQueue,
};

const getQueueStats = async (name: string, queue: Queue) => {
  const [waiting, active, completed, failed, delayed] = await Promise.all([
    queue.getWaitingCount(),
    queue.getActiveCount(),
    queue.getCompletedCount(),
    queue.getFailedCount(),
    queue.getDelayedCount(),
  ]);
  return { name, waiting, active, completed, failed, delayed };
};

const fetchRepeatableJobsList = async () => {
  const repeatableJobs = await scheduledTasksQueue.getJobSchedulers();
  const jobInstances = await scheduledTasksQueue.getJobs(
    ["active", "waiting", "failed", "completed"],
    0,
    50,
    false,
  );

  const jobs = await Promise.all(
    repeatableJobs.map(async (rJob) => {
      const latestInstance = jobInstances
        .filter((j) => j.name === rJob.name)
        .sort((a, b) => (Number(b.id) || 0) - (Number(a.id) || 0))[0];

      const status = latestInstance
        ? await latestInstance.getState()
        : "waiting";

      return {
        id: rJob.key,
        name: rJob.name,
        trigger: rJob.pattern,
        next_run_time: rJob.next ? new Date(rJob.next).toISOString() : null,
        tz: rJob.tz,
        status,
      };
    }),
  );

  return jobs.sort((a, b) => {
    if (!a.next_run_time) return 1;
    if (!b.next_run_time) return -1;
    return (
      new Date(a.next_run_time).getTime() - new Date(b.next_run_time).getTime()
    );
  });
};

const actionMap: Record<string, string> = {
  cleanup_notifications: SCHEDULED_JOB_NAMES.CLEANUP_NOTIFICATIONS,
  refresh_upcoming: SCHEDULED_JOB_NAMES.REFRESH_UPCOMING,
  check_movie_release_reminders:
    SCHEDULED_JOB_NAMES.CHECK_MOVIE_RELEASE_REMINDERS,
  check_library_movie_releases:
    SCHEDULED_JOB_NAMES.CHECK_LIBRARY_MOVIE_RELEASES,
  check_library_episode_releases:
    SCHEDULED_JOB_NAMES.CHECK_LIBRARY_EPISODE_RELEASES,
  sync_library_show_episodes: SCHEDULED_JOB_NAMES.SYNC_LIBRARY_SHOW_EPISODES,
  check_library_download_completion:
    SCHEDULED_JOB_NAMES.CHECK_LIBRARY_DOWNLOAD_COMPLETION,
  check_library_integrity: SCHEDULED_JOB_NAMES.CHECK_LIBRARY_INTEGRITY,
  poll_indexer_rss: SCHEDULED_JOB_NAMES.POLL_INDEXER_RSS,
  refresh_github_releases: SCHEDULED_JOB_NAMES.REFRESH_GITHUB_RELEASES,
  sync_library_attention_alerts:
    SCHEDULED_JOB_NAMES.SYNC_LIBRARY_ATTENTION_ALERTS,
  check_book_releases: SCHEDULED_JOB_NAMES.CHECK_BOOK_RELEASES,
  check_author_releases: SCHEDULED_JOB_NAMES.CHECK_AUTHOR_RELEASES,
};

// Mounted under /api/admin (Elysia .mount strips the prefix); requireAdmin is
// applied once at the admin parent and propagates to these merged routes.
export const adminJobRoutes = new Hono<Env>()
  // GET /api/admin/scheduled-jobs - List scheduled BullMQ jobs and queue stats
  .get("/scheduled-jobs", async () => {
    const queueStats = [
      await getQueueStats("Scheduled Tasks", scheduledTasksQueue),
      await getQueueStats("Express", expressQueue),
      await getQueueStats("Library Migrate", libraryMigrateQueue),
    ];

    return ok({
      scheduler_running: true,
      queues: queueStats,
      jobs: await fetchRepeatableJobsList(),
    });
  })

  // GET /api/admin/jobs/events - SSE endpoint for real-time job updates
  .get("/jobs/events", (c) => {
    return createJsonSseResponse({
      request: c.req.raw,
      logLabel: "AdminJobs",
      intervalMs: 2000,
      poll: async () => ({ jobs: await fetchRepeatableJobsList() }),
    });
  })

  // GET /api/admin/queues/:name/jobs - Get detailed list of jobs in a specific queue
  .get("/queues/:name/jobs", async (c) => {
    const queue = queueMap[c.req.param("name")];
    if (!queue) throw new Error("Queue not found");

    const statusStrings = c.req.query("status")?.split(",") || [
      "active",
      "waiting",
      "completed",
      "failed",
      "delayed",
    ];
    const states = statusStrings as JobState[];
    const limit = parseInt(c.req.query("limit") ?? "") || 50;

    const jobs = await queue.getJobs(states, 0, limit - 1, false);

    return ok(
      await Promise.all(
        jobs.map(async (job: Job) => {
          const state = await job.getState();
          return {
            id: job.id,
            name: job.name,
            data: job.data,
            opts: job.opts,
            progress: job.progress,
            delay: job.delay,
            timestamp: new Date(job.timestamp).toISOString(),
            processedOn: job.processedOn
              ? new Date(job.processedOn).toISOString()
              : null,
            finishedOn: job.finishedOn
              ? new Date(job.finishedOn).toISOString()
              : null,
            status: state,
            returnValue: job.returnvalue,
            failedReason: job.failedReason,
            stacktrace: job.stacktrace,
            attemptsMade: job.attemptsMade,
          };
        }),
      ),
    );
  })

  // POST /api/admin/trigger-action - Trigger a cron job manually
  .post(
    "/trigger-action",
    jsonV(z.object({ action: z.string() })),
    async (c) => {
      const adminUser = c.get("user");
      const { action } = c.req.valid("json");
      const jobName = actionMap[action] || action;
      const jobData: Record<string, string> = { trigger: "manual" };

      try {
        await logActivity({
          type: "admin_triggered_job",
          userId: adminUser.id,
          payload: { action, job_name: jobName },
        });

        await addJob(QUEUE_NAMES.SCHEDULED_TASKS, jobName, jobData);

        return ok({
          success: true,
          message: `Job ${jobName} enqueued for immediate execution.`,
        });
      } catch (error) {
        console.error("Error triggering action:", error);
        return Response.json(
          { success: false, message: "Failed to execute action" },
          { status: 500 },
        );
      }
    },
  )

  // POST /api/admin/queues/:name/jobs/:jobId/retry - Retry a single failed job
  .post("/queues/:name/jobs/:jobId/retry", async (c) => {
    const queue = queueMap[c.req.param("name")];
    if (!queue) return badRequest("Queue not found");
    const jobId = c.req.param("jobId");

    try {
      const job = await queue.getJob(jobId);
      if (!job) return notFound("Job not found");

      const state = await job.getState();
      if (state !== "failed") return badRequest(`Job is ${state}, not failed`);

      await job.retry(state);
      return ok({ success: true, message: `Job ${jobId} queued for retry` });
    } catch (error) {
      console.error("Error retrying job:", error);
      return serverError("Failed to retry job");
    }
  })

  // POST /api/admin/queues/:name/retry-failed - Retry all failed jobs in a queue
  .post("/queues/:name/retry-failed", async (c) => {
    const queue = queueMap[c.req.param("name")];
    if (!queue) return badRequest("Queue not found");

    try {
      const failed = await queue.getJobs(["failed"]);
      let retried = 0;
      for (const job of failed) {
        await job.retry("failed");
        retried++;
      }
      return ok({
        success: true,
        message: `Retried ${retried} failed jobs`,
        retried,
      });
    } catch (error) {
      console.error("Error retrying failed jobs:", error);
      return serverError("Failed to retry jobs");
    }
  })

  // DELETE /api/admin/queues/:name/clean - Clean completed/failed jobs from a queue
  .delete("/queues/:name/clean", async (c) => {
    const queue = queueMap[c.req.param("name")];
    if (!queue) return badRequest("Queue not found");

    const status = c.req.query("status") || "completed";
    if (!["completed", "failed"].includes(status))
      return badRequest("Status must be completed or failed");

    const grace = parseInt(c.req.query("grace") ?? "") || 0;

    try {
      const cleaned = await queue.clean(
        grace,
        1000,
        status as "completed" | "failed",
      );
      return ok({
        success: true,
        message: `Cleaned ${cleaned.length} ${status} jobs`,
        cleaned: cleaned.length,
      });
    } catch (error) {
      console.error("Error cleaning queue:", error);
      return serverError("Failed to clean queue");
    }
  })

  // GET /api/admin/jobs/history - Recent job history across all queues
  .get("/jobs/history", async (c) => {
    const limit = parseInt(c.req.query("limit") ?? "") || 50;

    const allQueues: { name: string; queue: Queue }[] = [
      { name: "scheduled-tasks", queue: scheduledTasksQueue },
      { name: "express", queue: expressQueue },
      { name: "library-migrate", queue: libraryMigrateQueue },
    ];

    const allJobs: Array<{
      id: string;
      name: string;
      queue: string;
      status: string;
      timestamp: string;
      processed_on: string | null;
      finished_on: string | null;
      duration: number | null;
      failed_reason: string | null;
      attempts_made: number;
    }> = [];

    for (const { name, queue } of allQueues) {
      const jobs = await queue.getJobs(
        ["completed", "failed"],
        0,
        limit - 1,
        false,
      );

      for (const job of jobs) {
        const state = await job.getState();
        const duration =
          job.finishedOn && job.processedOn
            ? job.finishedOn - job.processedOn
            : null;

        allJobs.push({
          id: job.id ?? "",
          name: job.name,
          queue: name,
          status: state,
          timestamp: new Date(job.timestamp).toISOString(),
          processed_on: job.processedOn
            ? new Date(job.processedOn).toISOString()
            : null,
          finished_on: job.finishedOn
            ? new Date(job.finishedOn).toISOString()
            : null,
          duration,
          failed_reason: job.failedReason ?? null,
          attempts_made: job.attemptsMade,
        });
      }
    }

    allJobs.sort((a, b) => {
      const aTime = a.finished_on ? new Date(a.finished_on).getTime() : 0;
      const bTime = b.finished_on ? new Date(b.finished_on).getTime() : 0;
      return bTime - aTime;
    });

    return ok({ jobs: allJobs.slice(0, limit) });
  });
