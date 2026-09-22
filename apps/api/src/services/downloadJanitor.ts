import { prisma } from "@rawkoon/api/db";
import { resolveActiveAdapter } from "@rawkoon/api/services/downloadClient/registry";
import type { DownloadClientAdapter } from "@rawkoon/api/services/downloadClient/types";
import {
  type DownloadRef,
  failDownload,
} from "@rawkoon/api/services/downloadOutcome";
import {
  findBlockedFile,
  isRawkoonOwned,
  sharesContentPath,
} from "@rawkoon/api/services/seeding/seedPolicy";
import type { SeedReleaseReason } from "@rawkoon/shared/types";

export type RejectKind = "stalled" | "malware" | "import_rejected";
export type RejectableDownload = DownloadRef & {
  torrentHash: string | null;
  releaseTitle: string;
  indexer: string | null;
};

export interface JanitorDeps {
  failDownload: (dh: DownloadRef, reason: string) => Promise<void>;
  createBlocklist: (data: {
    torrentHash: string | null;
    releaseTitle: string;
    indexer: string | null;
    mediaId: number | null;
    episodeId: number | null;
    kind: RejectKind;
    reason: string;
  }) => Promise<void>;
  hashInUseByOthers: (hash: string, excludeId: number) => Promise<boolean>;
  stampReleased: (
    id: number,
    reason: SeedReleaseReason,
    bytes: bigint | null,
  ) => Promise<void>;
  resolveAdapter: () => Promise<DownloadClientAdapter | null>;
}

const defaultDeps: JanitorDeps = {
  failDownload,
  createBlocklist: async (data) => {
    await prisma.grabBlocklist.create({ data });
  },
  hashInUseByOthers: async (hash, excludeId) =>
    (await prisma.downloadHistory.count({
      where: {
        torrentHash: { equals: hash, mode: "insensitive" },
        id: { not: excludeId },
        failed: false,
        seedReleasedAt: null,
      },
    })) > 0,
  stampReleased: async (id, reason, bytes) => {
    await prisma.downloadHistory.update({
      where: { id },
      data: {
        seedReleasedAt: new Date(),
        seedReleaseReason: reason,
        seedReleasedBytes: bytes,
      },
    });
  },
  resolveAdapter: async () => (await resolveActiveAdapter())?.adapter ?? null,
};

/** Condemn a release: fail the row, blocklist it so search skips it, and clear it from the client. */
export async function rejectRelease(
  dh: RejectableDownload,
  kind: RejectKind,
  reason: string,
  deps: JanitorDeps = defaultDeps,
): Promise<void> {
  const hash = dh.torrentHash?.trim().toLowerCase() || null;
  await deps.failDownload(dh, reason);
  await deps.createBlocklist({
    torrentHash: hash,
    releaseTitle: dh.releaseTitle,
    indexer: dh.indexer,
    mediaId: dh.mediaId,
    episodeId: dh.episodeId,
    kind,
    reason: `auto: ${kind} — ${reason}`,
  });
  if (!hash) return;
  // A season pack re-grabbed as episodes can share one torrent; never pull it from a live row.
  if (await deps.hashInUseByOthers(hash, dh.id)) return;
  const adapter = await deps.resolveAdapter();
  if (!adapter) return;
  try {
    const torrents = await adapter.listTorrents();
    const torrent = torrents.find((t) => t.hash.toLowerCase() === hash);
    if (!torrent) {
      await deps.stampReleased(dh.id, kind, null);
      return;
    }
    if (!isRawkoonOwned(torrent)) {
      await deps.stampReleased(dh.id, "adopted", null);
      return;
    }
    await adapter.remove(torrent.hash, !sharesContentPath(torrent, torrents));
    await deps.stampReleased(dh.id, kind, BigInt(torrent.sizeBytes));
  } catch (error) {
    console.warn(
      `[downloadJanitor] could not remove rejected torrent ${hash}:`,
      error,
    );
  }
}

/** The first blocked file in a torrent, or null when clean or metadata is not known yet. */
export async function findBlockedFileInTorrent(
  hash: string,
  extensions: readonly string[],
  adapter: Pick<DownloadClientAdapter, "listFiles">,
): Promise<string | null> {
  if (extensions.length === 0) return null;
  const files = await adapter.listFiles(hash).catch(() => null);
  return files ? findBlockedFile(files, extensions) : null;
}
