import { describe, expect, test } from "bun:test";
import {
  formatDurationClockSeconds,
  formatDurationCompactSeconds,
  formatDurationMsShort,
  formatEtaSeconds,
  formatListeningHours,
  formatRuntimeMinutes,
} from "../duration";

describe("formatEtaSeconds", () => {
  test("shows seconds under a minute", () => {
    expect(formatEtaSeconds(0)).toBe("0s");
    expect(formatEtaSeconds(30)).toBe("30s");
    expect(formatEtaSeconds(59)).toBe("59s");
  });

  test("uses compact hours and minutes past a minute", () => {
    expect(formatEtaSeconds(61)).toBe("1m");
    expect(formatEtaSeconds(90)).toBe("1m");
    expect(formatEtaSeconds(3600)).toBe("1h 0m");
    expect(formatEtaSeconds(2 * 3600 + 5 * 60)).toBe("2h 5m");
  });

  test("returns null when absent or invalid", () => {
    expect(formatEtaSeconds(null)).toBeNull();
    expect(formatEtaSeconds(undefined)).toBeNull();
    expect(formatEtaSeconds(-1)).toBeNull();
    expect(formatEtaSeconds(Number.NaN)).toBeNull();
  });
});

describe("formatDurationCompactSeconds", () => {
  test("floors by default", () => {
    expect(formatDurationCompactSeconds(2 * 3600 + 5 * 60)).toBe("2h 5m");
    expect(formatDurationCompactSeconds(90)).toBe("1m");
    expect(formatDurationCompactSeconds(30)).toBe("0m");
  });

  test("rounds and carries 60 minutes into the next hour", () => {
    expect(formatDurationCompactSeconds(3590, { rounding: "round" })).toBe(
      "1h 0m",
    );
    expect(formatDurationCompactSeconds(90, { rounding: "round" })).toBe("2m");
  });

  test("hides durations under minMinutes", () => {
    expect(formatDurationCompactSeconds(59, { minMinutes: 1 })).toBeNull();
    expect(formatDurationCompactSeconds(60, { minMinutes: 1 })).toBe("1m");
  });

  test("returns null for empty or invalid input", () => {
    expect(formatDurationCompactSeconds(null)).toBeNull();
    expect(formatDurationCompactSeconds(0)).toBeNull();
    expect(formatDurationCompactSeconds(-5)).toBeNull();
  });
});

describe("formatRuntimeMinutes", () => {
  test("matches compact duration", () => {
    expect(formatRuntimeMinutes(45)).toBe("45m");
    expect(formatRuntimeMinutes(60)).toBe("1h 0m");
    expect(formatRuntimeMinutes(90)).toBe("1h 30m");
    expect(formatRuntimeMinutes(0)).toBeNull();
    expect(formatRuntimeMinutes(null)).toBeNull();
  });
});

describe("formatDurationClockSeconds", () => {
  test("floors to h:mm:ss or m:ss", () => {
    expect(formatDurationClockSeconds(3661)).toBe("1:01:01");
    expect(formatDurationClockSeconds(125)).toBe("2:05");
    expect(formatDurationClockSeconds(59.9)).toBe("0:59");
    expect(formatDurationClockSeconds(0)).toBe("0:00");
    expect(formatDurationClockSeconds(Number.NaN)).toBe("0:00");
  });
});

describe("formatDurationMsShort", () => {
  test("picks ms, seconds, or minutes", () => {
    expect(formatDurationMsShort(12)).toBe("12ms");
    expect(formatDurationMsShort(1500)).toBe("1.5s");
    expect(formatDurationMsShort(90_000)).toBe("1.5m");
  });
});

describe("formatListeningHours", () => {
  test("matches the listening-stats shape", () => {
    expect(formatListeningHours(0)).toBe("0h");
    expect(formatListeningHours(59)).toBe("0h");
    expect(formatListeningHours(20 * 60)).toBe("20m");
    expect(formatListeningHours(3 * 3600 + 20 * 60)).toBe("3h 20m");
  });
});
