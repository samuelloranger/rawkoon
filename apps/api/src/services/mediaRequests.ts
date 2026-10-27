import { createAndQueueNotification } from "@rawkoon/api/workers/notificationService";
import { APP_PATHS } from "@rawkoon/shared/constants";
import { prisma } from "@rawkoon/api/db";
import { addOrUpdateLibraryFromTmdb } from "@rawkoon/api/services/libraryFromTmdb";
import { addBookFromVolume } from "@rawkoon/api/services/books/bookLibrary";
import { getGlobalTmdbRegion } from "@rawkoon/api/utils/medias/tmdbRegion";
import { deleteCache } from "@rawkoon/api/services/cache";
import { queueSearchOnAdd } from "@rawkoon/api/services/searchOnAdd";
import type { SearchSkippedReason } from "@rawkoon/shared/types";
import { invalidateUpcomingCache } from "@rawkoon/api/utils/dashboard/tmdbUpcoming";
import { notificationCopy } from "@rawkoon/api/services/notification/notificationCopy";
import { getNotificationTarget } from "@rawkoon/api/services/notification/notificationPreferences";
import {
  notifyAdminsRequestPending,
  requestTitleLabel,
} from "@rawkoon/api/services/mediaRequestNotifications";

export {
  notifyBookRequestAvailable,
  notifyRequestAvailable,
} from "@rawkoon/api/services/mediaRequestNotifications";

type CreateOpts =
  | {
      type: "movie" | "show";
      tmdbId: number;
      title: string;
      posterUrl: string | null;
      year: number | null;
      userId: string;
      /** The requester is an admin: approve on the spot with the default profile. */
      autoApprove?: boolean;
    }
  | {
      type: "book";
      googleVolumeId: string;
      title: string;
      author: string | null;
      posterUrl: string | null;
      year: number | null;
      userId: string;
    };

type CreateResult =
  | { ok: true; id: number; status: "pending" | "approved" }
  | { ok: false; reason: "exists_in_library" | "already_requested" };

/** The default profile an admin's own request is approved with, if one is set. */
async function defaultQualityProfileId(
  type: "movie" | "show",
): Promise<number | null> {
  const settings = await prisma.mediaSettings.findUnique({ where: { id: 1 } });
  return type === "movie"
    ? (settings?.defaultMovieQualityProfileId ?? null)
    : (settings?.defaultShowQualityProfileId ?? null);
}

/**
 * Approves an admin's own movie/show request right away. Falls back to a normal
 * pending request (admins notified) when no default profile is set or the
 * approval fails.
 */
async function settleMovieShowRequest(
  id: number,
  opts: Extract<CreateOpts, { type: "movie" | "show" }>,
): Promise<CreateResult> {
  if (opts.autoApprove) {
    try {
      const profileId = await defaultQualityProfileId(opts.type);
      if (profileId != null) {
        const approved = await approveRequest(id, profileId, opts.userId);
        if (approved.ok) return { ok: true, id, status: "approved" };
      }
    } catch (error) {
      // The approval may have committed before a later step threw.
      const current = await prisma.mediaRequest.findUnique({ where: { id } });
      if (current?.status === "approved") {
        return { ok: true, id, status: "approved" };
      }
      console.error("[requests] auto-approve failed, left pending:", error);
    }
  }
  await notifyAdminsRequestPending(
    id,
    opts.type,
    opts.title,
    opts.year,
    opts.posterUrl,
  );
  return { ok: true, id, status: "pending" };
}

export async function createRequest(opts: CreateOpts): Promise<CreateResult> {
  if (opts.type === "book") {
    const inLibrary = await prisma.libraryBook.findUnique({
      where: { googleVolumeId: opts.googleVolumeId },
    });
    if (inLibrary) return { ok: false, reason: "exists_in_library" };

    const dupe = await prisma.mediaRequest.findUnique({
      where: { googleVolumeId: opts.googleVolumeId },
    });
    if (dupe) {
      // The title isn't in the library (checked above), so an approved or
      // available request outlived a removal and reopens like a denied one.
      if (dupe.status === "pending") {
        return { ok: false, reason: "already_requested" };
      }
      const reopened = await prisma.mediaRequest.update({
        where: { id: dupe.id },
        data: {
          status: "pending",
          denyReason: null,
          decidedById: null,
          decidedAt: null,
          requestedById: opts.userId,
          createdAt: new Date(),
        },
      });

      await notifyAdminsRequestPending(
        reopened.id,
        opts.type,
        opts.title,
        opts.year,
        opts.posterUrl,
      );

      return { ok: true, id: reopened.id, status: "pending" };
    }

    let created;
    try {
      created = await prisma.mediaRequest.create({
        data: {
          type: opts.type,
          googleVolumeId: opts.googleVolumeId,
          title: opts.title,
          author: opts.author,
          posterUrl: opts.posterUrl,
          year: opts.year,
          requestedById: opts.userId,
          status: "pending",
        },
      });
    } catch (error) {
      if ((error as { code?: string }).code === "P2002") {
        return { ok: false, reason: "already_requested" };
      }
      throw error;
    }

    await notifyAdminsRequestPending(
      created.id,
      opts.type,
      opts.title,
      opts.year,
      opts.posterUrl,
    );

    return { ok: true, id: created.id, status: "pending" };
  }

  const inLibrary = await prisma.libraryMedia.findUnique({
    where: { tmdbId_type: { tmdbId: opts.tmdbId, type: opts.type } },
  });
  if (inLibrary) return { ok: false, reason: "exists_in_library" };

  const dupe = await prisma.mediaRequest.findUnique({
    where: { tmdbId_type: { tmdbId: opts.tmdbId, type: opts.type } },
  });
  if (dupe) {
    // The title isn't in the library (checked above), so an approved or
    // available request outlived a removal and reopens like a denied one.
    if (dupe.status === "pending") {
      return { ok: false, reason: "already_requested" };
    }
    const reopened = await prisma.mediaRequest.update({
      where: { id: dupe.id },
      data: {
        status: "pending",
        denyReason: null,
        decidedById: null,
        decidedAt: null,
        requestedById: opts.userId,
        createdAt: new Date(),
      },
    });

    return settleMovieShowRequest(reopened.id, opts);
  }

  let created;
  try {
    created = await prisma.mediaRequest.create({
      data: {
        tmdbId: opts.tmdbId,
        type: opts.type,
        title: opts.title,
        posterUrl: opts.posterUrl,
        year: opts.year,
        requestedById: opts.userId,
        status: "pending",
      },
    });
  } catch (error) {
    if ((error as { code?: string }).code === "P2002") {
      return { ok: false, reason: "already_requested" };
    }
    throw error;
  }

  return settleMovieShowRequest(created.id, opts);
}

/** What approving a movie or show request did about the new library item. */
interface ApprovedMediaSearch {
  library_media_id: number;
  search_queued: boolean;
  search_skipped_reason: SearchSkippedReason | null;
}

export async function approveRequest(
  id: number,
  qualityProfileId: number,
  adminId: string,
): Promise<
  | ({ ok: true } & Partial<ApprovedMediaSearch>)
  | { ok: false; reason: "not_found" | "not_pending" | "invalid_profile" }
> {
  const req = await prisma.mediaRequest.findUnique({ where: { id } });
  if (!req) return { ok: false, reason: "not_found" };
  if (req.status !== "pending") return { ok: false, reason: "not_pending" };

  if (req.type === "book") {
    return approveBookRequest(req, qualityProfileId, adminId);
  }

  // Validate the profile BEFORE creating the library item, so a stale/deleted
  // profile can't leave the media added (and grabbing) while the request stays
  // pending.
  const profile = await prisma.qualityProfile.findUnique({
    where: { id: qualityProfileId },
    select: { id: true },
  });
  if (!profile) return { ok: false, reason: "invalid_profile" };

  // Preserve the configured TMDB region so release dates match the normal
  // library add flow, and invalidate the same per-region upcoming cache.
  const alreadyInLibrary = await prisma.libraryMedia.findUnique({
    // Movie/show requests always carry a tmdbId; only book requests leave it null.
    where: {
      tmdbId_type: {
        tmdbId: req.tmdbId as number,
        type: req.type as "movie" | "show",
      },
    },
    select: { id: true },
  });

  const region = await getGlobalTmdbRegion();
  const media = await addOrUpdateLibraryFromTmdb({
    tmdb_id: req.tmdbId as number,
    type: req.type as "movie" | "show",
    region,
    qualityProfileId,
  });

  try {
    await prisma.$transaction([
      prisma.libraryMedia.update({
        where: { id: media.id },
        data: { qualityProfileId },
      }),
      prisma.mediaRequest.update({
        where: { id },
        data: {
          status: "approved",
          qualityProfileId,
          libraryMediaId: media.id,
          decidedById: adminId,
          decidedAt: new Date(),
        },
      }),
    ]);
  } catch (error) {
    if (!alreadyInLibrary) {
      await prisma.libraryMedia
        .delete({ where: { id: media.id } })
        .catch(() => {});
    }
    throw error;
  }
  await invalidateUpcomingCache(region);
  const outcome = await queueSearchOnAdd(media);
  const approved = {
    ok: true as const,
    library_media_id: media.id,
    search_queued: outcome.search_queued,
    search_skipped_reason: outcome.search_skipped_reason,
  };

  // Deciding your own request needs no "approved" notification.
  if (adminId === req.requestedById) return approved;

  const requester = await getNotificationTarget(req.requestedById);
  const locale = requester?.locale ?? null;
  const label = requestTitleLabel(req.title, req.year);

  await createAndQueueNotification(
    req.requestedById,
    notificationCopy(locale, "requestApprovedTitle"),
    notificationCopy(locale, "requestDecidedBodyApproved", { title: label }),
    "request_decided",
    APP_PATHS.activityRequests,
    { requestId: id },
    req.posterUrl ?? undefined,
    { preferenceKey: "request_decided" },
  );

  return approved;
}

/**
 * Book counterpart to the movie/show branch of approveRequest: routes through
 * addBookFromVolume — the same add path a person uses from the books search
 * screen — instead of the TMDB grab flow, then links the resulting book back
 * onto the request the way libraryMediaId links a movie/show.
 *
 * The incoming qualityProfileId is a BookQualityProfile id here, not a
 * QualityProfile id — same request-body field, request-type-scoped meaning
 * (see ApproveMediaRequestBody). Design ambiguity, resolved minimally: one
 * profile is applied to both edition kinds (ebook + audiobook) since a
 * request captures no format preference; a "both"-kind profile is the
 * natural real-world choice here.
 */
async function approveBookRequest(
  req: {
    id: number;
    googleVolumeId: string | null;
    title: string;
    year: number | null;
    posterUrl: string | null;
    requestedById: string;
  },
  bookQualityProfileId: number,
  adminId: string,
): Promise<
  | { ok: true }
  | { ok: false; reason: "not_found" | "not_pending" | "invalid_profile" }
> {
  if (!req.googleVolumeId) return { ok: false, reason: "not_found" };

  const profile = await prisma.bookQualityProfile.findUnique({
    where: { id: bookQualityProfileId },
    select: { id: true },
  });
  if (!profile) return { ok: false, reason: "invalid_profile" };

  const result = await addBookFromVolume({
    volumeId: req.googleVolumeId,
    kinds: ["ebook", "audiobook"],
    bookQualityProfileId,
  });
  if (!result.added) {
    // The volume disappearing (or the provider being unavailable) between
    // request and approval isn't any of the three typed reasons above; the
    // closest honest fit is "not_found" so the route still returns a 404
    // rather than silently reporting success.
    return { ok: false, reason: "not_found" };
  }

  await prisma.mediaRequest.update({
    where: { id: req.id },
    data: {
      status: "approved",
      bookQualityProfileId,
      libraryBookId: result.bookId,
      decidedById: adminId,
      decidedAt: new Date(),
    },
  });

  const requester = await getNotificationTarget(req.requestedById);
  const locale = requester?.locale ?? null;
  const label = requestTitleLabel(req.title, req.year);

  await createAndQueueNotification(
    req.requestedById,
    notificationCopy(locale, "requestApprovedTitle"),
    notificationCopy(locale, "requestDecidedBodyApproved", { title: label }),
    "request_decided",
    APP_PATHS.activityRequests,
    { requestId: req.id },
    req.posterUrl ?? undefined,
    { preferenceKey: "request_decided" },
  );

  return { ok: true };
}

export async function denyRequest(
  id: number,
  adminId: string,
  denyReason?: string,
): Promise<{ ok: true } | { ok: false; reason: "not_found" | "not_pending" }> {
  const req = await prisma.mediaRequest.findUnique({ where: { id } });
  if (!req) return { ok: false, reason: "not_found" };
  if (req.status !== "pending") return { ok: false, reason: "not_pending" };

  await prisma.mediaRequest.update({
    where: { id },
    data: {
      status: "denied",
      denyReason: denyReason ?? null,
      decidedById: adminId,
      decidedAt: new Date(),
    },
  });

  const requester = await getNotificationTarget(req.requestedById);
  const locale = requester?.locale ?? null;
  const label = requestTitleLabel(req.title, req.year);

  await createAndQueueNotification(
    req.requestedById,
    notificationCopy(locale, "requestDeniedTitle"),
    denyReason
      ? notificationCopy(locale, "requestDecidedBodyDenied", {
          title: label,
          reason: denyReason,
        })
      : notificationCopy(locale, "requestDecidedBodyDeniedNoReason", {
          title: label,
        }),
    "request_decided",
    APP_PATHS.activityRequests,
    { requestId: id },
    req.posterUrl ?? undefined,
    { preferenceKey: "request_decided" },
  );

  return { ok: true };
}

/** Deletes a library title with its request, so the title can be requested again. */
export async function deleteLibraryMediaWithRequests(
  id: number,
): Promise<void> {
  await prisma.$transaction([
    prisma.mediaRequest.deleteMany({ where: { libraryMediaId: id } }),
    prisma.libraryMedia.delete({ where: { id } }),
  ]);
}

/** Deletes a library book with its request, so the book can be requested again. */
export async function deleteLibraryBookWithRequests(id: number): Promise<void> {
  await prisma.$transaction([
    prisma.mediaRequest.deleteMany({ where: { libraryBookId: id } }),
    prisma.libraryBook.delete({ where: { id } }),
  ]);
}

const DELETABLE_STATUSES = ["pending", "denied"] as const;

/** Deletes a pending or denied request; to a non-admin, someone else's reads as not found. */
export async function deleteRequest(
  id: number,
  userId: string,
  isAdmin: boolean,
): Promise<
  { ok: true } | { ok: false; reason: "not_found" | "not_deletable" }
> {
  const req = await prisma.mediaRequest.findUnique({ where: { id } });
  if (!req || (!isAdmin && req.requestedById !== userId)) {
    return { ok: false, reason: "not_found" };
  }
  if (!(DELETABLE_STATUSES as readonly string[]).includes(req.status)) {
    return { ok: false, reason: "not_deletable" };
  }
  // Conditional so an approval landing after the read isn't deleted.
  const { count } = await prisma.mediaRequest.deleteMany({
    where: { id, status: { in: [...DELETABLE_STATUSES] } },
  });
  if (count > 0) return { ok: true };
  const current = await prisma.mediaRequest.findUnique({ where: { id } });
  return { ok: false, reason: current ? "not_deletable" : "not_found" };
}
