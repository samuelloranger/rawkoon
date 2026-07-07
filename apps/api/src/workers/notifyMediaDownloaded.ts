import { prisma } from "@rawkoon/api/db";
import { createAndQueueNotification } from "@rawkoon/api/workers/notificationService";

export async function notifyAdminsMediaDownloaded(
  mediaId: number,
): Promise<void> {
  const media = await prisma.libraryMedia.findUnique({
    where: { id: mediaId },
    select: { title: true, year: true, type: true, posterUrl: true },
  });
  if (!media) return;

  const label = media.year ? `${media.title} (${media.year})` : media.title;
  const title =
    media.type === "show" ? "Show episode downloaded" : "Movie downloaded";
  const body = `${label} is now in your library.`;

  const admins = await prisma.user.findMany({
    where: { isAdmin: true },
    select: { id: true },
  });

  const imageUrl = media.posterUrl ?? undefined;

  for (const u of admins) {
    try {
      await createAndQueueNotification(
        u.id,
        title,
        body,
        "library_media_downloaded",
        "/library",
        undefined,
        imageUrl,
      );
    } catch (e) {
      console.warn(`[notifyAdminsMediaDownloaded] Failed for user ${u.id}:`, e);
    }
  }
}
