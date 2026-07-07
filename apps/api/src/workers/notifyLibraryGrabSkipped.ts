import { prisma } from "@rawkoon/api/db";
import { createAndQueueNotification } from "@rawkoon/api/workers/notificationService";

export async function notifyAdminsLibraryGrabSkipped(
  body: string,
): Promise<void> {
  const admins = await prisma.user.findMany({
    where: { isAdmin: true },
    select: { id: true },
  });
  for (const u of admins) {
    try {
      await createAndQueueNotification(
        u.id,
        "Library: automatic grab skipped",
        body,
        "library_grab_skipped",
        "/library",
      );
    } catch (e) {
      console.warn(
        `[notifyAdminsLibraryGrabSkipped] Failed for user ${u.id}:`,
        e,
      );
    }
  }
}
