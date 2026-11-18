import type { SCHEDULED_JOB_NAMES } from "@rawkoon/api/services/queueService";
import {
  DEFAULT_RELEASE_CHECK_CRON,
  DEFAULT_RSS_POLL_INTERVAL_MINUTES,
  rssPollCron,
} from "@rawkoon/shared/utils";

type ScheduledJobName =
  (typeof SCHEDULED_JOB_NAMES)[keyof typeof SCHEDULED_JOB_NAMES];

export interface ScheduledJobDef {
  name: ScheduledJobName;
  pattern: string;
}

// The fallbacks the settings loaders use; only the two patterns ever vary —
// never the names — so the doctor can call buildScheduledJobs() bare.
const DEFAULT_JOB_PATTERNS = {
  releaseCheckCron: DEFAULT_RELEASE_CHECK_CRON,
  rssPollPattern: rssPollCron(DEFAULT_RSS_POLL_INTERVAL_MINUTES),
};

/**
 * The scheduler definitions startup registers — the single source the doctor
 * compares Valkey's registered schedulers against. `upgrade-media-search` and
 * `search-on-add` are on-demand-only (enqueued per title by the grab/search
 * paths) and deliberately absent, or the doctor would warn on healthy
 * instances. Kept beside queueService with literal job names (the
 * rssPollSchedule precedent): the unit-test preload swaps queueService
 * wholesale, and a type-only import here keeps this module free of it.
 */
export function buildScheduledJobs(
  patterns: {
    releaseCheckCron: string;
    rssPollPattern: string;
  } = DEFAULT_JOB_PATTERNS,
): ScheduledJobDef[] {
  return [
    { name: "cleanup-notifications", pattern: "0 0 * * *" },
    { name: "refresh-upcoming", pattern: "30 */12 * * *" },
    // hourly :20 — day-before movie (watchlist)
    { name: "check-movie-release-reminders", pattern: "20 * * * *" },
    {
      name: "check-library-movie-releases",
      pattern: patterns.releaseCheckCron,
    },
    {
      name: "check-library-episode-releases",
      pattern: patterns.releaseCheckCron,
    },
    { name: "sync-library-show-episodes", pattern: "0 */6 * * *" },
    { name: "check-library-download-completion", pattern: "*/20 * * * * *" },
    { name: "check-library-integrity", pattern: "0 3 * * 0" },
    {
      // rssPollCron keeps it off :00 so it never shares a tick with the
      // release sweeps, which hit the same indexer for the same wanted items.
      // The duplicate-grab guard in grabRelease is the real safety net; this
      // just stops the two jobs racing in the first place.
      name: "poll-indexer-rss",
      pattern: patterns.rssPollPattern,
    },
    { name: "refresh-github-releases", pattern: "0 */6 * * *" },
    { name: "sync-library-attention-alerts", pattern: "12 * * * *" },
    {
      // Backstop for the add paths that carry no TMDB translations, and the
      // heal path after a retitle. Offset off the other library jobs.
      name: "sync-localized-titles",
      pattern: "27 * * * *",
    },
    {
      // Offset off :00 so the book sweep never shares a tick with the media
      // release sweeps above, which hit the same indexer.
      name: "check-book-releases",
      pattern: "40 */6 * * *",
    },
    {
      // Daily: Google Books is the rate-limited, flaky dependency here, and a
      // newly published title is not time-critical.
      name: "check-author-releases",
      pattern: "50 4 * * *",
    },
    {
      // Offset off the RSS poll's :07 ticks at the default interval; both list the client's torrents.
      name: "sweep-seeding-torrents",
      pattern: "3-59/15 * * * *",
    },
    {
      // Offset off the RSS poll's ticks at every interval (they fall on :02/:07) so a due grab doesn't race a poll.
      name: "process-pending-releases",
      pattern: "1-59/5 * * * *",
    },
    {
      // No-op while clips are disabled; picks up newly imported movies and seasons.
      name: "reconcile-preview-clips",
      pattern: "*/10 * * * *",
    },
    {
      // Nightly, off the other 3 AM job; TMDB facts for shelf rules, then auto-join.
      name: "sweep-title-facts",
      pattern: "20 3 * * *",
    },
    {
      // Bounds how long a disabled or deleted Jellyfin user keeps a session.
      name: "sync-jellyfin-users",
      pattern: "*/15 * * * *",
    },
  ];
}
