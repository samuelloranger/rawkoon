import { stat } from "node:fs/promises";

import { prisma } from "@rawkoon/api/db";
import { applyAfterImportAction } from "@rawkoon/api/services/downloadClient/afterImport";
import { resolveActiveAdapter } from "@rawkoon/api/services/downloadClient/registry";
import { emitBookUpdate } from "@rawkoon/api/services/libraryEvents";
import { notifyBookRequestAvailable } from "@rawkoon/api/services/mediaRequests";
import type { PostProcessFailure } from "@rawkoon/api/services/postProcessor/postProcessFailure";
import { postProcessBook } from "@rawkoon/api/services/postProcessor/postProcessorBookImport";
import { rescanBookEdition } from "@rawkoon/api/services/postProcessor/postProcessorBookRescan";
import {
  isFullyReadable,
  resolveTorrentContentPath,
} from "@rawkoon/api/services/postProcessor/postProcessorHelpers";
import { remapPath } from "@rawkoon/api/utils/medias/mediainfoScanner";

type BookDownloadResult =
  | {
      success: true;
      destinationPath: string;
      /** True when success meant "already imported by another grab", not a fresh import. */
      skipped?: boolean;
      skipReason?: string;
    }
  | PostProcessFailure;

/**
 * Pre-scan: are the files already in the library?
 *
 * The counterpart of the pre-scan in postProcessorSingle, and the reason a
 * re-grab after a deleted-and-re-added book used to dead-end: the file was
 * already on disk, but nothing looked before asking the download client.
 * Returns a result when the download needs no import, null to carry on.
 */
async function adoptExistingFiles(
  downloadHistoryId: number,
  editionId: number,
): Promise<BookDownloadResult | null> {
  const existing = await prisma.bookFile.findMany({
    where: { editionId },
    select: { filePath: true },
  });
  for (const file of existing) {
    try {
      await stat(file.filePath);
    } catch {
      continue;
    }
    // Another grab already imported this edition's file. Success, but a
    // losing-duplicate skip — not a fresh import. Record why in
    // postProcessSkipReason (never postProcessError) so the "downloaded"
    // notification is suppressed. The rescan branch below, which registers
    // genuinely new files, stays a real import.
    await prisma.bookEdition.update({
      where: { id: editionId },
      data: { status: "downloaded" },
    });
    await prisma.downloadHistory.update({
      where: { id: downloadHistoryId },
      data: {
        postProcessDestinationPath: file.filePath,
        postProcessError: null,
        postProcessSkipReason: "duplicate-already-imported",
      },
    });
    const ed = await prisma.bookEdition.findUnique({
      where: { id: editionId },
      select: { bookId: true },
    });
    if (ed) {
      emitBookUpdate(ed.bookId);
      await notifyBookRequestAvailable(ed.bookId);
    }
    return {
      success: true,
      destinationPath: file.filePath,
      skipped: true,
      skipReason: "duplicate-already-imported",
    };
  }

  // No rows, or every row's file is gone: the files may still be on disk from
  // an earlier import whose rows were removed with the book. Adopting them
  // costs a couple of stat calls on a fresh grab, where the directory does
  // not exist yet and the scan finds nothing.
  const rescan = await rescanBookEdition(editionId);
  if (rescan.registered > 0 && rescan.directory) {
    await prisma.downloadHistory.update({
      where: { id: downloadHistoryId },
      data: {
        postProcessDestinationPath: rescan.directory,
        postProcessError: null,
      },
    });
    return { success: true, destinationPath: rescan.directory };
  }
  return null;
}

/**
 * Entry point used by the post-process job. Resolves the completed torrent's
 * content path from the download client, then imports it.
 *
 * Returns the same shape as postProcessorSingle.postProcess so
 * downloadOutcome.finishPostProcess can dispatch on the download_history row's
 * foreign key without special-casing the result.
 */
export async function postProcessBookDownload(
  downloadHistoryId: number,
): Promise<BookDownloadResult> {
  const [dh, settings] = await Promise.all([
    prisma.downloadHistory.findUnique({
      where: { id: downloadHistoryId },
      select: {
        id: true,
        bookEditionId: true,
        torrentHash: true,
        releaseTitle: true,
        failed: true,
        completedAt: true,
        isUpgrade: true,
      },
    }),
    prisma.mediaSettings.findUnique({ where: { id: 1 } }),
  ]);

  if (!dh?.bookEditionId) {
    return {
      success: false,
      reason: "Download history or book edition not found",
    };
  }
  if (dh.failed || !dh.completedAt) {
    return { success: false, reason: "Download not completed" };
  }
  if (!settings?.postProcessingEnabled) {
    return { success: false, reason: "Post-processing disabled" };
  }

  // Skipped for upgrades, where the file being replaced is still present and
  // would short-circuit the very import that is meant to replace it.
  if (!dh.isUpgrade) {
    const adopted = await adoptExistingFiles(
      downloadHistoryId,
      dh.bookEditionId,
    );
    if (adopted) return adopted;
  }

  const hash = dh.torrentHash?.trim();
  if (!hash) return { success: false, reason: "Torrent hash unknown" };

  const active = await resolveActiveAdapter();
  if (!active) {
    return { success: false, reason: "Download client not configured" };
  }

  const tor = await active.adapter.getTorrent(hash);
  if (!tor) {
    return { success: false, reason: "Torrent not found in download client" };
  }

  const contentBase = resolveTorrentContentPath(
    tor.contentPath,
    tor.savePath,
    tor.name,
  );
  if (!contentBase) {
    return { success: false, reason: "Could not resolve torrent content path" };
  }

  const contentRoot = remapPath(contentBase);
  const result = await postProcessBook({
    editionId: dh.bookEditionId,
    contentPath: contentRoot,
    releaseTitle: dh.releaseTitle,
    fileOperation: settings.fileOperation === "move" ? "move" : "hardlink",
    isUpgrade: dh.isUpgrade,
  });

  if (result.error || !result.destinationPath) {
    // Only an empty import from a readable tree is the release's fault.
    if (result.rejectKind && !(await isFullyReadable(contentRoot))) {
      return {
        success: false,
        reason:
          "Download content is missing or unreadable — check path mappings and permissions",
      };
    }
    return {
      success: false,
      reason: result.error ?? "Import produced no files",
      ...(result.rejectKind ? { rejectKind: result.rejectKind } : {}),
    };
  }
  if (result.skipped.length > 0) {
    console.warn(
      `[postProcessBook] dh#${downloadHistoryId} skipped ${result.skipped.length} file(s): ${result.skipped.join("; ")}`,
    );
  }
  // Seeding clients keep book torrents; a debrid client has nothing left to seed.
  if (active.adapter.type === "rdtclient") {
    await applyAfterImportAction(
      active.adapter,
      hash,
      result.skipped.length === 0 ? "removeWithData" : "keep",
      "postProcessBook",
    );
  }
  return { success: true, destinationPath: result.destinationPath };
}
