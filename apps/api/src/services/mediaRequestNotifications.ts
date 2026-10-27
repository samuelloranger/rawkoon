import { APP_PATHS } from "@rawkoon/shared/constants";
import { prisma } from "@rawkoon/api/db";
import { createAndQueueNotification } from "@rawkoon/api/workers/notificationService";
import {
  getAdminNotificationTargets,
  getNotificationTarget,
} from "@rawkoon/api/services/notification/notificationPreferences";
import { notificationCopy } from "@rawkoon/api/services/notification/notificationCopy";
import { buildLibraryNotificationUrl } from "@rawkoon/shared/utils";

type RequestKind = "movie" | "show" | "book";

function requestKindLabel(
  locale: string | null | undefined,
  type: RequestKind,
): string {
  return notificationCopy(
    locale,
    type === "movie"
      ? "mediaKindMovie"
      : type === "show"
        ? "mediaKindShow"
        : "mediaKindBook",
  );
}

export function requestTitleLabel(title: string, year: number | null): string {
  return year ? `${title} (${year})` : title;
}

export async function notifyAdminsRequestPending(
  requestId: number,
  type: RequestKind,
  title: string,
  year: number | null,
  posterUrl: string | null,
): Promise<void> {
  const admins = await getAdminNotificationTargets();
  const label = requestTitleLabel(title, year);
  await Promise.all(
    admins.map((admin) =>
      createAndQueueNotification(
        admin.id,
        notificationCopy(admin.locale, "requestPendingTitle", {
          kind: requestKindLabel(admin.locale, type),
        }),
        notificationCopy(admin.locale, "requestPendingBody", { title: label }),
        "request_pending",
        APP_PATHS.activityRequests,
        { requestId },
        posterUrl ?? undefined,
        { preferenceKey: "request_pending" },
      ),
    ),
  );
}

export async function notifyRequestAvailable(
  libraryMediaId: number,
): Promise<void> {
  const req = await prisma.mediaRequest.findFirst({
    where: { libraryMediaId, status: "approved" },
  });
  if (!req) return;

  // Only mark available once the media is actually complete. This avoids a
  // single finished episode (episode downloads carry the parent show's
  // mediaId) flipping a whole-show request, and torrent-complete-but-not-yet-
  // ready cases. "downloaded" is the library's ready state; ongoing shows
  // resolve to "returning"/etc. and stay approved until truly complete.
  const media = await prisma.libraryMedia.findUnique({
    where: { id: libraryMediaId },
    select: { status: true },
  });
  if (media?.status !== "downloaded") return;

  await finalizeRequestAvailable(req, {
    libraryMediaId: req.libraryMediaId,
    urlLibraryMediaId: req.libraryMediaId,
  });
}

/**
 * Book counterpart of notifyRequestAvailable: movies/shows carry a single
 * libraryMediaId whose LibraryMedia.status flips to "downloaded", but a book
 * request is linked by libraryBookId and completion lives on its
 * BookEdition rows instead (see postProcessorBook.ts, the only writer of
 * status: "downloaded" for editions). "Available" fires the first time any
 * edition of the approved book lands — a request captures no ebook/audiobook
 * preference, so either format satisfies it.
 */
export async function notifyBookRequestAvailable(
  libraryBookId: number,
): Promise<void> {
  // Best-effort: this runs inline in post-processing (postProcessorBook.ts),
  // which must complete and leave the edition marked downloaded regardless
  // of whether the request-notify side effect succeeds.
  try {
    const req = await prisma.mediaRequest.findFirst({
      where: { libraryBookId, status: "approved" },
    });
    if (!req) return;

    const downloadedEdition = await prisma.bookEdition.findFirst({
      where: { bookId: libraryBookId, status: "downloaded" },
      select: { id: true },
    });
    if (!downloadedEdition) return;

    await finalizeRequestAvailable(req, {
      libraryMediaId: null,
      urlLibraryMediaId: null,
    });
  } catch (e) {
    console.warn(
      `[mediaRequests] notifyBookRequestAvailable failed for book ${libraryBookId}:`,
      e,
    );
  }
}

/** Shared status flip + notification for both the movie/show and book paths. */
async function finalizeRequestAvailable(
  req: {
    id: number;
    requestedById: string;
    title: string;
    year: number | null;
    posterUrl: string | null;
  },
  opts: { libraryMediaId: number | null; urlLibraryMediaId: number | null },
): Promise<void> {
  await prisma.mediaRequest.update({
    where: { id: req.id },
    data: { status: "available" },
  });

  const requester = await getNotificationTarget(req.requestedById);
  const locale = requester?.locale ?? null;
  const label = requestTitleLabel(req.title, req.year);
  const url =
    opts.urlLibraryMediaId != null
      ? buildLibraryNotificationUrl(opts.urlLibraryMediaId)
      : APP_PATHS.activityRequests;

  await createAndQueueNotification(
    req.requestedById,
    notificationCopy(locale, "requestAvailableTitle"),
    notificationCopy(locale, "requestAvailableBody", { title: label }),
    "request_available",
    url,
    { requestId: req.id, libraryMediaId: opts.libraryMediaId },
    req.posterUrl ?? undefined,
    { preferenceKey: "request_available" },
  );
}
