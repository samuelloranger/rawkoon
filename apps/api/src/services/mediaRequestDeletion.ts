import { prisma } from "@rawkoon/api/db";

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
