export const getTimezone = (): string => {
  return Bun.env.TZ || "America/New_York";
};

/**
 * Quiet hours: true between 23h and 6h in the configured timezone. Used to
 * suppress the OS push (not in-app/SSE delivery or persistence) overnight.
 */
export function isNightTime(): boolean {
  const tz = getTimezone();
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "numeric",
    hour12: false,
  });
  const currentHour = parseInt(formatter.format(new Date()));
  return currentHour >= 23 || currentHour < 6;
}

export const formatIso = (
  date: string | Date | null | undefined,
): string | null => {
  if (!date) return null;
  if (typeof date === "string") return date;
  return date.toISOString();
};

export const nowUtc = (): string => new Date().toISOString();

export const todayLocal = (): Date => {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: getTimezone(),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = formatter.formatToParts(now);
  const year = parseInt(parts.find((p) => p.type === "year")?.value || "0");
  const month = parseInt(parts.find((p) => p.type === "month")?.value || "0");
  const day = parseInt(parts.find((p) => p.type === "day")?.value || "0");
  return new Date(Date.UTC(year, month - 1, day));
};

export const toLocalDate = (
  utcDateInput: string | Date | null | undefined,
): Date | null => {
  if (!utcDateInput) return null;
  const utcDate =
    utcDateInput instanceof Date ? utcDateInput : new Date(utcDateInput);
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: getTimezone(),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = formatter.formatToParts(utcDate);
  const year = parseInt(parts.find((p) => p.type === "year")?.value || "0");
  const month = parseInt(parts.find((p) => p.type === "month")?.value || "0");
  const day = parseInt(parts.find((p) => p.type === "day")?.value || "0");
  return new Date(Date.UTC(year, month - 1, day));
};

export const utcToTimezone = (date: Date | string | null): Date | null => {
  if (!date) return null;
  const d = typeof date === "string" ? new Date(date) : date;
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: getTimezone(),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = formatter.formatToParts(d);
  const getPart = (type: string) =>
    parts.find((p) => p.type === type)?.value || "0";
  return new Date(
    parseInt(getPart("year")),
    parseInt(getPart("month")) - 1,
    parseInt(getPart("day")),
    parseInt(getPart("hour")),
    parseInt(getPart("minute")),
    parseInt(getPart("second")),
  );
};

export const formatDateInTimezone = (date: Date | string | null): string => {
  if (!date) return "";
  const d = typeof date === "string" ? new Date(date) : date;
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: getTimezone(),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return formatter.format(d);
};

export const getDaysInMonth = (year: number, month: number): number => {
  return new Date(year, month, 0).getDate();
};

/**
 * Get midnight (start of day) for a YYYY-MM-DD string in local timezone.
 */
export const midnightOf = (ymd: string): Date => {
  const [year, month, day] = ymd.split("-").map(Number);
  return new Date(year, month - 1, day, 0, 0, 0, 0);
};

export const addDaysInTz = (date: Date, days: number): Date => {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
};

export const calculatePeriodDates = (
  period: string,
  startDateStr?: string,
): { start: Date; end: Date } => {
  const todayTz = todayLocal();

  let startDate = todayTz;
  if (startDateStr) {
    try {
      const parsed = new Date(startDateStr);
      if (!isNaN(parsed.getTime())) {
        startDate = parsed;
      }
    } catch {
      // Use today if parsing fails
    }
  }

  let startOfPeriod: Date;
  let endOfPeriod: Date;

  if (period === "week") {
    // Start of week (Monday) using UTC methods to be timezone-safe
    const dayOfWeek = startDate.getUTCDay();
    const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    startOfPeriod = new Date(startDate);
    startOfPeriod.setUTCDate(startDate.getUTCDate() + mondayOffset);
    startOfPeriod.setUTCHours(0, 0, 0, 0);

    endOfPeriod = new Date(startOfPeriod);
    endOfPeriod.setUTCDate(startOfPeriod.getUTCDate() + 6);
    endOfPeriod.setUTCHours(23, 59, 59, 999);
  } else if (period === "month") {
    startOfPeriod = new Date(
      Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), 1),
    );
    endOfPeriod = new Date(
      Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth() + 1, 0),
    );
    endOfPeriod.setUTCHours(23, 59, 59, 999);
  } else if (period === "quarter") {
    const quarterStartMonth = Math.floor(startDate.getUTCMonth() / 3) * 3;
    startOfPeriod = new Date(
      Date.UTC(startDate.getUTCFullYear(), quarterStartMonth, 1),
    );
    endOfPeriod = new Date(
      Date.UTC(startDate.getUTCFullYear(), quarterStartMonth + 3, 0),
    );
    endOfPeriod.setUTCHours(23, 59, 59, 999);
  } else if (period === "year") {
    startOfPeriod = new Date(Date.UTC(startDate.getUTCFullYear(), 0, 1));
    endOfPeriod = new Date(Date.UTC(startDate.getUTCFullYear(), 11, 31));
    endOfPeriod.setUTCHours(23, 59, 59, 999);
  } else {
    throw new Error(`Invalid period: ${period}`);
  }

  return { start: startOfPeriod, end: endOfPeriod };
};
