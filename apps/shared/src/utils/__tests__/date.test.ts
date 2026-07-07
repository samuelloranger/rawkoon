import { describe, expect, test } from "bun:test";
import {
  APP_DISPLAY_TIMEZONE,
  formatDateShort,
  getDateYear,
  localDateYmd,
  parseDate,
  toUtcMidnightDate,
} from "../date";

describe("date helpers (NY timezone)", () => {
  test("APP_DISPLAY_TIMEZONE follows process.env.TZ, falling back to New York", () => {
    expect(APP_DISPLAY_TIMEZONE).toBe(process.env.TZ || "America/New_York");
  });

  test("parseDate anchors YMD at UTC noon (safe across TZs)", () => {
    const d = parseDate("2026-04-20");
    expect(d?.toISOString()).toBe("2026-04-20T12:00:00.000Z");
  });

  test("toUtcMidnightDate matches Prisma's @db.Date shape", () => {
    expect(toUtcMidnightDate("2026-04-20").toISOString()).toBe(
      "2026-04-20T00:00:00.000Z",
    );
  });

  test("localDateYmd returns YYYY-MM-DD for a given instant in NY", () => {
    // April 20 2026 01:30 UTC = April 19 21:30 EDT
    const at = new Date("2026-04-20T01:30:00.000Z");
    expect(localDateYmd("America/New_York", at)).toBe("2026-04-19");
    // April 20 2026 05:30 UTC = April 20 01:30 EDT
    const afterNyMidnight = new Date("2026-04-20T05:30:00.000Z");
    expect(localDateYmd("America/New_York", afterNyMidnight)).toBe(
      "2026-04-20",
    );
  });

  test("formatDateShort renders the stored calendar day regardless of caller TZ", () => {
    // The DATE '2026-04-20' must always render as April 20 (never shift to 19).
    const out = formatDateShort("2026-04-20", "en");
    expect(out).toMatch(/Apr 20/);
    const outFr = formatDateShort("2026-04-20", "fr");
    expect(outFr).toMatch(/20 avr/);

    // Should also work for UTC midnight ISO dates without shifting
    const outIso = formatDateShort("2026-04-20T00:00:00.000Z", "en");
    expect(outIso).toMatch(/Apr 20/);
    const outYearBoundary = formatDateShort("2027-01-01T00:00:00.000Z", "en");
    expect(outYearBoundary).toMatch(/Jan 1, 2027/);
  });

  test("getDateYear returns the year in the display TZ", () => {
    // 2025-01-01 at UTC is still 2024 in NY, but as a calendar-only DATE value
    // we treat the stored day as-is → year is 2025.
    expect(getDateYear("2025-01-01")).toBe(2025);
    expect(getDateYear("2025-01-01T00:00:00.000Z")).toBe(2025);
    expect(getDateYear(null)).toBeNull();
  });
});
