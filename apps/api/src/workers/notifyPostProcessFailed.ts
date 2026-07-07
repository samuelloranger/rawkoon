import { prisma } from "@rawkoon/api/db";
import { createAndQueueNotification } from "@rawkoon/api/workers/notificationService";

export async function notifyAdminsPostProcessFailed(
  downloadHistoryId: number,
  reason: string,
): Promise<void> {
  const admins = await prisma.user.findMany({
    where: { isAdmin: true },
    select: { id: true },
  });
  const body = `Download #${downloadHistoryId}: ${reason}`;
  for (const u of admins) {
    try {
      await createAndQueueNotification(
        u.id,
        "Library: post-processing failed",
        body,
        "library_post_process_failed",
        "/library",
      );
    } catch (e) {
      console.warn(
        `[notifyAdminsPostProcessFailed] Failed for user ${u.id}:`,
        e,
      );
    }
  }
}
