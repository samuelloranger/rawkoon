import { prisma } from "@rawkoon/api/db";
import { ebookChapterNames } from "@rawkoon/api/services/books/ebookChapterNames";
import {
  numberedChapterTitle,
  titlesAreUninformative,
} from "@rawkoon/api/services/books/registerBookChapters";

/** Titles nothing has named yet: all the same, or the "Chapter N" fallback. */
export const hasPlaceholderTitles = (titles: string[]): boolean =>
  titles.length > 1 &&
  (titlesAreUninformative(titles) ||
    titles.every((t, i) => t === numberedChapterTitle(i)));

/** Once a book's epub lands, names its audiobook's placeholder chapters from it; true when titles changed. */
export async function renameAudiobookChaptersFromEbook(
  bookId: number,
): Promise<boolean> {
  try {
    const audiobook = await prisma.bookEdition.findUnique({
      where: { bookId_kind: { bookId, kind: "audiobook" } },
      select: {
        id: true,
        chapters: {
          orderBy: { index: "asc" },
          select: { id: true, title: true, startSecs: true, endSecs: true },
        },
      },
    });
    if (!audiobook) return false;
    const { chapters } = audiobook;
    if (!hasPlaceholderTitles(chapters.map((c) => c.title))) return false;

    const names = await ebookChapterNames(
      audiobook.id,
      chapters.map((c) => c.endSecs - c.startSecs),
    );
    if (!names) return false;

    // Titles only: offsets and row ids stay, so cached manifests and positions remain valid.
    await prisma.$transaction(
      chapters.map((c, i) =>
        prisma.bookChapter.update({
          where: { id: c.id },
          data: { title: names[i]! },
        }),
      ),
    );
    return true;
  } catch (e) {
    // Naming is cosmetic: it must never fail the ebook import that triggered it.
    console.warn(`[renameChaptersFromEbook] book ${bookId}:`, e);
    return false;
  }
}
