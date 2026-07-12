import { prisma } from "@rawkoon/api/db";
import { emitLibraryUpdate } from "@rawkoon/api/services/libraryEvents";
import { triggerJellyfinLibraryScan } from "@rawkoon/api/services/jellyfinLibraryRefresh";
import { postProcess } from "@rawkoon/api/services/postProcessorSingle";
import { notifyAdminsPostProcessFailed } from "@rawkoon/api/workers/notifyPostProcessFailed";
import { notifyAdminsMediaDownloaded } from "@rawkoon/api/workers/notifyMediaDownloaded";

/**
 * Run after marking a download complete — never await from cron/webhook handlers.
 */
export function enqueueLibraryPostProcess(downloadHistoryId: number): void {
  void (async () => {
    let mediaId: number | null | undefined;
    try {
      const settings = await prisma.mediaSettings.findUnique({
        where: { id: 1 },
      });
      if (!settings?.postProcessingEnabled) return;

      // Look up mediaId for SSE broadcast (needed regardless of success/failure)
      const dh = await prisma.downloadHistory.findUnique({
        where: { id: downloadHistoryId },
        select: { mediaId: true },
      });
      mediaId = dh?.mediaId;

      const result = await postProcess(downloadHistoryId);

      if (!result.success) {
        await prisma.downloadHistory.update({
          where: { id: downloadHistoryId },
          data: { postProcessError: result.reason },
        });
        if (mediaId != null) emitLibraryUpdate(mediaId);
        await notifyAdminsPostProcessFailed(
          downloadHistoryId,
          result.reason,
          mediaId,
        );
        return;
      }
      await prisma.downloadHistory.update({
        where: { id: downloadHistoryId },
        data: {
          postProcessDestinationPath: result.destinationPath,
          postProcessError: null,
        },
      });
      if (mediaId != null) {
        emitLibraryUpdate(mediaId);
        await notifyAdminsMediaDownloaded(mediaId);
      }
      await triggerJellyfinLibraryScan();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(
        `[enqueueLibraryPostProcess] Unexpected error dh=${downloadHistoryId}:`,
        e,
      );
      try {
        await prisma.downloadHistory.update({
          where: { id: downloadHistoryId },
          data: { postProcessError: msg },
        });
        await notifyAdminsPostProcessFailed(downloadHistoryId, msg, mediaId);
      } catch (e) {
        console.warn(
          `[postProcess] failed to persist postProcessError dh=${downloadHistoryId}:`,
          e,
        );
      }
    }
  })();
}
