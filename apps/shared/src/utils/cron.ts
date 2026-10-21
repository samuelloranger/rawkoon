export type CronLocale = "en" | "fr";

/** Matches the schedule the release checks have always run on. */
export const DEFAULT_RELEASE_CHECK_CRON = "0 */6 * * *";

interface FieldSpec {
  min: number;
  max: number;
  names?: readonly string[];
  nameOffset?: number;
}

const MONTH_NAMES = [
  "JAN",
  "FEB",
  "MAR",
  "APR",
  "MAY",
  "JUN",
  "JUL",
  "AUG",
  "SEP",
  "OCT",
  "NOV",
  "DEC",
] as const;
const WEEKDAY_NAMES = [
  "SUN",
  "MON",
  "TUE",
  "WED",
  "THU",
  "FRI",
  "SAT",
] as const;

const FIELDS: readonly FieldSpec[] = [
  { min: 0, max: 59 },
  { min: 0, max: 23 },
  { min: 1, max: 31 },
  { min: 1, max: 12, names: MONTH_NAMES, nameOffset: 1 },
  { min: 0, max: 7, names: WEEKDAY_NAMES, nameOffset: 0 },
];

function parseValue(raw: string, spec: FieldSpec): number | null {
  if (/^\d+$/.test(raw)) {
    const n = Number(raw);
    return n >= spec.min && n <= spec.max ? n : null;
  }
  if (spec.names) {
    const idx = spec.names.indexOf(raw.toUpperCase());
    if (idx >= 0) return idx + (spec.nameOffset ?? 0);
  }
  return null;
}

/** Expands one field to its sorted set of values, or null when it is invalid. */
function expandField(field: string, spec: FieldSpec): number[] | null {
  const values = new Set<number>();
  for (const part of field.split(",")) {
    if (part === "") return null;
    const [range, step, ...extra] = part.split("/");
    if (extra.length > 0 || range === undefined) return null;
    let lo: number;
    let hi: number;
    if (range === "*") {
      lo = spec.min;
      hi = spec.max;
    } else if (range.includes("-")) {
      const [a, b, ...more] = range.split("-");
      if (more.length > 0 || a === undefined || b === undefined) return null;
      const from = parseValue(a, spec);
      const to = parseValue(b, spec);
      if (from === null || to === null || from > to) return null;
      lo = from;
      hi = to;
    } else {
      const v = parseValue(range, spec);
      if (v === null) return null;
      lo = v;
      hi = step === undefined ? v : spec.max;
    }
    let stepN = 1;
    if (step !== undefined) {
      if (!/^\d+$/.test(step)) return null;
      stepN = Number(step);
      if (stepN < 1) return null;
    }
    for (let v = lo; v <= hi; v += stepN) values.add(v);
  }
  return [...values].sort((a, b) => a - b);
}

function splitCron(expr: string): string[] | null {
  const parts = expr.trim().split(/\s+/);
  return parts.length === 5 && parts[0] !== "" ? parts : null;
}

// Longest each month can be (February counts leap years).
const MONTH_DAYS = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/** False when the day-of-month and month fields can never name a real date (e.g. 31 Feb). */
function hasReachableDate(parts: string[]): boolean {
  // With a weekday restriction cron fires on either match, so the date alone can't make it unreachable.
  if (parts[4] !== "*") return true;
  const days = expandField(parts[2]!, FIELDS[2]!);
  const months = expandField(parts[3]!, FIELDS[3]!);
  if (!days || !months) return false;
  return months.some((m) => days.some((d) => d <= MONTH_DAYS[m - 1]!));
}

/** True for a 5-field cron expression (minute hour day month weekday) that can actually fire. */
export function isValidCron(expr: string): boolean {
  const parts = splitCron(expr);
  if (!parts) return false;
  const fieldsOk = parts.every((p, i) => {
    const values = expandField(p, FIELDS[i]!);
    return values !== null && values.length > 0;
  });
  return fieldsOk && hasReachableDate(parts);
}

/** Each release check searches every wanted item, so running it more often only hammers the indexers. */
export const MIN_RELEASE_CHECK_INTERVAL_MINUTES = 15;

/**
 * Smallest gap in minutes between two runs, or null for an invalid cron.
 * Treats the fire times of one day as repeating daily, which can only
 * under-state the gap when day fields skip days, never over-state it.
 */
export function cronMinIntervalMinutes(expr: string): number | null {
  const parts = splitCron(expr);
  if (!parts || !isValidCron(expr)) return null;
  const minutes = expandField(parts[0]!, FIELDS[0]!)!;
  const hours = expandField(parts[1]!, FIELDS[1]!)!;
  const times = hours
    .flatMap((h) => minutes.map((m) => h * 60 + m))
    .sort((a, b) => a - b);
  let min = 1440 - times[times.length - 1]! + times[0]!;
  for (let i = 1; i < times.length; i++) {
    min = Math.min(min, times[i]! - times[i - 1]!);
  }
  return min;
}

export type ReleaseCheckCronResult =
  | { ok: true; cron: string }
  | { ok: false; reason: "invalid" | "tooFrequent" };

/** Normalizes a release-check cron and checks it parses, can fire, and is not too frequent. */
export function validateReleaseCheckCron(expr: string): ReleaseCheckCronResult {
  const cron = normalizeCron(expr);
  if (cron === null) return { ok: false, reason: "invalid" };
  const interval = cronMinIntervalMinutes(cron);
  if (interval === null) return { ok: false, reason: "invalid" };
  if (interval < MIN_RELEASE_CHECK_INTERVAL_MINUTES) {
    return { ok: false, reason: "tooFrequent" };
  }
  return { ok: true, cron };
}

const EN_WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];
const FR_WEEKDAYS = [
  "dimanche",
  "lundi",
  "mardi",
  "mercredi",
  "jeudi",
  "vendredi",
  "samedi",
];

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function formatTime(hour: number, minute: number, locale: CronLocale): string {
  if (locale === "fr") return `${hour} h ${pad2(minute)}`;
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12}:${pad2(minute)} ${hour < 12 ? "AM" : "PM"}`;
}

function joinList(items: string[], locale: CronLocale): string {
  if (items.length <= 1) return items.join("");
  const and = locale === "fr" ? "et" : "and";
  return `${items.slice(0, -1).join(", ")} ${and} ${items[items.length - 1]}`;
}

function ordinal(n: number, locale: CronLocale): string {
  if (locale === "fr") return n === 1 ? "1er" : String(n);
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  const suffix = { 1: "st", 2: "nd", 3: "rd" }[n % 10] ?? "th";
  return `${n}${suffix}`;
}

/** A field that is a single `*`/step over its whole range: returns the step, else null. */
function wholeRangeStep(field: string): number | null {
  if (field === "*") return 1;
  const m = field.match(/^(?:\*|0)\/(\d+)$/);
  return m ? Number(m[1]) : null;
}

function describeMinuteStep(field: string, locale: CronLocale): string | null {
  const m = field.match(/^(\*|\d+|\d+-\d+)\/(\d+)$/);
  if (!m) return null;
  const step = Number(m[2]);
  if (step < 2 || 60 % step !== 0) return null;
  const [startRaw, endRaw] = m[1]!.split("-");
  const start = m[1] === "*" ? 0 : Number(startRaw);
  // A range that stops short of :59 isn't "every N minutes" all hour long.
  if (start > 59 || (endRaw !== undefined && Number(endRaw) !== 59))
    return null;
  const base =
    locale === "fr" ? `toutes les ${step} minutes` : `every ${step} minutes`;
  if (start === 0) return base;
  return locale === "fr"
    ? `${base}, à partir de la minute ${start}`
    : `${base}, starting at minute ${start}`;
}

function describeWeekdays(days: number[], locale: CronLocale): string {
  const set = [...new Set(days.map((d) => d % 7))].sort((a, b) => a - b);
  const names = locale === "fr" ? FR_WEEKDAYS : EN_WEEKDAYS;
  if (set.length === 5 && set.join() === "1,2,3,4,5") {
    return locale === "fr" ? "chaque jour de semaine" : "every weekday";
  }
  // Monday-first order reads naturally; Sunday sorts last.
  const ordered = set.includes(0) ? [...set.filter((d) => d !== 0), 0] : set;
  const contiguous =
    ordered.length >= 3 &&
    ordered.every(
      (d, i) =>
        i === 0 ||
        d === ordered[i - 1]! + 1 ||
        (d === 0 && ordered[i - 1] === 6),
    );
  if (contiguous) {
    const first = names[ordered[0]!]!;
    const last = names[ordered[ordered.length - 1]!]!;
    return locale === "fr"
      ? `du ${first} au ${last}`
      : `every ${first} to ${last}`;
  }
  const list = joinList(
    ordered.map((d) => names[d]!),
    locale,
  );
  return locale === "fr" ? `chaque ${list}` : `every ${list}`;
}

function describeTimes(
  hours: number[],
  minute: number,
  locale: CronLocale,
): string | null {
  if (hours.length === 0 || hours.length > 4) return null;
  return joinList(
    hours.map((h) => formatTime(h, minute, locale)),
    locale,
  );
}

function describeFiveField(parts: string[], locale: CronLocale): string | null {
  const [minF, hourF, domF, monF, dowF] = parts as [
    string,
    string,
    string,
    string,
    string,
  ];
  const fr = locale === "fr";

  if (monF !== "*") return null;

  if (domF === "*" && dowF === "*") {
    // Sub-daily patterns.
    if (hourF === "*") {
      if (minF === "*") return fr ? "chaque minute" : "every minute";
      const stepText = describeMinuteStep(minF, locale);
      if (stepText) return stepText;
      if (/^\d+$/.test(minF)) {
        const minute = Number(minF);
        if (minute === 0) return fr ? "chaque heure" : "every hour";
        return fr
          ? `chaque heure, à la minute ${minute}`
          : `every hour, at minute ${minute}`;
      }
      return null;
    }
    const hourStep = wholeRangeStep(hourF);
    if (hourStep !== null && hourStep > 1 && /^\d+$/.test(minF)) {
      if (24 % hourStep !== 0) return null;
      const minute = Number(minF);
      const base = fr
        ? `toutes les ${hourStep} heures`
        : `every ${hourStep} hours`;
      if (minute === 0) return base;
      return fr
        ? `${base}, à la minute ${minute}`
        : `${base}, at minute ${minute}`;
    }
  }

  // Everything below is anchored to specific times of day.
  if (!/^\d+$/.test(minF)) return null;
  const hours = expandField(hourF, FIELDS[1]!);
  if (!hours || hourF === "*" || /[/]/.test(hourF)) return null;
  const times = describeTimes(hours, Number(minF), locale);
  if (!times) return null;

  if (domF === "*" && dowF === "*") {
    return fr ? `chaque jour à ${times}` : `every day at ${times}`;
  }
  if (domF === "*" && dowF !== "*") {
    const days = expandField(dowF, FIELDS[4]!);
    if (!days) return null;
    return `${describeWeekdays(days, locale)} ${fr ? "à" : "at"} ${times}`;
  }
  if (domF !== "*" && dowF === "*") {
    const days = expandField(domF, FIELDS[2]!);
    if (!days || days.length > 4 || /[/-]/.test(domF)) return null;
    const list = joinList(
      days.map((d) => ordinal(d, locale)),
      locale,
    );
    return fr
      ? `le ${list} de chaque mois à ${times}`
      : `on the ${list} of each month at ${times}`;
  }
  return null;
}

/**
 * Plain-words description of a cron expression ("every 6 hours", "every day
 * at 3:00 AM"), lowercase so it can sit mid-sentence. Returns the raw
 * expression when the pattern is outside the common shapes it understands.
 */
export function describeCron(expr: string, locale: CronLocale): string {
  const trimmed = expr.trim();
  const six = trimmed.split(/\s+/);
  // BullMQ also accepts a leading seconds field; only the plain "every N seconds" shape is worth naming.
  if (six.length === 6 && six.slice(1).every((p) => p === "*")) {
    const step = wholeRangeStep(six[0]!);
    if (step !== null && step > 1 && 60 % step === 0) {
      return locale === "fr"
        ? `toutes les ${step} secondes`
        : `every ${step} seconds`;
    }
    return trimmed;
  }
  if (!isValidCron(trimmed)) return trimmed;
  return describeFiveField(trimmed.split(/\s+/), locale) ?? trimmed;
}

export type ReleaseCheckPreset =
  | { kind: "hourly" }
  | { kind: "every3h" }
  | { kind: "every6h" }
  | { kind: "every12h" }
  | { kind: "daily"; time: string }
  | { kind: "custom" };

const PRESET_CRONS = {
  hourly: "0 * * * *",
  every3h: "0 */3 * * *",
  every6h: DEFAULT_RELEASE_CHECK_CRON,
  every12h: "0 */12 * * *",
} as const;

/** Cron for a daily check at "HH:MM" (24h). */
export function dailyCronAt(time: string): string | null {
  const m = time.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  if (hour > 23 || minute > 59) return null;
  return `${minute} ${hour} * * *`;
}

export function releaseCheckCronFor(
  preset: Exclude<ReleaseCheckPreset, { kind: "custom" | "daily" }>,
): string {
  return PRESET_CRONS[preset.kind];
}

/** Maps a stored cron back to the preset that produced it, else "custom". */
export function detectReleaseCheckPreset(expr: string): ReleaseCheckPreset {
  const normalized = expr.trim().replace(/\s+/g, " ");
  for (const kind of Object.keys(PRESET_CRONS) as Array<
    keyof typeof PRESET_CRONS
  >) {
    if (PRESET_CRONS[kind] === normalized) return { kind };
  }
  const daily = normalized.match(/^(\d{1,2}) (\d{1,2}) \* \* \*$/);
  if (daily) {
    const minute = Number(daily[1]);
    const hour = Number(daily[2]);
    if (minute <= 59 && hour <= 23) {
      return { kind: "daily", time: `${pad2(hour)}:${pad2(minute)}` };
    }
  }
  return { kind: "custom" };
}

/** Trims and collapses whitespace; null when the result is not a valid cron. */
export function normalizeCron(expr: string): string | null {
  const normalized = expr.trim().replace(/\s+/g, " ");
  return isValidCron(normalized) ? normalized : null;
}
