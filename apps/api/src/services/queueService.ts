import {
  Queue,
  Worker,
  type Job,
  type QueueOptions,
  type JobsOptions,
} from "bullmq";
import { redisConnection } from "@rawkoon/api/db/redis";
import {
  PERF_TIMING_ENABLED,
  recordJobDuration,
} from "@rawkoon/api/services/perf/perfStore";

// Define queue names
export const QUEUE_NAMES = {
  EXPRESS: "express",
  SCHEDULED_TASKS: "scheduled-tasks",
  LIBRARY_MIGRATE: "library-migrate",
  LIBRARY_REINDEX_LANGUAGES: "library-reindex-languages",
  LIBRARY_REMUX: "library-remux",
  LIBRARY_POST_PROCESS: "library-post-process",
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

// Job names for Scheduled Tasks
export const SCHEDULED_JOB_NAMES = {
  CLEANUP_NOTIFICATIONS: "cleanup-notifications",
  REFRESH_UPCOMING: "refresh-upcoming",
  CHECK_MOVIE_RELEASE_REMINDERS: "check-movie-release-reminders",
  CHECK_LIBRARY_MOVIE_RELEASES: "check-library-movie-releases",
  CHECK_LIBRARY_EPISODE_RELEASES: "check-library-episode-releases",
  SYNC_LIBRARY_SHOW_EPISODES: "sync-library-show-episodes",
  CHECK_LIBRARY_DOWNLOAD_COMPLETION: "check-library-download-completion",
  CHECK_LIBRARY_INTEGRITY: "check-library-integrity",
  POLL_INDEXER_RSS: "poll-indexer-rss",
  UPGRADE_MEDIA_SEARCH: "upgrade-media-search",
  REFRESH_GITHUB_RELEASES: "refresh-github-releases",
  SYNC_LIBRARY_ATTENTION_ALERTS: "sync-library-attention-alerts",
  CHECK_BOOK_RELEASES: "check-book-releases",
  CHECK_AUTHOR_RELEASES: "check-author-releases",
} as const;

// Job names for Notifications queue
export const NOTIFICATION_JOB_NAMES = {
  SEND_NOTIFICATION: "send-notification",
} as const;

/** Job name on the post-process queue — see services/downloadOutcome.ts. */
export const POST_PROCESS_JOB_NAME = "post-process";

const defaultQueueOptions: QueueOptions = {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: "exponential",
      delay: 1000,
    },
    removeOnComplete: { age: 24 * 3600 },
    removeOnFail: { age: 7 * 24 * 3600 },
  },
};

// Initialize Queues
export const expressQueue = new Queue(QUEUE_NAMES.EXPRESS, defaultQueueOptions);
export const scheduledTasksQueue = new Queue(
  QUEUE_NAMES.SCHEDULED_TASKS,
  defaultQueueOptions,
);
export const libraryMigrateQueue = new Queue(QUEUE_NAMES.LIBRARY_MIGRATE, {
  ...defaultQueueOptions,
  defaultJobOptions: {
    attempts: 1, // migration is idempotent (upserts) — no auto-retry needed
    removeOnComplete: { age: 7 * 24 * 3600 }, // keep result 7 days
    removeOnFail: { age: 7 * 24 * 3600 },
  },
});
export const libraryReindexLanguagesQueue = new Queue(
  QUEUE_NAMES.LIBRARY_REINDEX_LANGUAGES,
  {
    ...defaultQueueOptions,
    defaultJobOptions: {
      attempts: 1,
      removeOnComplete: { age: 7 * 24 * 3600 },
      removeOnFail: { age: 7 * 24 * 3600 },
    },
  },
);
export const libraryRemuxQueue = new Queue(QUEUE_NAMES.LIBRARY_REMUX, {
  ...defaultQueueOptions,
  defaultJobOptions: {
    attempts: 1,
    removeOnComplete: { age: 7 * 24 * 3600 },
    removeOnFail: { age: 7 * 24 * 3600 },
  },
});
// Post-process places a completed download into the library — fs-heavy, one
// file at a time. No auto-retry: `postProcess` is not proven idempotent across
// both the single-file and season-pack pipelines, and retrying a half-placed
// file is worse than surfacing the failure on the row.
export const libraryPostProcessQueue = new Queue(
  QUEUE_NAMES.LIBRARY_POST_PROCESS,
  {
    ...defaultQueueOptions,
    defaultJobOptions: {
      attempts: 1,
      removeOnComplete: { age: 24 * 3600 },
      removeOnFail: { age: 7 * 24 * 3600 },
    },
  },
);
const queues: Record<QueueName, Queue> = {
  [QUEUE_NAMES.EXPRESS]: expressQueue,
  [QUEUE_NAMES.SCHEDULED_TASKS]: scheduledTasksQueue,
  [QUEUE_NAMES.LIBRARY_MIGRATE]: libraryMigrateQueue,
  [QUEUE_NAMES.LIBRARY_REINDEX_LANGUAGES]: libraryReindexLanguagesQueue,
  [QUEUE_NAMES.LIBRARY_REMUX]: libraryRemuxQueue,
  [QUEUE_NAMES.LIBRARY_POST_PROCESS]: libraryPostProcessQueue,
};

/**
 * Utility to add a job to a specific queue
 */
export async function addJob<T = Record<string, unknown>>(
  queueName: QueueName,
  jobName: string,
  data: T,
  opts?: JobsOptions,
) {
  const queue = queues[queueName];
  if (!queue) throw new Error(`Queue ${queueName} not found`);
  return queue.add(jobName, data, opts);
}

/**
 * Attach perf-baseline duration listeners to a worker. No-op unless
 * PERF_TIMING_ENABLED=true, so normal runs add no listeners and no overhead.
 * Uses BullMQ's own job.finishedOn - job.processedOn, so no job handler changes.
 */
function trackJobDurations(worker: Worker, queueName: string): Worker {
  if (!PERF_TIMING_ENABLED) return worker;
  worker.on("completed", (job: Job) => {
    recordJobDuration({
      queue: queueName,
      name: job.name,
      ms: (job.finishedOn ?? 0) - (job.processedOn ?? 0),
      outcome: "completed",
      at: Date.now(),
    });
  });
  worker.on("failed", (job) => {
    if (!job) return;
    recordJobDuration({
      queue: queueName,
      name: job.name,
      ms: (job.finishedOn ?? 0) - (job.processedOn ?? 0),
      outcome: "failed",
      at: Date.now(),
    });
  });
  return worker;
}

/**
 * Initialize Workers
 */
export function initWorkers() {
  console.log("🚀 Initializing BullMQ workers...");

  // 1. Fast Worker — notifications + activity logs (concurrency 10)
  trackJobDurations(
    new Worker(
      QUEUE_NAMES.EXPRESS,
      async (job: Job) => {
        if (job.name.startsWith("log:")) {
          const { processActivityLogJob } = await import(
            "./jobs/activityLogWorker"
          );
          return processActivityLogJob(job);
        }
        const { processNotificationJob } = await import(
          "./jobs/notificationWorker"
        );
        return processNotificationJob(job);
      },
      { connection: redisConnection, concurrency: 10 },
    ),
    QUEUE_NAMES.EXPRESS,
  );

  // 2. Scheduled Tasks Worker
  trackJobDurations(
    new Worker(
      QUEUE_NAMES.SCHEDULED_TASKS,
      async (job: Job) => {
        const { processScheduledJob } = await import(
          "./jobs/scheduledTasksWorker"
        );
        return processScheduledJob(job);
      },
      { connection: redisConnection, concurrency: 3 }, // Allow a few scheduled tasks at once
    ),
    QUEUE_NAMES.SCHEDULED_TASKS,
  );

  // 3. Library Migrate Worker (concurrency 1 — one migration at a time)
  trackJobDurations(
    new Worker(
      QUEUE_NAMES.LIBRARY_MIGRATE,
      async (job: Job) => {
        const { processLibraryMigrateJob } = await import(
          "./jobs/libraryMigrateWorker"
        );
        return processLibraryMigrateJob(job);
      },
      { connection: redisConnection, concurrency: 1 },
    ),
    QUEUE_NAMES.LIBRARY_MIGRATE,
  );

  // 6. Library Reindex Languages Worker (concurrency 1)
  trackJobDurations(
    new Worker(
      QUEUE_NAMES.LIBRARY_REINDEX_LANGUAGES,
      async (job: Job) => {
        const { processLibraryReindexLanguagesJob } = await import(
          "./jobs/libraryReindexLanguagesWorker"
        );
        return processLibraryReindexLanguagesJob(job);
      },
      { connection: redisConnection, concurrency: 1 },
    ),
    QUEUE_NAMES.LIBRARY_REINDEX_LANGUAGES,
  );

  // 7. Library Remux Worker (concurrency 1 — one file at a time)
  trackJobDurations(
    new Worker(
      QUEUE_NAMES.LIBRARY_REMUX,
      async (job: Job) => {
        const { processLibraryRemuxFileJob } = await import(
          "./jobs/libraryRemuxWorker"
        );
        return processLibraryRemuxFileJob(job);
      },
      { connection: redisConnection, concurrency: 1 },
    ),
    QUEUE_NAMES.LIBRARY_REMUX,
  );

  // 8. Library Post-Process Worker (concurrency 1 — one file at a time)
  trackJobDurations(
    new Worker(
      QUEUE_NAMES.LIBRARY_POST_PROCESS,
      async (job: Job) => {
        const { processPostProcessJob } = await import(
          "./jobs/postProcessWorker"
        );
        return processPostProcessJob(job);
      },
      { connection: redisConnection, concurrency: 1 },
    ),
    QUEUE_NAMES.LIBRARY_POST_PROCESS,
  );
}

/**
 * Setup repeatable jobs
 */
export async function setupScheduledJobs() {
  console.log("⏰ Setting up scheduled jobs...");

  const jobs = [
    { name: SCHEDULED_JOB_NAMES.CLEANUP_NOTIFICATIONS, pattern: "0 0 * * *" },
    { name: SCHEDULED_JOB_NAMES.REFRESH_UPCOMING, pattern: "30 */12 * * *" },
    {
      name: SCHEDULED_JOB_NAMES.CHECK_MOVIE_RELEASE_REMINDERS,
      pattern: "20 * * * *",
    }, // hourly :20 — day-before movie (watchlist)
    {
      name: SCHEDULED_JOB_NAMES.CHECK_LIBRARY_MOVIE_RELEASES,
      pattern: "0 */6 * * *",
    },
    {
      name: SCHEDULED_JOB_NAMES.CHECK_LIBRARY_EPISODE_RELEASES,
      pattern: "0 */6 * * *",
    },
    {
      name: SCHEDULED_JOB_NAMES.SYNC_LIBRARY_SHOW_EPISODES,
      pattern: "0 */6 * * *",
    },
    {
      name: SCHEDULED_JOB_NAMES.CHECK_LIBRARY_DOWNLOAD_COMPLETION,
      pattern: "*/20 * * * * *",
    },
    {
      name: SCHEDULED_JOB_NAMES.CHECK_LIBRARY_INTEGRITY,
      pattern: "0 3 * * 0",
    },
    {
      name: SCHEDULED_JOB_NAMES.POLL_INDEXER_RSS,
      // Offset off :00 so it never shares a tick with the 6-hourly release
      // sweeps below, which hit the same indexer for the same wanted items.
      // The duplicate-grab guard in grabRelease is the real safety net; this
      // just stops the two jobs racing in the first place.
      pattern: "7-59/15 * * * *",
    },
    {
      name: SCHEDULED_JOB_NAMES.REFRESH_GITHUB_RELEASES,
      pattern: "0 */6 * * *",
    },
    {
      name: SCHEDULED_JOB_NAMES.SYNC_LIBRARY_ATTENTION_ALERTS,
      pattern: "12 * * * *",
    },
    {
      name: SCHEDULED_JOB_NAMES.CHECK_BOOK_RELEASES,
      // Offset off :00 so the book sweep never shares a tick with the media
      // release sweeps above, which hit the same indexer.
      pattern: "40 */6 * * *",
    },
    {
      name: SCHEDULED_JOB_NAMES.CHECK_AUTHOR_RELEASES,
      // Daily: Google Books is the rate-limited, flaky dependency here, and a
      // newly published title is not time-critical.
      pattern: "50 4 * * *",
    },
  ];

  const repeatableJobs = await scheduledTasksQueue.getRepeatableJobs();
  for (const job of repeatableJobs) {
    await scheduledTasksQueue.removeRepeatableByKey(job.key);
  }

  for (const job of jobs) {
    await scheduledTasksQueue.add(
      job.name,
      {},
      {
        repeat: { pattern: job.pattern },
      },
    );
    console.log(`   - Scheduled ${job.name} with pattern ${job.pattern}`);
  }
}
