import { describe, expect, it } from "bun:test";
import { mergeGroupedMetadata } from "@rawkoon/api/services/notification/groupedNotificationMetadata";

describe("mergeGroupedMetadata", () => {
  const incoming = {
    media_id: 10,
    subject: "Severance",
    code: "S01E02",
    detail: "Half Loop",
    latest_code: "S01E02",
    show: "Severance (2022)",
    group_key: "library_downloaded:10",
  };

  it("counts the second notice and keeps the row fields", () => {
    const previous = { ...incoming, code: "S01E01", latest_code: "S01E01" };

    expect(
      mergeGroupedMetadata(previous, incoming, "library_downloaded:10"),
    ).toEqual({
      group_key: "library_downloaded:10",
      group_count: 2,
      latest_code: "S01E02",
      code: "S01E02",
      show: "Severance (2022)",
      subject: "Severance",
      media_id: 10,
    });
  });

  it("keeps counting on later merges", () => {
    const previous = { group_count: 3, latest_code: "S01E03" };

    expect(
      mergeGroupedMetadata(previous, incoming, "library_downloaded:10")
        .group_count,
    ).toBe(4);
  });

  it("keeps the previous code when the new notice has none", () => {
    const merged = mergeGroupedMetadata(
      { latest_code: "S01E03" },
      { subject: "Severance" },
      "k",
    );

    expect(merged.code).toBe("S01E03");
    expect(merged.latest_code).toBe("S01E03");
  });
});
