/**
 * Day-before theatrical release reminders for watchlist movies (TMDB release date).
 * Runs on a schedule; skips night hours (same window as other user notifications).
 */

import type { Prisma } from "@prisma/client";
import { APP_PATHS } from "@rawkoon/shared/constants";
import { buildNotificationUrl } from "@rawkoon/shared/utils";
import { prisma } from "@rawkoon/api/db";
import { loadTmdbConfig } from "@rawkoon/api/utils/medias/tmdbFetcherCore";
import { fetchMediaDetails } from "@rawkoon/api/utils/medias/tmdbFetcherDetails";
import { formatDateInTimezone } from "@rawkoon/api/utils";
import { createAndQueueNotification } from "./notificationService";
import { notificationCopy } from "@rawkoon/api/services/notification/notificationCopy";
import { getNotificationTarget } from "@rawkoon/api/services/notification/notificationPreferences";

type ReminderItem = Prisma.WatchlistItemGetPayload<{
  include: { user: { select: { id: true; locale: true } } };
}>;

function dbDateToYmd(d: Date | null): string | null {
  if (!d) return null;
  return d.toISOString().slice(0, 10);
}

/** Subtract 1 day timezone-safely in UTC. */
function dayBefore(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  t.setUTCDate(t.getUTCDate() - 1);
  return t.toISOString().slice(0, 10);
}

/** Returns true when a reminder was sent. */
async function remindIfDue(
  item: ReminderItem,
  apiKey: string,
  todayStr: string,
): Promise<boolean> {
  let releaseYmd: string | null = dbDateToYmd(item.movieReleaseDate);
  let reminderSentFor = item.releaseReminderSentFor;

  // TMDB dates move; re-confirm a cached date on the one day a reminder can fire.
  const dueToday =
    releaseYmd !== null &&
    reminderSentFor !== releaseYmd &&
    dayBefore(releaseYmd) === todayStr;

  if (!releaseYmd || dueToday) {
    const details = await fetchMediaDetails(apiKey, "movie", item.tmdbId);
    const prevYmd = releaseYmd;
    releaseYmd = details.release_date;
    if (releaseYmd !== prevYmd) {
      if (releaseYmd) reminderSentFor = null;
      await prisma.watchlistItem.update({
        where: { id: item.id },
        data: {
          movieReleaseDate: releaseYmd
            ? new Date(`${releaseYmd}T00:00:00.000Z`)
            : null,
          ...(releaseYmd ? { releaseReminderSentFor: null } : {}),
        },
      });
    }
    if (!releaseYmd) return false;
  }

  // Skip movies releasing more than 5 days from now
  const releaseMs = new Date(`${releaseYmd}T00:00:00.000Z`).getTime();
  if (releaseMs - Date.now() > 5 * 24 * 60 * 60 * 1000) return false;
  if (reminderSentFor === releaseYmd) return false;
  if (todayStr !== dayBefore(releaseYmd)) return false;

  const target = await getNotificationTarget(item.userId);
  const locale = target?.locale ?? item.user.locale ?? "en";
  const title = notificationCopy(locale, "movie_release_reminder_title", {
    title: item.title,
  });
  const body = notificationCopy(locale, "movie_release_reminder_body", {
    title: item.title,
  });

  const ok = await createAndQueueNotification(
    item.userId,
    title,
    body,
    "movie_release_reminder",
    buildNotificationUrl(APP_PATHS.findWatchlist),
    { tmdb_id: item.tmdbId, watchlist_item_id: item.id },
    item.posterUrl ?? undefined,
    { preferenceKey: "movie_release_reminder" },
  );
  if (!ok) return false;

  await prisma.watchlistItem.update({
    where: { id: item.id },
    data: { releaseReminderSentFor: releaseYmd },
  });
  return true;
}

export async function checkMovieReleaseReminders(): Promise<void> {
  console.log("[CRON] Running checkMovieReleaseReminders...");

  const tmdbConfig = await loadTmdbConfig();
  if (!tmdbConfig?.api_key) {
    console.log("[CRON] checkMovieReleaseReminders: TMDB not configured, skip");
    return;
  }

  const items = await prisma.watchlistItem.findMany({
    where: { mediaType: "movie" },
    include: { user: { select: { id: true, locale: true } } },
  });

  const todayStr = formatDateInTimezone(new Date());
  let sent = 0;

  for (const item of items) {
    // One failing item must not skip every later user's reminder.
    try {
      if (await remindIfDue(item, tmdbConfig.api_key, todayStr)) sent++;
    } catch (e) {
      console.warn(
        `[CRON] checkMovieReleaseReminders: failed for watchlist item ${item.id}:`,
        e,
      );
    }
  }

  if (sent > 0) {
    console.log(
      `[CRON] checkMovieReleaseReminders: sent ${sent} notification(s)`,
    );
  }
}
