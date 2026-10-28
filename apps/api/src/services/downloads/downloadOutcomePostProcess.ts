import { prisma } from "@rawkoon/api/db";
import {
  type OutcomeEffects,
  productionOutcomeEffects,
} from "@rawkoon/api/services/downloads/outcomeEffects";
import { postProcess } from "@rawkoon/api/services/postProcessor/postProcessorSingle";
import { postProcessBookDownload } from "@rawkoon/api/services/postProcessor/postProcessorBookDownload";
import type { PostProcessOutcome } from "@rawkoon/api/services/postProcessor/postProcessOutcome";

/**
 * Completion already marked the title downloaded; a rejected import left no
 * file, so send it back to wanted for search to pick another release. An
 * upgrade keeps its status — the file it was replacing is still there.
 */
async function revertRejectedImport(
  dh: {
    mediaId: number | null;
    episodeId: number | null;
    bookEditionId: number | null;
  },
  isUpgrade: boolean,
): Promise<void> {
  if (isUpgrade) return;
  if (dh.bookEditionId != null) {
    await prisma.bookEdition.updateMany({
      where: { id: dh.bookEditionId, status: "downloaded" },
      data: { status: "wanted" },
    });
    return;
  }
  if (dh.episodeId != null) {
    await prisma.libraryEpisode.updateMany({
      where: { id: dh.episodeId, status: "downloaded" },
      data: { status: "wanted" },
    });
    return;
  }
  // Movie or season pack: undo the status the completion transition writes.
  if (dh.mediaId != null) {
    await prisma.libraryMedia.updateMany({
      where: {
        id: dh.mediaId,
        status: "downloaded",
      },
      data: { status: "wanted" },
    });
  }
}

function rejectableFrom(
  id: number,
  dh: {
    mediaId: number | null;
    episodeId: number | null;
    bookEditionId: number | null;
    isUpgrade: boolean;
    torrentHash: string | null;
    releaseTitle: string;
    indexer: string | null;
  },
) {
  return {
    id,
    mediaId: dh.mediaId,
    episodeId: dh.episodeId,
    bookEditionId: dh.bookEditionId,
    isUpgrade: dh.isUpgrade,
    torrentHash: dh.torrentHash,
    releaseTitle: dh.releaseTitle,
    indexer: dh.indexer,
  };
}

/**
 * The post-process job body: place the download into the library, then record
 * what happened.
 *
 * Never throws for a business failure — the reason is persisted on the row and
 * reported to admins, because a failed placement is a state the UI must show,
 * not a lost job.
 */
export async function finishPostProcess(
  downloadHistoryId: number,
  effects: OutcomeEffects = productionOutcomeEffects,
): Promise<PostProcessOutcome> {
  let mediaId: number | null | undefined;
  let bookEditionId: number | null | undefined;
  let isUpgrade = false;
  let episodeId: number | null | undefined;
  try {
    const dh = await prisma.downloadHistory.findUnique({
      where: { id: downloadHistoryId },
      include: { media: true, episode: true },
    });
    mediaId = dh?.mediaId;
    bookEditionId = dh?.bookEditionId;
    episodeId = dh?.episodeId;
    const season = dh?.season;
    isUpgrade = dh?.isUpgrade ?? false;

    // Its library item was removed: the row only seeds now, there is nothing to import.
    if (dh && dh.mediaId == null && dh.bookEditionId == null) {
      return {
        success: true,
        destinationPath: "",
        skipped: true,
        skipReason: "library-item-removed",
      };
    }

    if (dh?.torrentHash) {
      const [
        { findBlockedFileInTorrent, rejectRelease },
        { resolveActiveAdapter },
      ] = await Promise.all([
        import("@rawkoon/api/services/downloads/downloadJanitor"),
        import("@rawkoon/api/services/downloadClient/registry"),
      ]);
      const [active, blockSettings] = await Promise.all([
        resolveActiveAdapter(),
        prisma.mediaSettings.findUnique({
          where: { id: 1 },
          select: { blockedExtensions: true },
        }),
      ]);
      const bad = active
        ? await findBlockedFileInTorrent(
            dh.torrentHash,
            blockSettings?.blockedExtensions ?? [],
            active.adapter,
          )
        : null;
      if (bad) {
        const reason = `blocked file type: ${bad}`;
        await prisma.downloadHistory.update({
          where: { id: downloadHistoryId },
          data: { postProcessError: reason },
        });
        await rejectRelease(
          rejectableFrom(downloadHistoryId, dh),
          "malware",
          reason,
        );
        await revertRejectedImport(dh, isUpgrade);
        return { success: false, reason };
      }
    }

    // A row is either a media grab or a book grab (enforced by
    // ck_download_history_single_target), so the foreign key IS the dispatch.
    const result: PostProcessOutcome = !dh
      ? { success: false, reason: "Download history or media not found" }
      : dh.bookEditionId != null
        ? await postProcessBookDownload(dh)
        : await postProcess(dh);

    if (!result.success) {
      await prisma.downloadHistory.update({
        where: { id: downloadHistoryId },
        data: { postProcessError: result.reason },
      });
      if (result.rejectKind && dh) {
        const { rejectRelease } = await import(
          "@rawkoon/api/services/downloads/downloadJanitor"
        );
        // rejectRelease notifies admins, for media and book rows alike.
        await rejectRelease(
          rejectableFrom(downloadHistoryId, dh),
          "import_rejected",
          result.reason,
        );
        await revertRejectedImport(dh, isUpgrade);
        return result;
      }
      if (mediaId != null) effects.libraryChanged(mediaId);
      await effects.importFailed({
        downloadHistoryId,
        reason: result.reason,
        mediaId,
        episodeId,
        bookEditionId,
        isUpgrade,
      });
      return result;
    }

    // A skip is a success that imported nothing (the file was already placed by
    // another grab). Record the reason and DON'T fire the "downloaded" notice;
    // clear it on a real import so a later genuine grab resets the state.
    const skipReason = result.skipped ? (result.skipReason ?? null) : null;
    await prisma.downloadHistory.update({
      where: { id: downloadHistoryId },
      data: {
        postProcessDestinationPath: result.destinationPath,
        postProcessError: null,
        postProcessSkipReason: skipReason,
      },
    });
    if (mediaId != null) {
      effects.libraryChanged(mediaId);
      // Pack and episode imports mark episodes downloaded only now, after
      // completion already ran this check, so run it again.
      await effects
        .requestAvailable(mediaId)
        .catch((e) =>
          console.warn(
            `[downloadOutcome] request availability check failed dh=${downloadHistoryId}:`,
            e,
          ),
        );
      if (!result.skipped) {
        const packEpisodeCount = result.episodeCount;
        if (!isUpgrade) {
          // A live-client event must never fail the import it reports.
          await effects
            .importLanded({
              mediaId,
              episodeId,
              season,
              episodeCount: packEpisodeCount,
            })
            .catch((e) =>
              console.warn(
                `[downloadOutcome] landed event failed dh=${downloadHistoryId}:`,
                e,
              ),
            );
        }
        await effects.mediaDownloaded({
          mediaId,
          episodeId,
          season,
          episodeCount: packEpisodeCount,
          isUpgrade,
        });
      }
    }
    if (bookEditionId != null && !result.skipped) {
      await effects.bookDownloaded(bookEditionId, isUpgrade);
    }
    if (dh?.torrentHash) {
      await effects
        .seedReleaseCheck(dh.torrentHash)
        .catch((e) =>
          console.warn(
            `[downloadOutcome] seed release check failed dh=${downloadHistoryId}:`,
            e,
          ),
        );
    }
    await effects.libraryScan();
    return result;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(
      `[downloadOutcome] post-process failed dh=${downloadHistoryId}:`,
      e,
    );
    try {
      await prisma.downloadHistory.update({
        where: { id: downloadHistoryId },
        data: { postProcessError: msg },
      });
      await effects.importFailed({
        downloadHistoryId,
        reason: msg,
        mediaId,
        episodeId,
        bookEditionId,
        isUpgrade,
      });
    } catch (persistError) {
      console.warn(
        `[downloadOutcome] failed to persist postProcessError dh=${downloadHistoryId}:`,
        persistError,
      );
    }
    return { success: false, reason: msg };
  }
}
