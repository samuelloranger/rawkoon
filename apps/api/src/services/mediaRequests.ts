import { prisma } from "@rawkoon/api/db";
import { addOrUpdateLibraryFromTmdb } from "@rawkoon/api/services/libraryFromTmdb";
import { createAndQueueNotification } from "@rawkoon/api/workers/notificationService";
import { getGlobalTmdbRegion } from "@rawkoon/api/utils/medias/tmdbRegion";
import { deleteCache } from "@rawkoon/api/services/cache";
import { TMDB_UPCOMING_CACHE_KEY } from "@rawkoon/api/utils/dashboard/tmdbUpcoming";
import { getAdminNotificationTargets } from "@rawkoon/api/services/notificationPreferences";
import { notificationCopy } from "@rawkoon/api/services/notificationCopy";
import { getNotificationTarget } from "@rawkoon/api/services/notificationPreferences";
import { buildLibraryNotificationUrl } from "@rawkoon/shared/utils";

type CreateOpts = {
  tmdbId: number;
  type: "movie" | "show";
  title: string;
  posterUrl: string | null;
  year: number | null;
  userId: string;
};

function requestKindLabel(
  locale: string | null | undefined,
  type: "movie" | "show",
): string {
  return notificationCopy(
    locale,
    type === "movie" ? "mediaKindMovie" : "mediaKindShow",
  );
}

function requestTitleLabel(title: string, year: number | null): string {
  return year ? `${title} (${year})` : title;
}

async function notifyAdminsRequestPending(
  requestId: number,
  type: "movie" | "show",
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
        "/requests",
        { requestId },
        posterUrl ?? undefined,
        { preferenceKey: "request_pending" },
      ),
    ),
  );
}

export async function createRequest(
  opts: CreateOpts,
): Promise<
  | { ok: true; id: number }
  | { ok: false; reason: "exists_in_library" | "already_requested" }
> {
  const inLibrary = await prisma.libraryMedia.findUnique({
    where: { tmdbId: opts.tmdbId },
  });
  if (inLibrary) return { ok: false, reason: "exists_in_library" };

  const dupe = await prisma.mediaRequest.findUnique({
    where: { tmdbId_type: { tmdbId: opts.tmdbId, type: opts.type } },
  });
  if (dupe) {
    if (dupe.status === "pending" || dupe.status === "approved") {
      return { ok: false, reason: "already_requested" };
    }
    // Reopen denied request
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

    return { ok: true, id: reopened.id };
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

  await notifyAdminsRequestPending(
    created.id,
    opts.type,
    opts.title,
    opts.year,
    opts.posterUrl,
  );

  return { ok: true, id: created.id };
}

export async function approveRequest(
  id: number,
  qualityProfileId: number,
  adminId: string,
): Promise<
  | { ok: true }
  | { ok: false; reason: "not_found" | "not_pending" | "invalid_profile" }
> {
  const req = await prisma.mediaRequest.findUnique({ where: { id } });
  if (!req) return { ok: false, reason: "not_found" };
  if (req.status !== "pending") return { ok: false, reason: "not_pending" };

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
    where: { tmdbId: req.tmdbId },
    select: { id: true },
  });

  const region = await getGlobalTmdbRegion();
  const media = await addOrUpdateLibraryFromTmdb({
    tmdb_id: req.tmdbId,
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
  await deleteCache(`${TMDB_UPCOMING_CACHE_KEY}:${region}`);

  const requester = await getNotificationTarget(req.requestedById);
  const locale = requester?.locale ?? null;
  const label = requestTitleLabel(req.title, req.year);

  await createAndQueueNotification(
    req.requestedById,
    notificationCopy(locale, "requestApprovedTitle"),
    notificationCopy(locale, "requestDecidedBodyApproved", { title: label }),
    "request_decided",
    "/requests",
    { requestId: id },
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
    "/requests",
    { requestId: id },
    req.posterUrl ?? undefined,
    { preferenceKey: "request_decided" },
  );

  return { ok: true };
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

  await prisma.mediaRequest.update({
    where: { id: req.id },
    data: { status: "available" },
  });

  const requester = await getNotificationTarget(req.requestedById);
  const locale = requester?.locale ?? null;
  const label = requestTitleLabel(req.title, req.year);
  const url =
    req.libraryMediaId != null
      ? buildLibraryNotificationUrl(req.libraryMediaId)
      : "/requests";

  await createAndQueueNotification(
    req.requestedById,
    notificationCopy(locale, "requestAvailableTitle"),
    notificationCopy(locale, "requestAvailableBody", { title: label }),
    "request_available",
    url,
    { requestId: req.id, libraryMediaId: req.libraryMediaId },
    req.posterUrl ?? undefined,
    { preferenceKey: "request_available" },
  );
}
