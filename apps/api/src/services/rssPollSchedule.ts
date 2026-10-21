import type { Queue } from "bullmq";
import {
  DEFAULT_RSS_POLL_INTERVAL_MINUTES,
  isRssPollInterval,
  rssPollCron,
  type RssPollIntervalMinutes,
} from "@rawkoon/shared/utils";
import { prisma } from "@rawkoon/api/db";
import type { SCHEDULED_JOB_NAMES } from "@rawkoon/api/services/queueService";
import { scheduledTasksQueue } from "@rawkoon/api/services/queueService";

// Literal, not SCHEDULED_JOB_NAMES: test preload replaces that module's constants.
export const RSS_POLL_JOB_NAME =
  "poll-indexer-rss" satisfies (typeof SCHEDULED_JOB_NAMES)[keyof typeof SCHEDULED_JOB_NAMES];

type SchedulerQueue = Pick<Queue, "upsertJobScheduler">;

async function readStoredInterval(): Promise<number | undefined> {
  const row = await prisma.mediaSettings.findUnique({
    where: { id: 1 },
    select: { rssPollIntervalMinutes: true },
  });
  return row?.rssPollIntervalMinutes;
}

/** The stored interval, or the default when the row is missing or holds an interval no longer offered. */
export async function loadRssPollInterval(
  read: () => Promise<number | null | undefined> = readStoredInterval,
): Promise<RssPollIntervalMinutes> {
  let stored: number | null | undefined;
  try {
    stored = await read();
  } catch {
    return DEFAULT_RSS_POLL_INTERVAL_MINUTES;
  }
  if (stored === undefined || stored === null) {
    return DEFAULT_RSS_POLL_INTERVAL_MINUTES;
  }
  if (isRssPollInterval(stored)) return stored;
  console.warn(
    `Stored RSS poll interval ${stored} is not offered; using the default`,
  );
  return DEFAULT_RSS_POLL_INTERVAL_MINUTES;
}

export async function applyRssPollSchedule(
  minutes: RssPollIntervalMinutes,
  queue: SchedulerQueue = scheduledTasksQueue,
): Promise<void> {
  await queue.upsertJobScheduler(
    RSS_POLL_JOB_NAME,
    { pattern: rssPollCron(minutes) },
    { name: RSS_POLL_JOB_NAME, data: {} },
  );
}

/** Same contract as rescheduleThenPersist: on any failure the poll goes back on `previous`. */
export async function rescheduleRssPollThenPersist(
  minutes: RssPollIntervalMinutes,
  previous: RssPollIntervalMinutes,
  persist: () => Promise<void>,
  queue: SchedulerQueue = scheduledTasksQueue,
): Promise<void> {
  try {
    await applyRssPollSchedule(minutes, queue);
    await persist();
  } catch (err) {
    await applyRssPollSchedule(previous, queue).catch(() => {});
    throw err;
  }
}
