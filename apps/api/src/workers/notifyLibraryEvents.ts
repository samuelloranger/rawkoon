import { buildLibraryNotificationUrl } from "@rawkoon/shared/utils";
import {
  episodeDisplayName,
  formatSeason,
  notificationCopy,
  truncateReleaseTitle,
} from "@rawkoon/api/services/notification/notificationCopy";
import { downloadLifecycleKey } from "@rawkoon/api/services/notification/notificationLifecycle";
import {
  loadEpisodeContext,
  loadMediaContext,
  notifyAdmins,
  seasonCode,
  subjectMetadata,
} from "@rawkoon/api/workers/libraryNotificationHelpers";

export type LibraryDownloadedOpts = {
  mediaId: number;
  /** The grab this download completes; its notification is rewritten instead of adding one. */
  downloadHistoryId?: number | null;
  /** A grab whose file another grab already placed: settle its row without a push. */
  quiet?: boolean;
  episodeId?: number | null;
  season?: number | null;
  episodeCount?: number | null;
  isUpgrade?: boolean;
};

export async function notifyAdminsMediaDownloaded(
  opts: LibraryDownloadedOpts | number,
  legacyEpisodeId?: number | null,
): Promise<void> {
  const parsed: LibraryDownloadedOpts =
    typeof opts === "number"
      ? { mediaId: opts, episodeId: legacyEpisodeId }
      : opts;

  const media = await loadMediaContext(parsed.mediaId);
  if (!media) return;

  const episode =
    parsed.episodeId != null
      ? await loadEpisodeContext(parsed.episodeId)
      : null;

  await notifyAdmins(
    (locale) => {
      if (media.type === "movie") {
        return {
          type: "library_media_downloaded",
          title: notificationCopy(locale, "libraryMovieDownloadedTitle"),
          body: notificationCopy(locale, "libraryMediaDownloadedBody", {
            show: media.label,
          }),
          url: buildLibraryNotificationUrl(media.mediaId),
        };
      }

      if (episode) {
        const epName = episodeDisplayName(episode.title);
        const titleKey = parsed.isUpgrade
          ? "libraryEpisodeUpgradedTitle"
          : "libraryEpisodeDownloadedTitle";
        return {
          type: "library_media_downloaded",
          title: notificationCopy(locale, titleKey, { code: episode.code }),
          body: notificationCopy(locale, "libraryEpisodeDownloadedBody", {
            show: media.label,
            code: episode.code,
            episodeName: epName ?? "",
          }),
          url: buildLibraryNotificationUrl(media.mediaId, {
            season: episode.season,
            episode: episode.episode,
          }),
        };
      }

      const count = parsed.episodeCount ?? 0;
      if (parsed.season != null && count > 0) {
        const seasonCode = formatSeason(parsed.season);
        return {
          type: "library_media_downloaded",
          title: notificationCopy(locale, "librarySeasonDownloadedTitle", {
            season: seasonCode,
          }),
          body: notificationCopy(locale, "librarySeasonDownloadedBody", {
            show: media.label,
            season: seasonCode,
            count,
          }),
          url: buildLibraryNotificationUrl(media.mediaId, {
            season: parsed.season,
          }),
        };
      }

      if (count > 1) {
        return {
          type: "library_media_downloaded",
          title: notificationCopy(locale, "librarySeriesDownloadedTitle"),
          body: notificationCopy(locale, "librarySeriesDownloadedBody", {
            show: media.label,
            count,
          }),
          url: buildLibraryNotificationUrl(media.mediaId),
        };
      }

      return {
        type: "library_media_downloaded",
        title: notificationCopy(locale, "libraryShowDownloadedTitle"),
        body: notificationCopy(locale, "libraryMediaDownloadedBody", {
          show: media.label,
        }),
        url: buildLibraryNotificationUrl(media.mediaId),
      };
    },
    {
      imageUrl: media.posterUrl,
      metadata: {
        ...subjectMetadata(media, {
          code:
            episode?.code ??
            ((parsed.episodeCount ?? 0) > 0 ? seasonCode(parsed.season) : null),
          detail: episode ? episodeDisplayName(episode.title) : null,
          isUpgrade: parsed.isUpgrade,
        }),
        ...(episode ? { latest_code: episode.code, show: media.label } : {}),
        ...(!episode && (parsed.episodeCount ?? 0) > 1
          ? { episode_count: parsed.episodeCount }
          : {}),
      },
      notifyOptions:
        parsed.downloadHistoryId != null
          ? {
              lifecycleKey: downloadLifecycleKey(parsed.downloadHistoryId),
              preferenceKey: "library_downloaded",
              ...(parsed.quiet ? { push: false, updateOnly: true } : {}),
            }
          : episode
            ? {
                groupKey: `library_downloaded:${media.mediaId}`,
                preferenceKey: "library_downloaded",
              }
            : { preferenceKey: "library_downloaded" },
      logTag: "notifyAdminsMediaDownloaded",
    },
  );
}

export async function notifyAdminsLibraryGrabbed(opts: {
  mediaId: number;
  downloadHistoryId?: number | null;
  episodeId?: number | null;
  season?: number | null;
  releaseTitle: string;
  isUpgrade?: boolean;
}): Promise<void> {
  const media = await loadMediaContext(opts.mediaId);
  if (!media) return;

  const episode =
    opts.episodeId != null ? await loadEpisodeContext(opts.episodeId) : null;
  const release = truncateReleaseTitle(opts.releaseTitle);

  await notifyAdmins(
    (locale) => {
      if (media.type === "movie") {
        return {
          type: "library_media_grabbed",
          title: notificationCopy(locale, "libraryMovieGrabbedTitle"),
          body: notificationCopy(locale, "libraryGrabbedBody", {
            show: media.label,
            release,
          }),
          url: buildLibraryNotificationUrl(media.mediaId),
        };
      }

      if (episode) {
        return {
          type: "library_media_grabbed",
          title: notificationCopy(locale, "libraryEpisodeGrabbedTitle", {
            code: episode.code,
          }),
          body: notificationCopy(locale, "libraryGrabbedBody", {
            show: media.label,
            release,
          }),
          url: buildLibraryNotificationUrl(media.mediaId, {
            season: episode.season,
            episode: episode.episode,
          }),
        };
      }

      if (opts.season != null) {
        const seasonCode = formatSeason(opts.season);
        return {
          type: "library_media_grabbed",
          title: notificationCopy(locale, "librarySeasonGrabbedTitle", {
            season: seasonCode,
          }),
          body: notificationCopy(locale, "libraryGrabbedBody", {
            show: media.label,
            release,
          }),
          url: buildLibraryNotificationUrl(media.mediaId, {
            season: opts.season,
          }),
        };
      }

      return {
        type: "library_media_grabbed",
        title: notificationCopy(locale, "libraryShowDownloadedTitle"),
        body: notificationCopy(locale, "libraryGrabbedBody", {
          show: media.label,
          release,
        }),
        url: buildLibraryNotificationUrl(media.mediaId),
      };
    },
    {
      imageUrl: media.posterUrl,
      metadata: {
        ...subjectMetadata(media, {
          code: episode?.code ?? seasonCode(opts.season),
          detail: release,
          isUpgrade: opts.isUpgrade,
        }),
        release,
      },
      // A grab shows in the app; only the download it leads to reaches devices.
      notifyOptions: {
        preferenceKey: "library_grabbed",
        push: false,
        ...(opts.downloadHistoryId != null
          ? { lifecycleKey: downloadLifecycleKey(opts.downloadHistoryId) }
          : {}),
      },
      logTag: "notifyAdminsLibraryGrabbed",
    },
  );
}

export async function notifyAdminsLibraryDownloadFailed(opts: {
  mediaId?: number | null;
  downloadHistoryId?: number | null;
  episodeId?: number | null;
  reason: string;
}): Promise<void> {
  if (opts.mediaId == null) return;
  const media = await loadMediaContext(opts.mediaId);
  if (!media) return;

  const episode =
    opts.episodeId != null ? await loadEpisodeContext(opts.episodeId) : null;

  await notifyAdmins(
    (locale) => ({
      type: "library_download_failed",
      title: notificationCopy(locale, "libraryDownloadFailedTitle", {
        code: episode?.code ?? "",
      }),
      body: notificationCopy(locale, "libraryDownloadFailedBody", {
        show: episode ? `${media.label} — ${episode.code}` : media.label,
        reason: opts.reason,
      }),
      url: buildLibraryNotificationUrl(
        media.mediaId,
        episode
          ? { season: episode.season, episode: episode.episode }
          : undefined,
      ),
    }),
    {
      imageUrl: media.posterUrl,
      metadata: subjectMetadata(media, {
        code: episode?.code,
        detail: opts.reason,
      }),
      notifyOptions: {
        preferenceKey: "library_failed",
        ...(opts.downloadHistoryId != null
          ? { lifecycleKey: downloadLifecycleKey(opts.downloadHistoryId) }
          : {}),
      },
      logTag: "notifyAdminsLibraryDownloadFailed",
    },
  );
}

export async function notifyAdminsPostProcessFailed(
  downloadHistoryId: number,
  reason: string,
  mediaId?: number | null,
  episodeId?: number | null,
): Promise<void> {
  if (mediaId == null) {
    await notifyAdmins(
      (locale) => ({
        type: "library_post_process_failed",
        title: notificationCopy(locale, "libraryPostProcessFailedTitle"),
        body: `Download #${downloadHistoryId}: ${reason}`,
        url: "/library",
      }),
      {
        notifyOptions: {
          preferenceKey: "library_failed",
          lifecycleKey: downloadLifecycleKey(downloadHistoryId),
        },
        logTag: "notifyAdminsPostProcessFailed",
      },
    );
    return;
  }

  const media = await loadMediaContext(mediaId);
  if (!media) return;
  const episode =
    episodeId != null ? await loadEpisodeContext(episodeId) : null;

  await notifyAdmins(
    (locale) => ({
      type: "library_post_process_failed",
      title: notificationCopy(locale, "libraryPostProcessFailedTitle"),
      body: notificationCopy(locale, "libraryPostProcessFailedBody", {
        show: episode ? `${media.label} — ${episode.code}` : media.label,
        reason,
      }),
      url: buildLibraryNotificationUrl(
        media.mediaId,
        episode
          ? { season: episode.season, episode: episode.episode }
          : undefined,
      ),
    }),
    {
      imageUrl: media.posterUrl,
      metadata: subjectMetadata(media, { code: episode?.code, detail: reason }),
      notifyOptions: {
        preferenceKey: "library_failed",
        lifecycleKey: downloadLifecycleKey(downloadHistoryId),
      },
      logTag: "notifyAdminsPostProcessFailed",
    },
  );
}

export async function notifyAdminsLibraryGrabSkipped(opts: {
  mediaId: number;
  episodeId?: number | null;
  season?: number | null;
  reason: string;
  scope: "movie" | "episode" | "season_pack";
}): Promise<void> {
  const media = await loadMediaContext(opts.mediaId);
  if (!media) return;

  const episode =
    opts.episodeId != null ? await loadEpisodeContext(opts.episodeId) : null;

  await notifyAdmins(
    (locale) => {
      if (opts.scope === "movie") {
        return {
          type: "library_grab_skipped",
          title: notificationCopy(locale, "libraryGrabSkippedMovieTitle"),
          body: notificationCopy(locale, "libraryGrabSkippedBody", {
            show: media.label,
            reason: opts.reason,
          }),
          url: buildLibraryNotificationUrl(media.mediaId),
        };
      }

      if (opts.scope === "season_pack" && opts.season != null) {
        const seasonCode = formatSeason(opts.season);
        return {
          type: "library_grab_skipped",
          title: notificationCopy(locale, "libraryGrabSkippedSeasonTitle", {
            season: seasonCode,
          }),
          body: notificationCopy(locale, "libraryGrabSkippedBody", {
            show: media.label,
            reason: opts.reason,
          }),
          url: buildLibraryNotificationUrl(media.mediaId, {
            season: opts.season,
          }),
        };
      }

      const code = episode?.code ?? "S??E??";
      return {
        type: "library_grab_skipped",
        title: notificationCopy(locale, "libraryGrabSkippedEpisodeTitle", {
          code,
        }),
        body: notificationCopy(locale, "libraryGrabSkippedBody", {
          show: media.label,
          reason: opts.reason,
        }),
        url: buildLibraryNotificationUrl(
          media.mediaId,
          episode
            ? { season: episode.season, episode: episode.episode }
            : undefined,
        ),
      };
    },
    {
      imageUrl: media.posterUrl,
      notifyOptions: { preferenceKey: "library_grab_skipped" },
      logTag: "notifyAdminsLibraryGrabSkipped",
    },
  );
}

/** @deprecated Pass structured opts instead of a raw body string. */
export async function notifyAdminsLibraryGrabSkippedLegacy(
  body: string,
  mediaId: number,
): Promise<void> {
  await notifyAdminsLibraryGrabSkipped({
    mediaId,
    reason: body,
    scope: "movie",
  });
}

export async function notifyAdminsLibraryAttentionAlert(opts: {
  mediaId: number;
  episodeId?: number | null;
  season?: number | null;
  detail: string;
}): Promise<void> {
  const media = await loadMediaContext(opts.mediaId);
  if (!media) return;

  const episode =
    opts.episodeId != null ? await loadEpisodeContext(opts.episodeId) : null;

  await notifyAdmins(
    (locale) => ({
      type: "library_attention",
      title: notificationCopy(locale, "libraryAttentionTitle"),
      body: notificationCopy(locale, "libraryAttentionBody", {
        detail: opts.detail,
      }),
      url: buildLibraryNotificationUrl(
        media.mediaId,
        episode
          ? { season: episode.season, episode: episode.episode }
          : opts.season != null
            ? { season: opts.season }
            : undefined,
      ),
    }),
    {
      imageUrl: media.posterUrl,
      notifyOptions: { preferenceKey: "library_attention" },
      logTag: "notifyAdminsLibraryAttentionAlert",
    },
  );
}
