import { prisma } from "@rawkoon/api/db";
import {
  isReadableFormat,
  type BookFormat,
  type BookManifest,
  type BookManifestFile,
  type BookEditionKind,
} from "@rawkoon/shared/types";

import { getProgress } from "./bookProgress";
import { isConcatEligible } from "./bookStreamLayout";

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
          // Only used to decide whether the edition can be served as one
          // concatenated stream; uniform CBR is what makes that valid.
          audioBitrate: true,
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

  /**
   * An audiobook file with no duration cannot be placed on the timeline.
   *
   * Offsets accumulate, so a null duration contributed zero and gave the file
   * the same offset as the one after it. `locate()` resolves a boundary to the
   * later file, which made the undated file unreachable by seek, left it
   * without a synthetic chapter, and made every later offset a lie — playback
   * jumped backwards on crossing into the next file. Dropping it costs one
   * chapter; keeping it corrupted everything after it.
   */
  const playable = isAudiobook
    ? sorted.filter((file) => file.durationSecs != null)
    : sorted;
  if (isAudiobook && playable.length !== sorted.length) {
    console.warn(
      `[bookManifest] edition ${edition.id}: omitting ${
        sorted.length - playable.length
      } audiobook file(s) with no known duration; re-scan the edition to place them on the timeline`,
    );
  }

  let offset = 0;
  const files: BookManifestFile[] = playable.map((file) => {
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

  /**
   * One seekable resource for the whole edition, when there is one.
   *
   * A single-file audiobook already is one — no concatenation needed, and
   * pointing at the file directly keeps the byte route's caching. Several
   * uniform CBR mp3s become one through the stream route. Anything else is
   * null, and the player falls back to stitching a timeline itself.
   */
  let streamUrl: string | null = null;
  if (isAudiobook && files.length === 1) {
    streamUrl = files[0].content_url;
  } else if (isAudiobook && isConcatEligible(playable)) {
    streamUrl = `/api/books/editions/${edition.id}/stream`;
  }

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
    stream_url: streamUrl,
    progress: await getProgress(userId, edition.id),
  };
};
