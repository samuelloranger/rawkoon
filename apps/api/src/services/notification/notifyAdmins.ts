import { getAdminNotificationTargets } from "@rawkoon/api/services/notification/notificationPreferences";
import {
  createAndQueueNotification,
  type CreateNotificationOptions,
} from "@rawkoon/api/workers/notificationService";

export type AdminNotificationCopy = {
  title: string;
  body: string;
  /** Overrides the top-level `type` when it varies per case. */
  type?: string;
  /** Overrides the top-level `url` when it varies per case. */
  url?: string;
};

export async function notifyAdmins(
  opts: {
    build: (locale: string | null) => AdminNotificationCopy;
    preferenceKey: NonNullable<CreateNotificationOptions["preferenceKey"]>;
    type?: string;
    url?: string;
    imageUrl?: string | null;
    metadata?: Record<string, unknown>;
    logTag?: string;
  } & Pick<
    CreateNotificationOptions,
    "groupKey" | "lifecycleKey" | "push" | "updateOnly"
  >,
): Promise<void> {
  const { build, type, url, imageUrl, metadata, logTag, ...options } = opts;
  const admins = await getAdminNotificationTargets();
  // One admin failing (copy build or delivery) must not block the others.
  await Promise.all(
    admins.map(async (admin) => {
      try {
        const msg = build(admin.locale);
        await createAndQueueNotification(
          admin.id,
          msg.title,
          msg.body,
          msg.type ?? type ?? "",
          msg.url ?? url,
          metadata,
          imageUrl ?? undefined,
          { ...options, skipPreferenceCheck: false },
        );
      } catch (e) {
        console.warn(
          `[${logTag ?? "notifyAdmins"}] Failed for user ${admin.id}:`,
          e,
        );
      }
    }),
  );
}
