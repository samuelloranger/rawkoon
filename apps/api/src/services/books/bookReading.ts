import { prisma } from "@rawkoon/api/db";
import {
  READABLE_EBOOK_FORMATS,
  type BookEditionKind,
  type BookReadingEntry,
} from "@rawkoon/shared/types";

/**
 * Books the user is in the middle of.
 *
 * "Started" is a position that is more than noise — opening a book writes a
 * position at the very first page, and a shelf of 1%-read books nobody chose to
 * read is worse than no shelf. "Unfinished" is `finished_at IS NULL`: percent
 * alone cannot say it, because an epub's last page rarely reports 1.0.
 *
 * "Openable" is part of the same predicate rather than a pass afterwards. An
 * ebook edition holding only mobi has no browser renderer, and a row that
 * cannot be resumed does not belong in a "continue" list — but filtering those
 * out after a `take` meant a run of them could hide every readable book behind
 * them. The database decides, so the limit is exact.
 */

/** A position below this is the act of opening the book, not reading it. */
const STARTED_PERCENT = 0.005;
/** Seconds. Same idea for an audiobook. */
const STARTED_SECS = 30;

export const listReading = async (
  userId: string,
  limit: number,
): Promise<BookReadingEntry[]> => {
  const rows = await prisma.bookProgress.findMany({
    where: {
      userId,
      finishedAt: null,
      OR: [
        { percent: { gt: STARTED_PERCENT } },
        { positionSecs: { gt: STARTED_SECS } },
      ],
      edition: {
        OR: [
          // Any file will do for a listener; a reader needs one a browser can
          // render.
          { kind: "audiobook", files: { some: {} } },
          {
            kind: { not: "audiobook" },
            files: { some: { format: { in: [...READABLE_EBOOK_FORMATS] } } },
          },
        ],
      },
    },
    orderBy: { updatedAt: "desc" },
    take: limit,
    select: {
      editionId: true,
      percent: true,
      positionSecs: true,
      updatedAt: true,
      edition: {
        select: {
          kind: true,
          durationSecs: true,
          book: {
            select: { id: true, title: true, authors: true, coverUrl: true },
          },
          files: { select: { format: true, durationSecs: true } },
        },
      },
    },
  });

  const entries: BookReadingEntry[] = [];
  for (const row of rows) {
    const edition = row.edition;
    const isAudiobook = edition.kind === "audiobook";

    // The edition's own duration is the trustworthy total when the probe set
    // it; summing files is the fallback, and null when neither is known.
    const summed = edition.files.reduce(
      (total, file) => total + (file.durationSecs ?? 0),
      0,
    );
    const duration = edition.durationSecs ?? (summed > 0 ? summed : null);

    entries.push({
      edition_id: row.editionId,
      book_id: edition.book.id,
      kind: edition.kind as BookEditionKind,
      title: edition.book.title,
      authors: edition.book.authors,
      cover_url: edition.book.coverUrl,
      percent: isAudiobook ? null : row.percent,
      position_secs: isAudiobook ? row.positionSecs : null,
      total_duration_secs: isAudiobook ? duration : null,
      updated_at: row.updatedAt.toISOString(),
    });
  }

  return entries;
};
