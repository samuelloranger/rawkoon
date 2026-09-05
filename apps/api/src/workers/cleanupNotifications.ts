/**
 * Cron job: daily retention pass over append-only diagnostic tables.
 * Runs daily at midnight (SCHEDULED_JOB_NAMES.CLEANUP_NOTIFICATIONS).
 */

import { prisma } from "@rawkoon/api/db";

const NOTIFICATION_RETENTION_DAYS = 30;

// activity_logs backs the dashboard feed but is dominated by cron/push-subscription
// bookkeeping; 30 days matches notifications and the feed is capped anyway.
const ACTIVITY_LOG_RETENTION_DAYS = 30;

/**
 * qbittorrent_request_logs is written fire-and-forget on every qBittorrent HTTP
 * call and read only by the `qbittorrent:request-logs` / `qbittorrentClientDebug`
 * CLIs — nothing reads it at runtime. With no retention it reached 327k rows /
 * 114 MB on a real instance in five months. Successful requests age out quickly;
 * failures are what anyone actually goes looking for, so they are kept longer.
 */
const QBITTORRENT_LOG_SUCCESS_RETENTION_DAYS = 7;
const QBITTORRENT_LOG_FAILURE_RETENTION_DAYS = 30;

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

/**
 * Clean up notifications older than 30 days
 */
export async function cleanupOldNotifications(): Promise<number> {
  console.log("[CRON] Running cleanupOldNotifications...");

  try {
    const result = await prisma.notification.deleteMany({
      where: {
        createdAt: { lt: daysAgo(NOTIFICATION_RETENTION_DAYS).toISOString() },
      },
    });

    const deletedCount = result.count;

    console.log(
      `[CRON] Cleaned up ${deletedCount} notifications older than ${NOTIFICATION_RETENTION_DAYS} days`,
    );
    return deletedCount;
  } catch (error) {
    console.error("[CRON] Error cleaning up old notifications:", error);
    return 0;
  }
}

/** Prune activity_logs older than the retention window. */
export async function cleanupOldActivityLogs(): Promise<number> {
  console.log("[CRON] Running cleanupOldActivityLogs...");

  try {
    const result = await prisma.activityLog.deleteMany({
      where: {
        createdAt: { lt: daysAgo(ACTIVITY_LOG_RETENTION_DAYS) },
      },
    });

    console.log(
      `[CRON] Cleaned up ${result.count} activity logs older than ${ACTIVITY_LOG_RETENTION_DAYS} days`,
    );
    return result.count;
  } catch (error) {
    console.error("[CRON] Error cleaning up old activity logs:", error);
    return 0;
  }
}

/** Prune qBittorrent request logs. Successes age out first, failures are kept longer. */
export async function cleanupQbittorrentRequestLogs(): Promise<number> {
  console.log("[CRON] Running cleanupQbittorrentRequestLogs...");

  try {
    // Two statements rather than one OR: each is a plain range delete the
    // planner can serve from ix_qbittorrent_request_logs_ok_created_at.
    const successes = await prisma.qbittorrentRequestLog.deleteMany({
      where: {
        ok: true,
        createdAt: { lt: daysAgo(QBITTORRENT_LOG_SUCCESS_RETENTION_DAYS) },
      },
    });
    const rest = await prisma.qbittorrentRequestLog.deleteMany({
      where: {
        createdAt: { lt: daysAgo(QBITTORRENT_LOG_FAILURE_RETENTION_DAYS) },
      },
    });

    const deletedCount = successes.count + rest.count;
    console.log(
      `[CRON] Cleaned up ${deletedCount} qBittorrent request logs ` +
        `(${successes.count} successes older than ${QBITTORRENT_LOG_SUCCESS_RETENTION_DAYS}d, ` +
        `${rest.count} older than ${QBITTORRENT_LOG_FAILURE_RETENTION_DAYS}d)`,
    );
    return deletedCount;
  } catch (error) {
    console.error("[CRON] Error cleaning up qBittorrent request logs:", error);
    return 0;
  }
}
