import type { Job } from "bullmq";
import { SCHEDULED_JOB_NAMES } from "@rawkoon/api/services/queueService";

/**
 * Worker to process scheduled (repeatable) jobs and on-demand background tasks
 */
export async function processScheduledJob(job: Job) {
  const startedAt = Date.now();
  console.log(`[ScheduledTasksWorker] Starting job: ${job.name} (${job.id})`);

  try {
    switch (job.name) {
      case SCHEDULED_JOB_NAMES.CLEANUP_NOTIFICATIONS: {
        const { cleanupOldNotifications } = await import(
          "../../workers/cleanupNotifications"
        );
        await cleanupOldNotifications();
        break;
      }
      case SCHEDULED_JOB_NAMES.REFRESH_UPCOMING: {
        const { refreshUpcoming } = await import(
          "../../workers/refreshUpcoming"
        );
        await refreshUpcoming({ trigger: "queue" });
        break;
      }
      case SCHEDULED_JOB_NAMES.CHECK_MOVIE_RELEASE_REMINDERS: {
        const { checkMovieReleaseReminders } = await import(
          "../../workers/checkMovieReleaseReminders"
        );
        await checkMovieReleaseReminders();
        break;
      }
      case SCHEDULED_JOB_NAMES.CHECK_LIBRARY_MOVIE_RELEASES: {
        const { checkMovieReleases } = await import(
          "../../workers/checkMovieReleases"
        );
        await checkMovieReleases();
        break;
      }
      case SCHEDULED_JOB_NAMES.CHECK_LIBRARY_EPISODE_RELEASES: {
        const { checkEpisodeReleases } = await import(
          "../../workers/checkEpisodeReleases"
        );
        await checkEpisodeReleases();
        break;
      }
      case SCHEDULED_JOB_NAMES.SYNC_LIBRARY_SHOW_EPISODES: {
        const { syncShowEpisodes } = await import(
          "../../workers/syncShowEpisodes"
        );
        await syncShowEpisodes();
        break;
      }
      case SCHEDULED_JOB_NAMES.CHECK_LIBRARY_DOWNLOAD_COMPLETION: {
        const { checkDownloadCompletion } = await import(
          "../../workers/checkDownloadCompletion"
        );
        await checkDownloadCompletion();
        break;
      }
      case SCHEDULED_JOB_NAMES.CHECK_LIBRARY_INTEGRITY: {
        const { runLibraryIntegrityCheck } = await import(
          "../libraryIntegrityRun"
        );
        const { trigger } = job.data as { trigger?: string };
        await runLibraryIntegrityCheck({ trigger: trigger ?? "cron" });
        break;
      }
      case SCHEDULED_JOB_NAMES.POLL_INDEXER_RSS: {
        const { pollIndexerRss } = await import("../../workers/pollIndexerRss");
        const { saveRssRunResult } = await import("../rssRunStatus");
        const startedAt = new Date().toISOString();
        try {
          const stats = await pollIndexerRss();
          if (stats) {
            await saveRssRunResult({
              ...stats,
              status: "success",
              started_at: startedAt,
              completed_at: new Date().toISOString(),
              error: null,
            });
          }
        } catch (e) {
          await saveRssRunResult({
            status: "error",
            started_at: startedAt,
            completed_at: new Date().toISOString(),
            releases_found: 0,
            releases_grabbed: 0,
            releases_grabbed_by_ai: 0,
            indexers: [],
            error: e instanceof Error ? e.message : String(e),
          });
          throw e;
        }
        break;
      }
      case SCHEDULED_JOB_NAMES.UPGRADE_MEDIA_SEARCH: {
        const { upgradeMediaSearch } = await import(
          "../../workers/upgradeMediaSearch"
        );
        const { mediaId, episodeId } = job.data as {
          mediaId: number;
          episodeId?: number | null;
        };
        await upgradeMediaSearch({ mediaId, episodeId });
        break;
      }
      case SCHEDULED_JOB_NAMES.REFRESH_GITHUB_RELEASES: {
        const { refreshGitHubReleases } = await import("../githubReleases");
        await refreshGitHubReleases({ notifyAdmins: true });
        break;
      }
      case SCHEDULED_JOB_NAMES.SYNC_LIBRARY_ATTENTION_ALERTS: {
        const { runSyncLibraryAttentionAlerts } = await import(
          "../../workers/syncLibraryAttentionAlerts"
        );
        await runSyncLibraryAttentionAlerts();
        break;
      }
      default:
        console.warn(`[ScheduledTasksWorker] Unknown job name: ${job.name}`);
        return { success: false, error: "Unknown job name" };
    }

    const duration = Date.now() - startedAt;
    console.log(
      `[ScheduledTasksWorker] Completed job: ${job.name} in ${duration}ms`,
    );
    return { success: true, duration };
  } catch (error) {
    console.error(`[ScheduledTasksWorker] Job failed: ${job.name}`, error);
    throw error;
  }
}
