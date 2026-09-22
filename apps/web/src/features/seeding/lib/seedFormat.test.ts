import { describe, expect, it } from "vitest";
import { formatSeedDuration } from "./seedFormat";

const t = (key: string, opts?: Record<string, unknown>) =>
  `${key}:${opts?.count ?? ""}`;

describe("formatSeedDuration", () => {
  it("uses minutes, hours, then days", () => {
    expect(formatSeedDuration(45 * 60, t)).toBe("seeding.duration.minutes:45");
    expect(formatSeedDuration(31 * 3600, t)).toBe("seeding.duration.hours:31");
    expect(formatSeedDuration(3.1 * 86400, t)).toBe(
      "seeding.duration.days:3.1",
    );
  });
  it("never shows zero minutes", () => {
    expect(formatSeedDuration(10, t)).toBe("seeding.duration.minutes:1");
  });
});
