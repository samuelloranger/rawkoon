import { Prisma } from "@prisma/client";
import { addJob, QUEUE_NAMES } from "@rawkoon/api/services/queueService";

export type ActivityLogType =
  | "integration_updated"
  | "cron_job_ended"
  | "cron_job_skipped"
  | "app_updated"
  | "admin_triggered_job"
  | "notification_push_subscription_saved"
  | "notification_welcome_sent"
  | "notification_unsubscribed"
  | "media_grab";

/**
 * Enqueue an activity log to be processed in the background
 */
export async function logActivity(input: {
  type: ActivityLogType;
  userId?: string | null;
  payload?: Prisma.InputJsonValue;
  createdAt?: Date;
}): Promise<void> {
  try {
    // Add job to BullMQ
    await addJob(
      QUEUE_NAMES.EXPRESS,
      `log:${input.type}`,
      {
        type: input.type,
        userId: input.userId ?? null,
        payload: input.payload,
        createdAt: (input.createdAt ?? new Date()).toISOString(),
      },
      { attempts: 2, removeOnComplete: true },
    );
  } catch (error) {
    console.warn("[ActivityLogs] Failed to enqueue activity log:", error);
  }
}
