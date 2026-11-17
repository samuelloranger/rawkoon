import { APP_PATHS } from "@rawkoon/shared/constants";
import { notificationCopy } from "@rawkoon/api/services/notification/notificationCopy";
import { notifyAdmins } from "@rawkoon/api/services/notification/notifyAdmins";
import type { ClaimedJob } from "@rawkoon/api/services/transcode/repo";
import type { TranscodeNotifier } from "@rawkoon/api/services/transcode/dispatcher";

function gb(bytes: bigint): string {
  return `${(Number(bytes) / 1e9).toFixed(1)} GB`;
}

const toAdmins = (
  build: (locale: string | null) => {
    title: string;
    body: string;
    type: string;
  },
  preferenceKey: "library_downloaded" | "library_failed",
  mediaId: number | null,
) =>
  notifyAdmins({
    build,
    preferenceKey,
    url: APP_PATHS.settingsReencode,
    metadata: mediaId != null ? { media_id: mediaId } : undefined,
    logTag: "transcode",
  });

export const transcodeNotifier: TranscodeNotifier = {
  async jobFailed(job: ClaimedJob, error: string) {
    await toAdmins(
      (l) => ({
        type: "library_transcode_failed",
        title: notificationCopy(l, "libraryTranscodeFailedTitle"),
        body: notificationCopy(l, "libraryTranscodeFailedBody", {
          title: job.title,
          reason: error,
        }),
      }),
      "library_failed",
      job.mediaId,
    );
  },
  async batchFinished(job, s) {
    await toAdmins(
      (l) => ({
        type: "library_transcode_finished",
        title: notificationCopy(l, "libraryTranscodeFinishedTitle"),
        body: notificationCopy(l, "libraryTranscodeFinishedBody", {
          title: job.title.split(" — ")[0],
          done: String(s.done),
          failed: String(s.failed),
          saved: gb(s.savedBytes),
          pending: s.pendingSeedBytes > 0n ? gb(s.pendingSeedBytes) : "",
        }),
      }),
      "library_downloaded",
      job.mediaId,
    );
  },
};
