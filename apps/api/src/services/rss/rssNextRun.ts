import { CronExpressionParser } from "cron-parser";
import {
  rssPollCron,
  type RssPollIntervalMinutes,
} from "@rawkoon/shared/utils";
import {
  scheduledTasksQueue,
  SCHEDULED_JOB_NAMES,
} from "@rawkoon/api/services/queueService";
import { loadRssPollInterval } from "@rawkoon/api/services/rss/rssPollSchedule";

/** The scheduler's next poll, or the next tick of the stored interval when it has none queued. */
export async function getNextRssRunAt(
  loadInterval: () => Promise<RssPollIntervalMinutes> = loadRssPollInterval,
): Promise<string> {
  const repeatableJobs = await scheduledTasksQueue.getJobSchedulers();
  const rssJob = repeatableJobs.find(
    (j) => j.name === SCHEDULED_JOB_NAMES.POLL_INDEXER_RSS,
  );
  const bullNext = rssJob?.next ? new Date(rssJob.next) : null;
  const now = new Date();
  if (bullNext && bullNext > now) return bullNext.toISOString();
  const cron = rssPollCron(await loadInterval());
  return CronExpressionParser.parse(cron, { currentDate: now, tz: "UTC" })
    .next()
    .toDate()
    .toISOString();
}
