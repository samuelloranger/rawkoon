import type { Job } from "bullmq";

import { finishPostProcess } from "@rawkoon/api/services/downloadOutcome";

/**
 * Shim for the post-process queue. The outcome policy lives in
 * services/downloadOutcome.ts so it can be read and tested without BullMQ.
 */
export async function processPostProcessJob(job: Job): Promise<unknown> {
  const { downloadHistoryId } = job.data as { downloadHistoryId?: number };
  if (typeof downloadHistoryId !== "number") {
    throw new Error("post-process job is missing downloadHistoryId");
  }
  return finishPostProcess(downloadHistoryId);
}
