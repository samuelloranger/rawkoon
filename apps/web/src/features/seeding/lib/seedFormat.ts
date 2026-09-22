type T = (key: string, opts?: Record<string, unknown>) => string;

export function formatSeedDuration(secs: number, t: T): string {
  if (secs < 3600)
    return t("seeding.duration.minutes", {
      count: Math.max(1, Math.round(secs / 60)),
    });
  if (secs < 48 * 3600)
    return t("seeding.duration.hours", { count: Math.round(secs / 3600) });
  return t("seeding.duration.days", {
    count: Math.round((secs / 86400) * 10) / 10,
  });
}

/** Same unit on both sides, so "3 days / 3 days" can never hide the last hour. */
export function meterTimeLabel(
  seededSecs: number,
  targetMins: number,
  t: T,
): string {
  if (targetMins < 96 * 60) {
    return `${Math.floor(seededSecs / 3600)} ${t("seeding.units.hours")} / ${Math.round(targetMins / 60)} ${t("seeding.units.hours")}`;
  }
  return `${(seededSecs / 86400).toFixed(1)} / ${Math.round(targetMins / 1440)} ${t("seeding.units.days")}`;
}
