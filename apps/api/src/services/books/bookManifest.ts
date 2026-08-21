import { prisma } from "@rawkoon/api/db";
import {
  isReadableFormat,
  type BookFormat,
  type BookManifest,
  type BookManifestFile,
  type BookEditionKind,
} from "@rawkoon/shared/types";

import { getProgress } from "./bookProgress";

/**
 * Reader preference among an ebook edition's files. An edition holding both an
 * epub and a pdf opens the epub, because only epub supports reflow.
 */
const READER_PREFERENCE: BookFormat[] = ["epub", "pdf", "cbz"];

/**
 * "Part 2" must sort before "Part 10". Plain string order gets this wrong, and
 * multi-file audiobooks are named exactly this way.
 */
export const naturalCompare = (a: string, b: string): number =>
  a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });

export const buildManifest = async (
  editionId: number,
  userId: string,
): Promise<BookManifest | null> => {
  const edition = await prisma.bookEdition.findUnique({
    where: { id: editionId },
    select: {
      id: true,
      kind: true,
      narrators: true,
      book: {
        select: { id: true, title: true, authors: true, coverUrl: true },
      },
      files: {
        select: {
          id: true,
          fileName: true,
          format: true,
          sizeBytes: true,
          durationSecs: true,
          chapters: {
            select: {
              index: true,
              title: true,
              startSecs: true,
              endSecs: true,
            },
            orderBy: { index: "asc" as const },
          },
        },
      },
    },
  });
  if (!edition) return null;

  const isAudiobook = edition.kind === "audiobook";
  const sorted = [...edition.files].sort((a, b) =>
    naturalCompare(a.fileName, b.fileName),
  );

  let offset = 0;
  const files: BookManifestFile[] = sorted.map((file) => {
    const duration = file.durationSecs ?? null;
    const chapters = file.chapters.length
      ? file.chapters.map((c) => ({
          index: c.index,
          title: c.title,
          start_secs: c.startSecs,
          end_secs: c.endSecs,
        }))
      : // A file with no chapter marks is its own chapter, so the player's
        // chapter list is never empty for a multi-file audiobook.
        isAudiobook && duration != null
        ? [
            {
              index: 0,
              title: file.fileName,
              start_secs: 0,
              end_secs: duration,
            },
          ]
        : [];

    const entry: BookManifestFile = {
      id: file.id,
      file_name: file.fileName,
      format: file.format as BookFormat,
      size_bytes: file.sizeBytes.toString(),
      duration_secs: duration,
      offset_secs: offset,
      readable: isAudiobook ? true : isReadableFormat(file.format),
      chapters,
      content_url: `/api/books/files/${file.id}/content`,
    };
    offset += duration ?? 0;
    return entry;
  });

  const totalDuration = isAudiobook ? offset : null;

  let primaryFileId: number | null = null;
  if (!isAudiobook) {
    let bestRank = Number.POSITIVE_INFINITY;
    for (const file of files) {
      const rank = READER_PREFERENCE.indexOf(file.format);
      if (rank !== -1 && rank < bestRank) {
        bestRank = rank;
        primaryFileId = file.id;
      }
    }
  }

  return {
    edition_id: edition.id,
    book_id: edition.book.id,
    kind: edition.kind as BookEditionKind,
    title: edition.book.title,
    authors: edition.book.authors,
    narrators: edition.narrators,
    cover_url: edition.book.coverUrl,
    total_duration_secs: totalDuration === 0 ? null : totalDuration,
    files,
    primary_file_id: primaryFileId,
    progress: await getProgress(userId, edition.id),
  };
};
