import { prisma } from "@rawkoon/api/db";
import { addOrUpdateLibraryFromTmdb } from "@rawkoon/api/services/libraryFromTmdb";
import { createAndQueueNotification } from "@rawkoon/api/workers/notificationService";
import { getGlobalTmdbRegion } from "@rawkoon/api/utils/medias/tmdbRegion";
import { deleteCache } from "@rawkoon/api/services/cache";
import { TMDB_UPCOMING_CACHE_KEY } from "@rawkoon/api/utils/dashboard/tmdbUpcoming";

type CreateOpts = {
  tmdbId: number;
  type: "movie" | "show";
  title: string;
  posterUrl: string | null;
  year: number | null;
  userId: string;
};

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

    const admins = await prisma.user.findMany({
      where: { isAdmin: true },
      select: { id: true },
    });
    await Promise.all(
      admins.map((a) =>
        createAndQueueNotification(
          a.id,
          "New media request",
          `${opts.title} was requested and needs approval.`,
          "request_pending",
          "/requests",
          { requestId: reopened.id },
          opts.posterUrl ?? undefined,
        ),
      ),
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

  const admins = await prisma.user.findMany({
    where: { isAdmin: true },
    select: { id: true },
  });
  await Promise.all(
    admins.map((a) =>
      createAndQueueNotification(
        a.id,
        "New media request",
        `${opts.title} was requested and needs approval.`,
        "request_pending",
        "/requests",
        { requestId: created.id },
        opts.posterUrl ?? undefined,
      ),
    ),
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

  await createAndQueueNotification(
    req.requestedById,
    "Request approved",
    `Your request for ${req.title} was approved.`,
    "request_decided",
    "/requests",
    { requestId: id },
    req.posterUrl ?? undefined,
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

  await createAndQueueNotification(
    req.requestedById,
    "Request denied",
    denyReason
      ? `Your request for ${req.title} was denied: ${denyReason}`
      : `Your request for ${req.title} was denied.`,
    "request_decided",
    "/requests",
    { requestId: id },
    req.posterUrl ?? undefined,
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

  await createAndQueueNotification(
    req.requestedById,
    "Request available",
    `${req.title} finished downloading and is ready to watch.`,
    "request_available",
    "/requests",
    { requestId: req.id },
    req.posterUrl ?? undefined,
  );
}
