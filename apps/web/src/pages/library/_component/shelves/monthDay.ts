/** The yearly window the Christmas preset fills in: Nov 1 to Jan 15. */
export const CHRISTMAS_WINDOW = { from: "11-01", to: "01-15" } as const;

/** Most days a month can have; February takes 29 since the window repeats every year. */
export function daysInMonth(month: string): number {
  if (month === "02") return 29;
  return ["04", "06", "09", "11"].includes(month) ? 30 : 31;
}

/**
 * The server's `MM-DD` for a month and a day, either of which may be empty.
 * An empty one defaults to the 1st / January, and the day is clamped to the month.
 */
export function toMonthDay(month: string, day: string): string | null {
  if (!month && !day) return null;
  const m = month || "01";
  const d = Math.min(Number(day || "1"), daysInMonth(m));
  return `${m}-${String(d).padStart(2, "0")}`;
}
