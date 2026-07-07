import { afterEach, describe, expect, it, vi } from "vitest";
import { formatRelativeTime } from "./relativeTime";

describe("formatRelativeTime", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("formats past dates in English", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-17T12:00:00.000Z"));

    expect(formatRelativeTime("2026-06-17T10:00:00.000Z", "en")).toBe(
      "2 hours ago",
    );
    expect(formatRelativeTime("2026-06-14T12:00:00.000Z", "en")).toBe(
      "3 days ago",
    );
  });

  it("returns null for missing or invalid dates", () => {
    expect(formatRelativeTime(null, "en")).toBeNull();
    expect(formatRelativeTime("not-a-date", "en")).toBeNull();
  });
});
