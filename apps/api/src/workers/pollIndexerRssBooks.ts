import { prisma } from "@rawkoon/api/db";
import type { IndexerManagerAdapter } from "@rawkoon/api/services/indexerManager/types";
import type { NormalizedRelease } from "@rawkoon/api/services/indexerManager/types";
import {
  grabBookRelease,
  loadEditionContext,
} from "@rawkoon/api/services/books/bookGrabber";
import { scoreBookRelease } from "@rawkoon/api/utils/books/bookReleaseScorer";

/**
 * Book half of the RSS sweep.
 *
 * Separate from pollIndexerRss rather than folded into it: the media pass
 * matches on parsed season/episode/title and scores with the video profile,
 * while a book match is a reject-filter decision over the whole release name.
 * Sharing one loop would mean two unrelated matchers interleaved in the same
 * hot path, and the media one is load-bearing in production.
 *
 * Categories 7000 + 3000 are fetched together because trackers file audiobooks
 * under either; the edition's kind comes from the parsed release, not the
 * category it arrived in.
 */

const BOOK_RSS_CATEGORIES = ["7000", "3000"];

export interface BookRssStats {
  found: number;
  grabbed: number;
}

export async function pollIndexerRssBooks(
  adapter: IndexerManagerAdapter,
  rssIndexers: string[],
): Promise<BookRssStats> {
  const settings = await prisma.appSettings.findUnique({
    where: { id: 1 },
    select: { booksEnabled: true },
  });
  if (settings?.booksEnabled !== true) return { found: 0, grabbed: 0 };

  const wanted = await prisma.bookEdition.findMany({
    where: {
      monitored: true,
      status: "wanted",
      files: { none: {} },
    },
    select: { id: true },
  });
  if (wanted.length === 0) return { found: 0, grabbed: 0 };

  let releases: NormalizedRelease[];
  try {
    releases = await adapter.fetchRss(rssIndexers, BOOK_RSS_CATEGORIES);
  } catch (e) {
    console.warn("[pollIndexerRssBooks] RSS fetch failed:", e);
    return { found: 0, grabbed: 0 };
  }
  if (releases.length === 0) return { found: 0, grabbed: 0 };

  let grabbed = 0;

  for (const edition of wanted) {
    const ctx = await loadEditionContext(edition.id);
    if (!ctx) continue;

    let best: { release: NormalizedRelease; score: number } | null = null;
    for (const release of releases) {
      const scored = scoreBookRelease(
        {
          title: release.title,
          sizeBytes: release.sizeBytes,
          seeders: release.seeders,
          indexer: release.indexer,
        },
        {
          bookTitle: ctx.bookTitle,
          authors: ctx.authors,
          kind: ctx.kind,
          profile: ctx.profile,
        },
      );
      if (scored.rejected) continue;
      // The RSS feed carries whatever the tracker published, so kind has to be
      // re-checked here: an audiobook in the feed must not satisfy an ebook
      // edition just because the reject filter passed the title.
      if (scored.kind !== ctx.kind) continue;
      if (!best || scored.score > best.score) {
        best = { release, score: scored.score };
      }
    }
    if (!best) continue;

    const url = best.release.downloadUrl ?? best.release.magnetUrl;
    if (!url) continue;

    try {
      const result = await grabBookRelease({
        editionId: edition.id,
        downloadUrl: url,
        releaseTitle: best.release.title,
        indexer: best.release.indexer,
      });
      if (result.grabbed) grabbed++;
      else {
        console.log(
          `[pollIndexerRssBooks] grab refused for edition ${edition.id}: ${result.reason}`,
        );
      }
    } catch (e) {
      console.warn(
        `[pollIndexerRssBooks] grab failed for edition ${edition.id}:`,
        e,
      );
    }
  }

  if (grabbed > 0 || releases.length > 0) {
    console.log(
      `[pollIndexerRssBooks] ${grabbed} grab(s) from ${releases.length} book RSS release(s)`,
    );
  }

  return { found: releases.length, grabbed };
}
