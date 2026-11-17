import type { Prisma } from "@prisma/client";
import { prisma } from "@rawkoon/api/db";
import type { DownloadClientAdapter } from "@rawkoon/api/services/downloadClient/types";
import { resolveActiveAdapter } from "@rawkoon/api/services/downloadClient/registry";
import { sendReleaseToClient } from "@rawkoon/api/services/downloadClient/sendRelease";
import { checkFreeSpaceForGrab } from "@rawkoon/api/services/grab/grabSpaceCheck";
import { checkBlocklist } from "@rawkoon/api/services/mediaGrabber/mediaGrabberHelpers";
import type {
  GrabRefusal,
  GrabResult,
} from "@rawkoon/api/services/mediaGrabber/mediaGrabberConflicts";
import { infoHashFromMagnet } from "@rawkoon/api/utils/medias/prowlarrSearchUtils";
import { isServerTorrentFetchUrlAllowed } from "@rawkoon/api/utils/medias/safeTorrentFetchUrl";

/**
 * The refusals that need nothing but the release itself: a usable URL, a
 * configured client, and no blocklist hit. Free space is left to the grab, since
 * a replace frees the old download's space first.
 */
export async function preflightGrab(opts: {
  downloadUrl: string;
  releaseTitle: string;
  /** The URL already passed this check (it resolves DNS), so don't repeat it. */
  skipUrlCheck?: boolean;
}): Promise<
  | { refusal: GrabResult }
  | {
      downloadUrl: string;
      releaseTitle: string;
      isMagnet: boolean;
      active: NonNullable<Awaited<ReturnType<typeof resolveActiveAdapter>>>;
    }
> {
  const downloadUrl = opts.downloadUrl.trim();
  const releaseTitle = opts.releaseTitle.trim();
  const refuse = (reason: string, refusal?: GrabRefusal) => ({
    refusal: {
      grabbed: false as const,
      reason,
      ...(refusal ? { refusal } : {}),
    },
  });
  if (!downloadUrl) return refuse("Missing download URL");
  if (!releaseTitle) return refuse("Missing release title");

  const isMagnet = downloadUrl.startsWith("magnet:");
  if (isMagnet) {
    if (downloadUrl.length > 16_384) return refuse("Magnet link too long");
  } else if (
    !opts.skipUrlCheck &&
    !(await isServerTorrentFetchUrlAllowed(downloadUrl))
  ) {
    return refuse("Download URL is not allowed for server-side fetch");
  }

  const active = await resolveActiveAdapter();
  if (!active) return refuse("No download client configured");

  const earlyHash = isMagnet ? infoHashFromMagnet(downloadUrl) : null;
  const blockReason = await checkBlocklist(releaseTitle, earlyHash);
  if (blockReason) {
    return refuse(`Blocklisted: ${blockReason}`, "blocklisted");
  }
  return { downloadUrl, releaseTitle, isMagnet, active };
}

/** What differs between grabbing a movie/episode and a book edition. */
export type GrabAdapter = {
  logPrefix: string;
  /** Download client category. */
  category: string;
  /** Picks the free-space target: "movie", "show", "ebook" or "audiobook". */
  spaceKind: string;
  /** A refusal when the target already has an active grab. */
  findConflict(releaseTitle: string): Promise<GrabResult | null>;
  /** Target and quality columns of the new DownloadHistory row. */
  historyData(): Omit<
    Prisma.DownloadHistoryUncheckedCreateInput,
    "releaseTitle" | "indexer" | "downloadUrl" | "isUpgrade" | "aiPicked"
  >;
  /** Result when a concurrent grab won the unique-index race. */
  raceRefusal: GrabResult;
  /** Take over a torrent the client already holds; true when adopted. */
  adopt(ctx: {
    client: DownloadClientAdapter;
    dhRowId: number;
    torrentHash: string | null;
    releaseTitle: string;
  }): Promise<boolean>;
  /** Flip the library status; a throw is logged, never fails the grab. */
  markGrabbed(): Promise<void>;
  /** Activity log + notification, after the torrent is queued. */
  announce(dhRowId: number, releaseTitle: string): Promise<void>;
};

export type GrabRelease = {
  downloadUrl: string;
  releaseTitle: string;
  indexer?: string | null;
  isUpgrade?: boolean;
  aiPicked?: boolean;
  urlChecked?: boolean;
  /** Unknown (null/0) skips the free-space check. */
  sizeBytes?: number | null;
};

/**
 * The one grab pipeline: every refusal runs before a history row exists, then
 * the hand-off, and nothing after the torrent is queued can fail the grab.
 */
export async function grabTarget(
  a: GrabAdapter,
  release: GrabRelease,
): Promise<GrabResult> {
  let dhId: number | null = null;
  let queuedTitle: string | null = null;

  try {
    const pre = await preflightGrab({
      downloadUrl: release.downloadUrl,
      releaseTitle: release.releaseTitle,
      skipUrlCheck: release.urlChecked,
    });
    if ("refusal" in pre) return pre.refusal;
    const { downloadUrl, releaseTitle, active } = pre;
    const client = active.adapter;

    const spaceReason = await checkFreeSpaceForGrab({
      mediaType: a.spaceKind,
      sizeBytes: release.sizeBytes,
    });
    if (spaceReason) {
      return { grabbed: false, reason: spaceReason, refusal: "no_space" };
    }

    const conflict = await a.findConflict(releaseTitle);
    if (conflict) return conflict;

    let dhRow: { id: number };
    try {
      dhRow = await prisma.downloadHistory.create({
        data: {
          ...a.historyData(),
          releaseTitle,
          indexer: release.indexer?.trim() || null,
          downloadUrl,
          isUpgrade: release.isUpgrade ?? false,
          aiPicked: release.aiPicked ?? false,
        },
        select: { id: true },
      });
    } catch (e) {
      // The unique active-target index: a concurrent grab inserted after our conflict check.
      if ((e as { code?: string }).code === "P2002") return a.raceRefusal;
      throw e;
    }
    dhId = dhRow.id;

    const fail = async (reason: string): Promise<GrabResult> => {
      await prisma.downloadHistory.update({
        where: { id: dhRow.id },
        data: { failed: true, failReason: reason },
      });
      return { grabbed: false, reason };
    };

    const sent = await sendReleaseToClient(client, {
      downloadUrl,
      category: a.category,
      tag: `rawkoon-dh-${dhRow.id}`,
      savePath: active.savePath,
    });
    if (!sent.ok) {
      if (sent.stage === "fetch") {
        await fail(sent.message);
        return { grabbed: false, reason: "Could not download .torrent file" };
      }
      if (client.claimExisting) {
        const adopted = await a.adopt({
          client,
          dhRowId: dhRow.id,
          torrentHash: sent.hash,
          releaseTitle,
        });
        if (adopted) {
          queuedTitle = releaseTitle;
          return { grabbed: true, releaseTitle };
        }
      }
      return await fail(
        sent.error instanceof Error
          ? sent.error.message
          : sent.via === "magnet"
            ? "Magnet add failed"
            : "Torrent add failed",
      );
    }

    queuedTitle = releaseTitle;
    await prisma.downloadHistory
      .update({ where: { id: dhRow.id }, data: { torrentHash: sent.hash } })
      .catch((e) =>
        console.warn(
          `${a.logPrefix} hash write failed for DH ${dhRow.id} (torrent already queued):`,
          e,
        ),
      );

    try {
      await a.markGrabbed();
    } catch (e) {
      // The torrent is queued; the active row lets the poller finish the item.
      console.warn(
        `${a.logPrefix} status update failed for DH ${dhRow.id} (torrent already queued):`,
        e,
      );
    }

    await a.announce(dhRow.id, releaseTitle);
    return { grabbed: true, releaseTitle };
  } catch (e) {
    console.warn(`${a.logPrefix} grab failed:`, e);
    // Past the hand-off a throw must not report a failed grab or fail the row.
    if (queuedTitle) return { grabbed: true, releaseTitle: queuedTitle };
    const reason =
      e instanceof Error ? e.message : "Unexpected error during grab";
    if (dhId != null) {
      await prisma.downloadHistory
        .update({
          where: { id: dhId },
          data: { failed: true, failReason: reason },
        })
        .catch((err) =>
          console.warn(`${a.logPrefix} failed to mark history failed:`, err),
        );
    }
    return { grabbed: false, reason };
  }
}
