import { prisma } from "@rawkoon/api/db";
import {
  emitBookUpdate,
  emitLibraryLanded,
  emitLibraryUpdate,
} from "@rawkoon/api/services/libraryEvents";

/**
 * Everything a download outcome tells the outside world: live-client events,
 * admin/requester notifications, Jellyfin refresh and seed checks. The outcome
 * module owns the DB state; this port owns the fan-out, so tests can record it
 * instead of mocking each notifier.
 */
export interface OutcomeEffects {
  /** A library item changed; live clients refetch it. */
  libraryChanged(mediaId: number): void;
  /** A book changed; live clients refetch it. */
  bookChanged(bookId: number): void;
  /** Notify whoever requested the title. Reads the status the completion transition wrote. */
  requestAvailable(mediaId: number): Promise<void>;
  /** A grab failed before import; tell admins. May throw. */
  downloadFailed(p: {
    mediaId: number;
    downloadHistoryId: number;
    episodeId: number | null;
    reason: string;
  }): Promise<void>;
  /** A fresh import landed; tell live clients what arrived. Never throws. */
  importLanded(p: {
    mediaId: number;
    episodeId: number | null | undefined;
    season: number | null | undefined;
    episodeCount: number | null | undefined;
  }): Promise<void>;
  /** A fresh import finished; tell admins. */
  mediaDownloaded(p: {
    mediaId: number;
    downloadHistoryId: number;
    episodeId: number | null | undefined;
    season: number | null | undefined;
    episodeCount: number | undefined;
    isUpgrade: boolean;
  }): Promise<void>;
  /** A book import finished; tell admins. */
  bookDownloaded(
    bookEditionId: number,
    isUpgrade: boolean,
    downloadHistoryId: number,
  ): Promise<void>;
  /** An import failed in a retryable way; tell admins (book or media flavour by row target). */
  importFailed(p: {
    downloadHistoryId: number;
    reason: string;
    mediaId: number | null | undefined;
    episodeId: number | null | undefined;
    bookEditionId: number | null | undefined;
    isUpgrade: boolean;
  }): Promise<void>;
  /** Decide whether the torrent behind an imported row can stop seeding. May throw. */
  seedReleaseCheck(torrentHash: string): Promise<void>;
  /** Ask Jellyfin to rescan after an import. */
  libraryScan(): Promise<void>;
}

async function landed(p: {
  mediaId: number;
  episodeId: number | null | undefined;
  season: number | null | undefined;
  episodeCount: number | null | undefined;
}): Promise<void> {
  const { mediaId, episodeId, season, episodeCount } = p;
  try {
    const media = await prisma.libraryMedia.findUnique({
      where: { id: mediaId },
      select: { title: true, type: true, posterUrl: true, overrides: true },
    });
    if (!media) return;
    const episode =
      episodeId != null
        ? await prisma.libraryEpisode.findUnique({
            where: { id: episodeId },
            select: { season: true, episode: true },
          })
        : null;
    const ov = (media.overrides ?? {}) as Record<string, unknown>;
    emitLibraryLanded({
      mediaId,
      mediaType: media.type === "movie" ? "movie" : "tv",
      title: typeof ov.title === "string" ? ov.title : media.title,
      posterUrl:
        typeof ov.poster_url === "string" ? ov.poster_url : media.posterUrl,
      season:
        episode?.season ?? (media.type === "movie" ? null : (season ?? null)),
      episode: episode?.episode ?? null,
      episodeCount: episode ? null : (episodeCount ?? null),
    });
  } catch (e) {
    console.warn(`[downloadOutcome] landed event failed media=${mediaId}:`, e);
  }
}

// Lazy imports: the notifiers pull in queue/redis at load time, which DB-only consumers and tests must not trigger.
export const productionOutcomeEffects: OutcomeEffects = {
  libraryChanged: emitLibraryUpdate,
  bookChanged: emitBookUpdate,
  requestAvailable: async (mediaId) => {
    const { notifyRequestAvailable } = await import(
      "@rawkoon/api/services/mediaRequests"
    );
    await notifyRequestAvailable(mediaId);
  },
  downloadFailed: async (p) => {
    const { notifyAdminsLibraryDownloadFailed } = await import(
      "@rawkoon/api/workers/notifyLibraryEvents"
    );
    await notifyAdminsLibraryDownloadFailed(p);
  },
  importLanded: landed,
  mediaDownloaded: async (p) => {
    const { notifyAdminsMediaDownloaded } = await import(
      "@rawkoon/api/workers/notifyMediaDownloaded"
    );
    await notifyAdminsMediaDownloaded(p);
  },
  bookDownloaded: async (bookEditionId, isUpgrade, downloadHistoryId) => {
    const { notifyAdminsBookDownloaded } = await import(
      "@rawkoon/api/workers/notifyBookEvents"
    );
    await notifyAdminsBookDownloaded(
      bookEditionId,
      isUpgrade,
      downloadHistoryId,
    );
  },
  importFailed: async (p) => {
    if (p.bookEditionId != null) {
      const { notifyAdminsBookImportFailed } = await import(
        "@rawkoon/api/workers/notifyBookEvents"
      );
      await notifyAdminsBookImportFailed(
        p.bookEditionId,
        p.reason,
        p.isUpgrade,
        p.downloadHistoryId,
      );
      return;
    }
    const { notifyAdminsPostProcessFailed } = await import(
      "@rawkoon/api/workers/notifyLibraryEvents"
    );
    await notifyAdminsPostProcessFailed(
      p.downloadHistoryId,
      p.reason,
      p.mediaId,
      p.episodeId,
    );
  },
  seedReleaseCheck: async (torrentHash) => {
    const { evaluateSeedRelease } = await import(
      "@rawkoon/api/services/seeding/seedSweep"
    );
    await evaluateSeedRelease(torrentHash);
  },
  libraryScan: async () => {
    const { triggerJellyfinLibraryScan } = await import(
      "@rawkoon/api/services/jellyfin/jellyfinLibraryRefresh"
    );
    await triggerJellyfinLibraryScan();
  },
};
