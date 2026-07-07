/**
 * Date utilities
 * Centralizes all date operations for consistency
 */

export type MaybeDate = Date | string | number | null | undefined;

function toLocale(locale: string): string {
  return locale === "fr" ? "fr-FR" : "en-US";
}

export function parseDate(input: MaybeDate): Date | null {
  if (!input) return null;
  if (input instanceof Date) return input;
  if (typeof input === "number") return new Date(input);
  if (typeof input !== "string") return null;
  try {
    if (/^\d{4}-\d{2}-\d{2}$/.test(input)) {
      const [year, month, day] = input.split("-").map(Number);
      return new Date(Date.UTC(year, month - 1, day, 12, 0, 0, 0));
    }
    const d =
      input.endsWith("Z") || /[+-]\d{2}:\d{2}$/.test(input)
        ? new Date(input)
        : new Date(`${input}Z`);
    if (isNaN(d.getTime())) return null;
    return d;
  } catch {
    return null;
  }
}

export function formatDate(date: MaybeDate, locale: string = "en"): string {
  const dateObj = parseDate(date);
  if (!dateObj) return "";

  try {
    return dateObj.toLocaleDateString(toLocale(locale), {
      year: "numeric",
      month: "long",
      day: "numeric",
      timeZone: "UTC",
    });
  } catch {
    return "";
  }
}

export function formatTime(date: MaybeDate, locale: string = "en"): string {
  const dateObj = parseDate(date);
  if (!dateObj) return "";
  return dateObj.toLocaleTimeString(toLocale(locale), {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatDateTime(
  input: Date | string | null | undefined,
  language: string = "en",
): string {
  if (!input) return "";
  const date = input instanceof Date ? input : parseDate(input);
  if (!date) return "";

  try {
    return date.toLocaleString(toLocale(language), {
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

export function sameDay(date1: MaybeDate, date2: MaybeDate): boolean {
  const date1Obj = parseDate(date1);
  const date2Obj = parseDate(date2);
  if (!date1Obj || !date2Obj) return false;
  return (
    date1Obj.getFullYear() === date2Obj.getFullYear() &&
    date1Obj.getMonth() === date2Obj.getMonth() &&
    date1Obj.getDate() === date2Obj.getDate()
  );
}

export function sameMonth(date1: MaybeDate, date2: MaybeDate): boolean {
  const date1Obj = parseDate(date1);
  const date2Obj = parseDate(date2);
  if (!date1Obj || !date2Obj) return false;
  return (
    date1Obj.getFullYear() === date2Obj.getFullYear() &&
    date1Obj.getMonth() === date2Obj.getMonth()
  );
}

/**
 * IANA timezone used to interpret calendar-date (`@db.Date`) values. Prisma
 * reads `DATE` columns as UTC midnight, but logically an air/release date is
 * a local calendar date. The zone is taken from the standard `TZ` env var so
 * the backend runtime TZ is the single source of truth; falls back to
 * `America/New_York` when unset (e.g. in the browser).
 */
function readEnvTz(): string | undefined {
  const g = globalThis as {
    process?: { env?: Record<string, string | undefined> };
  };
  return g.process?.env?.TZ;
}

export const APP_DISPLAY_TIMEZONE = readEnvTz() || "America/New_York";

/** Current `YYYY-MM-DD` in the app's display timezone (defaults to NY). */
export function localDateYmd(
  timeZone: string = APP_DISPLAY_TIMEZONE,
  at: Date = new Date(),
): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}

/**
 * Build the `Date` value that Prisma produces for a `@db.Date` column with
 * the given `YYYY-MM-DD` calendar day — a UTC-midnight anchor. Use this when
 * building a cutoff to compare against a DATE column.
 */
export function toUtcMidnightDate(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function parseCalendarDate(input: MaybeDate): Date | null {
  const date = parseDate(input);
  if (!date) return null;
  if (
    date.getUTCHours() === 0 &&
    date.getUTCMinutes() === 0 &&
    date.getUTCSeconds() === 0 &&
    date.getUTCMilliseconds() === 0
  ) {
    return new Date(
      Date.UTC(
        date.getUTCFullYear(),
        date.getUTCMonth(),
        date.getUTCDate(),
        12,
        0,
        0,
        0,
      ),
    );
  }
  return date;
}

/**
 * Short-form date formatter for DATE-only values: `"Apr 20"` (or with year if
 * the value's calendar year differs from today's, in the display timezone).
 * Timezone-safe: `parseDate` anchors YMD strings at UTC noon, and formatting
 * resolves in `timeZone` so the rendered day always matches the stored value.
 */
export function formatDateShort(
  input: MaybeDate,
  locale: string = "en",
  timeZone: string = APP_DISPLAY_TIMEZONE,
): string {
  const date = parseCalendarDate(input);
  if (!date) return "";
  const yearFmt = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
  });
  const includeYear = yearFmt.format(date) !== yearFmt.format(new Date());
  return date.toLocaleDateString(toLocale(locale), {
    month: "short",
    day: "numeric",
    year: includeYear ? "numeric" : undefined,
    timeZone,
  });
}

/** Year from a DATE-only value, interpreted in the app's display timezone. */
export function getDateYear(
  input: MaybeDate,
  timeZone: string = APP_DISPLAY_TIMEZONE,
): number | null {
  const date = parseCalendarDate(input);
  if (!date) return null;
  const ymd = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
  return Number(ymd.slice(0, 4));
}
