/** Each divides an hour, so the poll ticks stay evenly spaced. */
export const RSS_POLL_INTERVAL_MINUTES = [5, 10, 15, 30, 60] as const;

export type RssPollIntervalMinutes = (typeof RSS_POLL_INTERVAL_MINUTES)[number];

export const DEFAULT_RSS_POLL_INTERVAL_MINUTES: RssPollIntervalMinutes = 15;

export function isRssPollInterval(
  value: unknown,
): value is RssPollIntervalMinutes {
  return (RSS_POLL_INTERVAL_MINUTES as readonly unknown[]).includes(value);
}

/**
 * Cron for an RSS poll every `minutes`. Every interval keeps a tick at :07 so
 * the poll never lands on the :00 release sweeps or the jobs offset around it.
 */
export function rssPollCron(minutes: RssPollIntervalMinutes): string {
  if (minutes === 60) return "7 * * * *";
  return `${7 % minutes}-59/${minutes} * * * *`;
}
