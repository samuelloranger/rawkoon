import type { Job } from "bullmq";
import { cutClip } from "@rawkoon/api/services/clips/clipPipeline";

export async function processClipJob(job: Job<{ clipId: number }>) {
  await cutClip(job.data.clipId);
}
