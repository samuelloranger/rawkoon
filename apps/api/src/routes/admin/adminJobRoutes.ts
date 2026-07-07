import { Elysia, t } from "elysia";
import type { Job, Queue, JobState } from "bullmq";
import { logActivity } from "@rawkoon/api/utils/activityLogs";
import { badRequest, notFound, serverError } from "@rawkoon/api/errors";
import {
  scheduledTasksQueue,
  expressQueue,
  libraryMigrateQueue,
  QUEUE_NAMES,
  addJob,
  SCHEDULED_JOB_NAMES,
} from "@rawkoon/api/services/queueService";
import { createJsonSseResponse } from "@rawkoon/api/utils/sse";
import { requireAdmin } from "@rawkoon/api/middleware/auth";

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
  const repeatableJobs = await scheduledTasksQueue.getRepeatableJobs();
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
};

export const adminJobRoutes = new Elysia()
  .use(requireAdmin)
  // GET /api/admin/scheduled-jobs - List scheduled BullMQ jobs and queue stats
  .get("/scheduled-jobs", async () => {
    const queueStats = [
      await getQueueStats("Scheduled Tasks", scheduledTasksQueue),
      await getQueueStats("Express", expressQueue),
      await getQueueStats("Library Migrate", libraryMigrateQueue),
    ];

    return {
      scheduler_running: true,
      queues: queueStats,
      jobs: await fetchRepeatableJobsList(),
    };
  })

  // GET /api/admin/jobs/events - SSE endpoint for real-time job updates
  .get("/jobs/events", ({ request }) => {
    return createJsonSseResponse({
      request,
      logLabel: "AdminJobs",
      intervalMs: 2000,
      poll: async () => ({ jobs: await fetchRepeatableJobsList() }),
    });
  })

  // GET /api/admin/queues/:name/jobs - Get detailed list of jobs in a specific queue
  .get("/queues/:name/jobs", async ({ params, query }) => {
    const queue = queueMap[params.name];
    if (!queue) throw new Error("Queue not found");

    const statusStrings = (query.status as string)?.split(",") || [
      "active",
      "waiting",
      "completed",
      "failed",
      "delayed",
    ];
    const states = statusStrings as JobState[];
    const limit = parseInt(query.limit as string) || 50;

    const jobs = await queue.getJobs(states, 0, limit - 1, false);

    return Promise.all(
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
    );
  })

  // POST /api/admin/trigger-action - Trigger a cron job manually
  .post(
    "/trigger-action",
    async ({ user, body, set }) => {
      const adminUser = user!;
      const { action } = body;
      const jobName = actionMap[action] || action;
      const jobData: Record<string, string> = { trigger: "manual" };

      try {
        await logActivity({
          type: "admin_triggered_job",
          userId: adminUser.id,
          payload: { action, job_name: jobName },
        });

        await addJob(QUEUE_NAMES.SCHEDULED_TASKS, jobName, jobData);

        return {
          success: true,
          message: `Job ${jobName} enqueued for immediate execution.`,
        };
      } catch (error) {
        console.error("Error triggering action:", error);
        set.status = 500;
        return { success: false, message: "Failed to execute action" };
      }
    },
    {
      body: t.Object({
        action: t.String(),
      }),
    },
  )

  // POST /api/admin/queues/:name/jobs/:jobId/retry - Retry a single failed job
  .post(
    "/queues/:name/jobs/:jobId/retry",
    async ({ params, set }) => {
      const queue = queueMap[params.name];
      if (!queue) return badRequest(set, "Queue not found");

      try {
        const job = await queue.getJob(params.jobId);
        if (!job) return notFound(set, "Job not found");

        const state = await job.getState();
        if (state !== "failed")
          return badRequest(set, `Job is ${state}, not failed`);

        await job.retry(state);
        return {
          success: true,
          message: `Job ${params.jobId} queued for retry`,
        };
      } catch (error) {
        console.error("Error retrying job:", error);
        return serverError(set, "Failed to retry job");
      }
    },
    { params: t.Object({ name: t.String(), jobId: t.String() }) },
  )

  // POST /api/admin/queues/:name/retry-failed - Retry all failed jobs in a queue
  .post(
    "/queues/:name/retry-failed",
    async ({ params, set }) => {
      const queue = queueMap[params.name];
      if (!queue) return badRequest(set, "Queue not found");

      try {
        const failed = await queue.getJobs(["failed"]);
        let retried = 0;
        for (const job of failed) {
          await job.retry("failed");
          retried++;
        }
        return {
          success: true,
          message: `Retried ${retried} failed jobs`,
          retried,
        };
      } catch (error) {
        console.error("Error retrying failed jobs:", error);
        return serverError(set, "Failed to retry jobs");
      }
    },
    { params: t.Object({ name: t.String() }) },
  )

  // DELETE /api/admin/queues/:name/clean - Clean completed/failed jobs from a queue
  .delete(
    "/queues/:name/clean",
    async ({ params, query, set }) => {
      const queue = queueMap[params.name];
      if (!queue) return badRequest(set, "Queue not found");

      const status = (query.status as string) || "completed";
      if (!["completed", "failed"].includes(status))
        return badRequest(set, "Status must be completed or failed");

      const grace = parseInt(query.grace as string) || 0;

      try {
        const cleaned = await queue.clean(
          grace,
          1000,
          status as "completed" | "failed",
        );
        return {
          success: true,
          message: `Cleaned ${cleaned.length} ${status} jobs`,
          cleaned: cleaned.length,
        };
      } catch (error) {
        console.error("Error cleaning queue:", error);
        return serverError(set, "Failed to clean queue");
      }
    },
    { params: t.Object({ name: t.String() }) },
  )

  // GET /api/admin/jobs/history - Recent job history across all queues
  .get("/jobs/history", async ({ query }) => {
    const limit = parseInt(query.limit as string) || 50;

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

    return { jobs: allJobs.slice(0, limit) };
  });
