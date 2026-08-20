import { prisma } from "@rawkoon/api/db";
import { createAndQueueNotification } from "@rawkoon/api/workers/notificationService";
import { getAdminUserIds } from "@rawkoon/api/utils/admins";

/**
 * Admin notifications for the book pipeline.
 *
 * The media side spreads these across notifyMediaDownloaded /
 * notifyPostProcessFailed / notifyLibraryGrabSkipped; books keep them together
 * because they share the same lookup (edition → book) and the same delivery.
 *
 * Every one is best-effort: a notification failure must never fail the grab,
 * import, or author check that triggered it.
 */

const KIND_LABEL: Record<string, string> = {
  ebook: "Ebook",
  audiobook: "Audiobook",
};

async function editionContext(editionId: number): Promise<{
  bookId: number;
  label: string;
  kindLabel: string;
  coverUrl: string | null;
} | null> {
  const edition = await prisma.bookEdition.findUnique({
    where: { id: editionId },
    select: {
      kind: true,
      book: {
        select: {
          id: true,
          title: true,
          publishedYear: true,
          authors: true,
          coverUrl: true,
        },
      },
    },
  });
  if (!edition) return null;

  const { book } = edition;
  const author = book.authors[0];
  const year = book.publishedYear ? ` (${book.publishedYear})` : "";
  return {
    bookId: book.id,
    label: author
      ? `${book.title}${year} by ${author}`
      : `${book.title}${year}`,
    kindLabel: KIND_LABEL[edition.kind] ?? edition.kind,
    coverUrl: book.coverUrl,
  };
}

async function notifyAdmins(opts: {
  title: string;
  body: string;
  type: string;
  url: string;
  imageUrl?: string | null;
  logTag: string;
}): Promise<void> {
  const adminIds = await getAdminUserIds();
  for (const adminId of adminIds) {
    try {
      await createAndQueueNotification(
        adminId,
        opts.title,
        opts.body,
        opts.type,
        opts.url,
        undefined,
        opts.imageUrl ?? undefined,
      );
    } catch (e) {
      console.warn(`[${opts.logTag}] Failed for user ${adminId}:`, e);
    }
  }
}

export async function notifyAdminsBookGrabbed(
  editionId: number,
  releaseTitle: string,
): Promise<void> {
  const ctx = await editionContext(editionId);
  if (!ctx) return;
  await notifyAdmins({
    title: `${ctx.kindLabel} grabbed`,
    body: `${ctx.label} — ${releaseTitle}`,
    type: "book_grabbed",
    url: `/books/${ctx.bookId}`,
    imageUrl: ctx.coverUrl,
    logTag: "notifyAdminsBookGrabbed",
  });
}

export async function notifyAdminsBookDownloaded(
  editionId: number,
): Promise<void> {
  const ctx = await editionContext(editionId);
  if (!ctx) return;
  await notifyAdmins({
    title: `${ctx.kindLabel} downloaded`,
    body: `${ctx.label} is now in your library.`,
    type: "book_downloaded",
    url: `/books/${ctx.bookId}`,
    imageUrl: ctx.coverUrl,
    logTag: "notifyAdminsBookDownloaded",
  });
}

export async function notifyAdminsBookImportFailed(
  editionId: number,
  reason: string,
): Promise<void> {
  const ctx = await editionContext(editionId);
  if (!ctx) return;
  await notifyAdmins({
    title: `${ctx.kindLabel} import failed`,
    body: `${ctx.label}: ${reason}`,
    type: "book_import_failed",
    url: `/books/${ctx.bookId}`,
    imageUrl: ctx.coverUrl,
    logTag: "notifyAdminsBookImportFailed",
  });
}

export async function notifyAdminsBookSearchSkipped(
  editionId: number,
  reason: string,
): Promise<void> {
  const ctx = await editionContext(editionId);
  if (!ctx) return;
  await notifyAdmins({
    title: `${ctx.kindLabel} search gave up`,
    body: `${ctx.label}: ${reason}`,
    type: "book_search_skipped",
    url: `/books/${ctx.bookId}`,
    imageUrl: ctx.coverUrl,
    logTag: "notifyAdminsBookSearchSkipped",
  });
}

/** One notification per author check, listing what was added. */
export async function notifyAdminsAuthorNewReleases(
  authorName: string,
  titles: string[],
): Promise<void> {
  if (titles.length === 0) return;
  const shown = titles.slice(0, 5).join(", ");
  const more = titles.length > 5 ? ` and ${titles.length - 5} more` : "";
  await notifyAdmins({
    title: `New from ${authorName}`,
    body: `Added ${titles.length} title(s): ${shown}${more}`,
    type: "author_new_release",
    url: "/books",
    logTag: "notifyAdminsAuthorNewReleases",
  });
}
