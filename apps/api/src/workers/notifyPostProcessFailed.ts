import { prisma } from "@rawkoon/api/db";
import { createAndQueueNotification } from "@rawkoon/api/workers/notificationService";
import { getAdminUserIds } from "@rawkoon/api/utils/admins";

export async function notifyAdminsPostProcessFailed(
  downloadHistoryId: number,
  reason: string,
  mediaId?: number | null,
): Promise<void> {
  const adminIds = await getAdminUserIds();
  const body = `Download #${downloadHistoryId}: ${reason}`;
  for (const adminId of adminIds) {
    try {
      await createAndQueueNotification(
        adminId,
        "Library: post-processing failed",
        body,
        "library_post_process_failed",
        mediaId == null ? "/library" : `/library/${mediaId}`,
      );
    } catch (e) {
      console.warn(
        `[notifyAdminsPostProcessFailed] Failed for user ${adminId}:`,
        e,
      );
    }
  }
}
