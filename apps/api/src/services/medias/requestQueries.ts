import { prisma } from "@rawkoon/api/db";

/** Newest requests returned to the requests screen. */
const REQUEST_LIST_LIMIT = 500;

export function listMediaRequests(where: { requestedById?: string }) {
  return prisma.mediaRequest.findMany({
    where,
    orderBy: { createdAt: "desc" },
    include: { requestedBy: { select: { id: true, name: true } } },
    take: REQUEST_LIST_LIMIT,
  });
}

export function findTitleRequestState(tmdbId: number, type: "movie" | "show") {
  return Promise.all([
    prisma.libraryMedia.findUnique({ where: { tmdbId } }),
    prisma.mediaRequest.findUnique({
      where: { tmdbId_type: { tmdbId, type } },
    }),
  ]);
}
