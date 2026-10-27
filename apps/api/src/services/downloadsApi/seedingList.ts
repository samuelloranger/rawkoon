import { prisma } from "@rawkoon/api/db";
import type { NormalizedTorrent } from "@rawkoon/api/services/downloadClient/types";
import {
  defaultSweepDeps,
  loadSeedContext,
  previewSeedRelease,
} from "@rawkoon/api/services/seeding/seedSweep";
import {
  buildSeedingTorrents,
  supersededIds,
} from "@rawkoon/api/services/seeding/seedingView";
import type { ReleasedTorrent, SeedReleaseReason } from "@rawkoon/shared/types";

const RELEASE_REASONS_SHOWN: SeedReleaseReason[] = [
  "target_met",
  "manual",
  "move_mode",
];

export async function loadSeedingView(
  torrents: NormalizedTorrent[],
  preview: boolean,
) {
  const [enabled, ctx, rows] = await Promise.all([
    defaultSweepDeps.isEnabled(),
    loadSeedContext(),
    prisma.downloadHistory.findMany({
      where: {
        completedAt: { not: null },
        failed: false,
        seedReleasedAt: null,
        torrentHash: { not: null },
      },
      select: {
        id: true,
        torrentHash: true,
        indexer: true,
        grabbedAt: true,
        mediaId: true,
        episodeId: true,
        bookEditionId: true,
        media: {
          select: {
            id: true,
            title: true,
            year: true,
            posterUrl: true,
            type: true,
          },
        },
        bookEdition: {
          select: {
            kind: true,
            book: { select: { id: true, title: true, coverUrl: true } },
          },
        },
      },
    }),
  ]);
  const held = rows.flatMap((r) =>
    r.torrentHash
      ? [
          {
            id: r.id,
            torrentHash: r.torrentHash,
            indexer: r.indexer,
            grabbedAt: r.grabbedAt,
            mediaId: r.mediaId,
            episodeId: r.episodeId,
            bookEditionId: r.bookEditionId,
            media: r.media,
            book: r.bookEdition
              ? { ...r.bookEdition.book, kind: r.bookEdition.kind }
              : null,
          },
        ]
      : [],
  );
  const mediaIds = [
    ...new Set(held.flatMap((h) => (h.mediaId != null ? [h.mediaId] : []))),
  ];
  const editionIds = [
    ...new Set(
      held.flatMap((h) => (h.bookEditionId != null ? [h.bookEditionId] : [])),
    ),
  ];
  const completed = await prisma.downloadHistory.findMany({
    where: {
      completedAt: { not: null },
      failed: false,
      OR: [
        { mediaId: { in: mediaIds } },
        { bookEditionId: { in: editionIds } },
      ],
    },
    select: {
      id: true,
      mediaId: true,
      episodeId: true,
      bookEditionId: true,
      grabbedAt: true,
    },
  });
  const torrentsView = buildSeedingTorrents(
    held,
    torrents,
    ctx,
    supersededIds(held, completed),
  );

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const releasedRows = await prisma.downloadHistory.findMany({
    where: {
      seedReleasedAt: { gte: startOfDay },
      seedReleaseReason: { in: RELEASE_REASONS_SHOWN },
    },
    select: {
      torrentHash: true,
      releaseTitle: true,
      seedReleaseReason: true,
      seedReleasedAt: true,
      seedReleasedBytes: true,
      media: { select: { title: true } },
      bookEdition: { select: { book: { select: { title: true } } } },
    },
    orderBy: { seedReleasedAt: "desc" },
  });
  const releasedByHash = new Map<string, ReleasedTorrent>();
  for (const r of releasedRows) {
    const hash = r.torrentHash?.toLowerCase();
    if (!hash || releasedByHash.has(hash) || !r.seedReleasedAt) continue;
    releasedByHash.set(hash, {
      hash,
      title: r.media?.title ?? r.bookEdition?.book.title ?? r.releaseTitle,
      reason: r.seedReleaseReason as SeedReleaseReason,
      released_at: r.seedReleasedAt.toISOString(),
      size_bytes:
        r.seedReleasedBytes != null ? Number(r.seedReleasedBytes) : null,
    });
  }

  let wouldReleaseNow: { count: number; bytes: number } | undefined;
  if (preview) {
    const pendingHashes = await defaultSweepDeps.loadPendingHashes();
    wouldReleaseNow = previewSeedRelease(
      held.map((h) => ({
        id: h.id,
        torrentHash: h.torrentHash,
        indexer: h.indexer,
      })),
      torrents,
      { ...ctx, pendingHashes },
    );
  }

  return {
    enabled,
    torrents: torrentsView,
    released_today: [...releasedByHash.values()],
    ...(wouldReleaseNow ? { would_release_now: wouldReleaseNow } : {}),
  };
}
