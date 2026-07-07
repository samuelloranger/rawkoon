const RELATIVE_TIME_UNITS: Array<{
  unit: Intl.RelativeTimeFormatUnit;
  seconds: number;
}> = [
  { unit: "year", seconds: 31_536_000 },
  { unit: "month", seconds: 2_592_000 },
  { unit: "week", seconds: 604_800 },
  { unit: "day", seconds: 86_400 },
  { unit: "hour", seconds: 3_600 },
  { unit: "minute", seconds: 60 },
  { unit: "second", seconds: 1 },
];

export function formatRelativeTime(
  value: Date | string | number | null | undefined,
  language: string,
): string | null {
  if (value == null) return null;

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  try {
    const diffSeconds = (date.getTime() - Date.now()) / 1000;
    const absDiff = Math.abs(diffSeconds);

    for (const { unit, seconds } of RELATIVE_TIME_UNITS) {
      if (absDiff >= seconds || unit === "second") {
        const rtf = new Intl.RelativeTimeFormat(language, { numeric: "auto" });
        return rtf.format(Math.round(diffSeconds / seconds), unit);
      }
    }

    return null;
  } catch {
    return null;
  }
}
