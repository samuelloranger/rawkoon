import type { Job } from "bullmq";

import {
  runProgressSync,
  type ProgressSyncJobData,
} from "@rawkoon/api/services/books/progressAutoSync";

export async function processBookPositionSyncJob(job: Job): Promise<unknown> {
  return runProgressSync(job.data as ProgressSyncJobData);
}
