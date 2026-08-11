import { prisma } from "@rawkoon/api/db";
import { createAndQueueNotification } from "@rawkoon/api/workers/notificationService";
import { getAdminUserIds } from "@rawkoon/api/utils/admins";

export async function notifyAdminsLibraryGrabSkipped(
  body: string,
  mediaId: number,
): Promise<void> {
  const adminIds = await getAdminUserIds();
  for (const adminId of adminIds) {
    try {
      await createAndQueueNotification(
        adminId,
        "Library: automatic grab skipped",
        body,
        "library_grab_skipped",
        `/library/${mediaId}`,
      );
    } catch (e) {
      console.warn(
        `[notifyAdminsLibraryGrabSkipped] Failed for user ${adminId}:`,
        e,
      );
    }
  }
}
