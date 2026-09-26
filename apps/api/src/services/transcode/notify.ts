import { notificationCopy } from "@rawkoon/api/services/notificationCopy";
import { getAdminNotificationTargets } from "@rawkoon/api/services/notificationPreferences";
import { createAndQueueNotification } from "@rawkoon/api/workers/notificationService";
import type { ClaimedJob } from "@rawkoon/api/services/transcode/repo";
import type { TranscodeNotifier } from "@rawkoon/api/services/transcode/dispatcher";

function gb(bytes: bigint): string {
  return `${(Number(bytes) / 1e9).toFixed(1)} GB`;
}

async function toAdmins(
  build: (locale: string | null) => {
    title: string;
    body: string;
    type: string;
  },
  preferenceKey: "library_downloaded" | "library_failed",
  mediaId: number | null,
): Promise<void> {
  for (const admin of await getAdminNotificationTargets()) {
    const msg = build(admin.locale);
    try {
      await createAndQueueNotification(
        admin.id,
        msg.title,
        msg.body,
        msg.type,
        "/settings?tab=transcode",
        mediaId != null ? { media_id: mediaId } : undefined,
        undefined,
        { preferenceKey, skipPreferenceCheck: false },
      );
    } catch (e) {
      console.warn("[transcode] notification failed:", e);
    }
  }
}

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
