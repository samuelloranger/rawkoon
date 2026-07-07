import type { LucideIcon } from "lucide-react";
import {
  Eraser,
  Film,
  Clapperboard,
  Tv,
  RefreshCw,
  Download,
  ShieldAlert,
  Package,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Job action config
// ---------------------------------------------------------------------------

export type JobAction =
  | "cleanup_notifications"
  | "refresh_upcoming"
  | "check_movie_release_reminders"
  | "check_library_movie_releases"
  | "check_library_episode_releases"
  | "sync_library_show_episodes"
  | "check_library_download_completion"
  | "sync_library_attention_alerts"
  | "check_library_integrity"
  | "refresh_github_releases";

export type JobConfig = {
  action: JobAction;
  jobNames: string[];
  Icon: LucideIcon;
  labelKey: string;
  descriptionKey: string;
};

export const JOBS: JobConfig[] = [
  {
    action: "cleanup_notifications",
    jobNames: ["cleanup-notifications"],
    Icon: Eraser,
    labelKey: "settings.jobs.actions.cleanupNotifications.label",
    descriptionKey: "settings.jobs.actions.cleanupNotifications.description",
  },
  {
    action: "refresh_upcoming",
    jobNames: ["refresh-upcoming"],
    Icon: Film,
    labelKey: "settings.jobs.actions.refreshUpcoming.label",
    descriptionKey: "settings.jobs.actions.refreshUpcoming.description",
  },
  {
    action: "check_movie_release_reminders",
    jobNames: ["check-movie-release-reminders"],
    Icon: Clapperboard,
    labelKey: "settings.jobs.actions.checkMovieReleaseReminders.label",
    descriptionKey:
      "settings.jobs.actions.checkMovieReleaseReminders.description",
  },
  {
    action: "check_library_movie_releases",
    jobNames: ["check-library-movie-releases"],
    Icon: Film,
    labelKey: "settings.jobs.actions.checkLibraryMovieReleases.label",
    descriptionKey:
      "settings.jobs.actions.checkLibraryMovieReleases.description",
  },
  {
    action: "check_library_episode_releases",
    jobNames: ["check-library-episode-releases"],
    Icon: Tv,
    labelKey: "settings.jobs.actions.checkLibraryEpisodeReleases.label",
    descriptionKey:
      "settings.jobs.actions.checkLibraryEpisodeReleases.description",
  },
  {
    action: "sync_library_show_episodes",
    jobNames: ["sync-library-show-episodes"],
    Icon: RefreshCw,
    labelKey: "settings.jobs.actions.syncLibraryShowEpisodes.label",
    descriptionKey: "settings.jobs.actions.syncLibraryShowEpisodes.description",
  },
  {
    action: "check_library_download_completion",
    jobNames: ["check-library-download-completion"],
    Icon: Download,
    labelKey: "settings.jobs.actions.checkLibraryDownloadCompletion.label",
    descriptionKey:
      "settings.jobs.actions.checkLibraryDownloadCompletion.description",
  },
  {
    action: "sync_library_attention_alerts",
    jobNames: ["sync-library-attention-alerts"],
    Icon: Clapperboard,
    labelKey: "settings.jobs.actions.syncLibraryAttentionAlerts.label",
    descriptionKey:
      "settings.jobs.actions.syncLibraryAttentionAlerts.description",
  },
  {
    action: "check_library_integrity",
    jobNames: ["check-library-integrity"],
    Icon: ShieldAlert,
    labelKey: "settings.jobs.actions.checkLibraryIntegrity.label",
    descriptionKey: "settings.jobs.actions.checkLibraryIntegrity.description",
  },
  {
    action: "refresh_github_releases",
    jobNames: ["refresh-github-releases"],
    Icon: Package,
    labelKey: "settings.jobs.actions.refreshGithubReleases.label",
    descriptionKey: "settings.jobs.actions.refreshGithubReleases.description",
  },
];
