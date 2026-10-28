import { APP_PATHS } from "@rawkoon/shared/constants";
import { prisma } from "@rawkoon/api/db";
import { allAiredEpisodesDownloaded } from "@rawkoon/api/services/library/showAvailability";
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

/**
 * Flip an Approved movie or show request to Available and tell the requester.
 * Safe to call after anything that can complete the title: only an Approved
 * request flips, and only once.
 *
 * - Movie: its status is downloaded.
 * - Show: every episode that has already aired is downloaded (see
 *   allAiredEpisodesDownloaded), whatever the show's TMDB airing state and
 *   whatever the show-level status says. A single finished episode, or a
 *   season pack with other aired seasons missing, therefore does not flip it.
 */
export async function notifyRequestAvailable(
  libraryMediaId: number,
): Promise<void> {
  const req = await prisma.mediaRequest.findFirst({
    where: { libraryMediaId, status: "approved" },
  });
  if (!req) return;

  const media = await prisma.libraryMedia.findUnique({
    where: { id: libraryMediaId },
    select: { status: true, type: true },
  });
  if (!media) return;
  const complete =
    media.type === "show"
      ? await allAiredEpisodesDownloaded(libraryMediaId)
      : media.status === "downloaded";
  if (!complete) return;

  await finalizeRequestAvailable(req, {
    libraryMediaId: req.libraryMediaId,
    urlLibraryMediaId: req.libraryMediaId,
  });
}

/**
 * Never-throwing wrapper for callers that mark episodes downloaded outside the
 * download-completion path (post-processing, rescan, TMDB refresh).
 */
export async function recheckRequestAvailable(
  libraryMediaId: number,
): Promise<void> {
  try {
    await notifyRequestAvailable(libraryMediaId);
  } catch (e) {
    console.warn(
      `[mediaRequests] availability re-check failed for media ${libraryMediaId}:`,
      e,
    );
  }
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
  // Claim the flip first so concurrent re-checks notify only once.
  const claimed = await prisma.mediaRequest.updateMany({
    where: { id: req.id, status: "approved" },
    data: { status: "available" },
  });
  if (claimed.count === 0) return;

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
