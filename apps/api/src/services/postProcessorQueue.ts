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
    try {
      const settings = await prisma.mediaSettings.findUnique({
        where: { id: 1 },
      });
      if (!settings?.postProcessingEnabled) return;

      const result = await postProcess(downloadHistoryId);

      // Look up mediaId for SSE broadcast (needed regardless of success/failure)
      const dh = await prisma.downloadHistory.findUnique({
        where: { id: downloadHistoryId },
        select: { mediaId: true },
      });

      if (!result.success) {
        await prisma.downloadHistory.update({
          where: { id: downloadHistoryId },
          data: { postProcessError: result.reason },
        });
        if (dh?.mediaId != null) emitLibraryUpdate(dh.mediaId);
        await notifyAdminsPostProcessFailed(downloadHistoryId, result.reason);
        return;
      }
      await prisma.downloadHistory.update({
        where: { id: downloadHistoryId },
        data: {
          postProcessDestinationPath: result.destinationPath,
          postProcessError: null,
        },
      });
      if (dh?.mediaId != null) {
        emitLibraryUpdate(dh.mediaId);
        await notifyAdminsMediaDownloaded(dh.mediaId);
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
        await notifyAdminsPostProcessFailed(downloadHistoryId, msg);
      } catch (e) {
        console.warn(
          `[postProcess] failed to persist postProcessError dh=${downloadHistoryId}:`,
          e,
        );
      }
    }
  })();
}
