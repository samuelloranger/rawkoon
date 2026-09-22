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
