import { prisma } from "@rawkoon/api/db";
import { APP_PATHS } from "@rawkoon/shared/constants";
import { buildNotificationUrl } from "@rawkoon/shared/utils";
import { downloadLifecycleKey } from "@rawkoon/api/services/notification/notificationLifecycle";
import {
  notificationCopy,
  truncateReleaseTitle,
} from "@rawkoon/api/services/notification/notificationCopy";
import { getAdminNotificationTargets } from "@rawkoon/api/services/notification/notificationPreferences";
import { createAndQueueNotification } from "@rawkoon/api/workers/notificationService";

const KIND_LABEL: Record<string, "bookKindEbook" | "bookKindAudiobook"> = {
  ebook: "bookKindEbook",
  audiobook: "bookKindAudiobook",
};

async function editionContext(editionId: number): Promise<{
  bookId: number;
  title: string;
  label: string;
  kindKey: "bookKindEbook" | "bookKindAudiobook";
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
  const kindKey = KIND_LABEL[edition.kind] ?? "bookKindEbook";
  return {
    bookId: book.id,
    title: book.title,
    label: author
      ? `${book.title}${year} by ${author}`
      : `${book.title}${year}`,
    kindKey,
    coverUrl: book.coverUrl,
  };
}

async function notifyAdmins(opts: {
  build: (locale: string | null) => {
    title: string;
    body: string;
    type: string;
    url: string;
  };
  imageUrl?: string | null;
  metadata?: Record<string, unknown>;
  preferenceKey:
    | "book_downloaded"
    | "book_grabbed"
    | "book_failed"
    | "book_search_skipped"
    | "book_author_releases";
  /** The grab this notice belongs to; its stages share one notification. */
  downloadHistoryId?: number | null;
  push?: boolean;
  logTag: string;
}): Promise<void> {
  const admins = await getAdminNotificationTargets();
  for (const admin of admins) {
    const msg = opts.build(admin.locale);
    try {
      await createAndQueueNotification(
        admin.id,
        msg.title,
        msg.body,
        msg.type,
        msg.url,
        opts.metadata,
        opts.imageUrl ?? undefined,
        {
          preferenceKey: opts.preferenceKey,
          push: opts.push,
          ...(opts.downloadHistoryId != null
            ? { lifecycleKey: downloadLifecycleKey(opts.downloadHistoryId) }
            : {}),
        },
      );
    } catch (e) {
      console.warn(`[${opts.logTag}] Failed for user ${admin.id}:`, e);
    }
  }
}

export async function notifyAdminsBookGrabbed(
  editionId: number,
  releaseTitle: string,
  isUpgrade = false,
  downloadHistoryId: number | null = null,
): Promise<void> {
  const ctx = await editionContext(editionId);
  if (!ctx) return;
  const release = truncateReleaseTitle(releaseTitle);
  await notifyAdmins({
    build: (locale) => ({
      title: notificationCopy(
        locale,
        isUpgrade ? "bookUpgradeGrabbedTitle" : "bookGrabbedTitle",
        { kind: notificationCopy(locale, ctx.kindKey) },
      ),
      body: notificationCopy(locale, "bookEventBody", {
        body: `${ctx.label} — ${release}`,
      }),
      type: "book_grabbed",
      url: `/books/${ctx.bookId}`,
    }),
    imageUrl: ctx.coverUrl,
    metadata: {
      book_id: ctx.bookId,
      is_upgrade: isUpgrade,
      subject: ctx.title,
      detail: release,
      release,
    },
    preferenceKey: "book_grabbed",
    // A grab shows in the app; only the download it leads to reaches devices.
    push: false,
    downloadHistoryId,
    logTag: "notifyAdminsBookGrabbed",
  });
}

export async function notifyAdminsBookDownloaded(
  editionId: number,
  isUpgrade = false,
  downloadHistoryId: number | null = null,
): Promise<void> {
  const ctx = await editionContext(editionId);
  if (!ctx) return;
  await notifyAdmins({
    build: (locale) => ({
      title: notificationCopy(
        locale,
        isUpgrade ? "bookUpgradedTitle" : "bookDownloadedTitle",
        { kind: notificationCopy(locale, ctx.kindKey) },
      ),
      body: isUpgrade
        ? notificationCopy(locale, "bookUpgradedBody", { label: ctx.label })
        : notificationCopy(locale, "bookEventBody", {
            body: `${ctx.label} is now in your library.`,
          }),
      type: "book_downloaded",
      url: `/books/${ctx.bookId}`,
    }),
    imageUrl: ctx.coverUrl,
    metadata: {
      book_id: ctx.bookId,
      is_upgrade: isUpgrade,
      subject: ctx.title,
    },
    preferenceKey: "book_downloaded",
    downloadHistoryId,
    logTag: "notifyAdminsBookDownloaded",
  });
}

export async function notifyAdminsBookImportFailed(
  editionId: number,
  reason: string,
  isUpgrade = false,
  downloadHistoryId: number | null = null,
): Promise<void> {
  const ctx = await editionContext(editionId);
  if (!ctx) return;
  await notifyAdmins({
    build: (locale) => ({
      title: notificationCopy(
        locale,
        isUpgrade ? "bookUpgradeFailedTitle" : "bookImportFailedTitle",
        { kind: notificationCopy(locale, ctx.kindKey) },
      ),
      // A failed upgrade still leaves a copy in the library, unlike a failed first grab.
      body: isUpgrade
        ? notificationCopy(locale, "bookUpgradeFailedBody", {
            label: ctx.label,
            reason,
          })
        : notificationCopy(locale, "bookEventBody", {
            body: `${ctx.label}: ${reason}`,
          }),
      type: "book_import_failed",
      url: `/books/${ctx.bookId}`,
    }),
    imageUrl: ctx.coverUrl,
    metadata: {
      book_id: ctx.bookId,
      is_upgrade: isUpgrade,
      subject: ctx.title,
      detail: reason,
    },
    preferenceKey: "book_failed",
    downloadHistoryId,
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
    build: (locale) => ({
      title: notificationCopy(locale, "bookSearchSkippedTitle", {
        kind: notificationCopy(locale, ctx.kindKey),
      }),
      body: notificationCopy(locale, "bookEventBody", {
        body: `${ctx.label}: ${reason}`,
      }),
      type: "book_search_skipped",
      url: `/books/${ctx.bookId}`,
    }),
    imageUrl: ctx.coverUrl,
    metadata: { book_id: ctx.bookId },
    preferenceKey: "book_search_skipped",
    logTag: "notifyAdminsBookSearchSkipped",
  });
}

export async function notifyAdminsAuthorNewReleases(
  authorName: string,
  titles: string[],
): Promise<void> {
  if (titles.length === 0) return;
  const shown = titles.slice(0, 5).join(", ");
  const more = titles.length > 5 ? ` and ${titles.length - 5} more` : "";
  const url = buildNotificationUrl(APP_PATHS.books, { search: authorName });
  await notifyAdmins({
    build: (locale) => ({
      title: notificationCopy(locale, "authorNewReleasesTitle", {
        author: authorName,
      }),
      body: notificationCopy(locale, "authorNewReleasesBody", {
        count: titles.length,
        titles: shown,
        more,
      }),
      type: "author_new_release",
      url,
    }),
    preferenceKey: "book_author_releases",
    logTag: "notifyAdminsAuthorNewReleases",
  });
}
