import { describe, expect, it } from "vitest";
import {
  defaultItemTab,
  headerActionKind,
  parseItemTab,
  statusLineParts,
} from "./itemPageActions";

describe("parseItemTab", () => {
  it("accepts the four tabs", () => {
    for (const tab of ["info", "similar", "files", "releases"])
      expect(parseItemTab(tab)).toBe(tab);
  });

  it("drops the retired management and search values", () => {
    expect(parseItemTab("management")).toBeUndefined();
    expect(parseItemTab("search")).toBeUndefined();
  });

  it("drops anything it does not know", () => {
    expect(parseItemTab("nope")).toBeUndefined();
    expect(parseItemTab(3)).toBeUndefined();
  });
});

describe("defaultItemTab", () => {
  it("opens a missing item on its releases, for admins only", () => {
    expect(
      defaultItemTab({
        isAdmin: true,
        status: "wanted",
        focusedEpisode: false,
      }),
    ).toBe("releases");
    expect(
      defaultItemTab({
        isAdmin: false,
        status: "wanted",
        focusedEpisode: false,
      }),
    ).toBe("info");
  });

  it("opens every other status on Info", () => {
    for (const status of ["downloaded", "downloading", "upgrading"] as const)
      expect(
        defaultItemTab({ isAdmin: true, status, focusedEpisode: false }),
      ).toBe("info");
  });

  it("opens a season or episode link on Files", () => {
    expect(
      defaultItemTab({ isAdmin: true, status: "wanted", focusedEpisode: true }),
    ).toBe("files");
  });
});

describe("headerActionKind", () => {
  it("follows the status for admins", () => {
    expect(headerActionKind("wanted", true)).toBe("missing");
    expect(headerActionKind("downloading", true)).toBe("downloading");
    expect(headerActionKind("upgrading", true)).toBe("downloading");
    expect(headerActionKind("downloaded", true)).toBe("downloaded");
    expect(headerActionKind("skipped", true)).toBe("skipped");
  });

  it("adds nothing for a downloaded show that is still airing", () => {
    for (const airing of ["returning", "in_production", "planned"] as const)
      expect(headerActionKind("downloaded", true, airing)).toBeNull();
    expect(headerActionKind("downloaded", true, "ended")).toBe("downloaded");
    expect(headerActionKind("downloaded", true, null)).toBe("downloaded");
  });

  it("adds nothing for non-admins", () => {
    expect(headerActionKind("wanted", false)).toBeNull();
    expect(headerActionKind("downloaded", false)).toBeNull();
  });
});

describe("statusLineParts", () => {
  const t = ((key: string, opts?: Record<string, unknown>) =>
    opts ? `${key}:${Object.values(opts).join(",")}` : key) as never;

  it("joins profile, last search and outcome", () => {
    const parts = statusLineParts(
      {
        quality_profile: { id: 1, name: "HD 1080p" },
        last_search_at: new Date(Date.now() - 2 * 3_600_000).toISOString(),
        last_search_outcome: "no_match",
      },
      t,
      "en",
    );
    expect(parts).toEqual([
      "library.statusLine.profile:HD 1080p",
      "library.statusLine.lastSearched:2 hours ago",
      "library.statusLine.outcome.no_match",
    ]);
  });

  it("omits what is unknown", () => {
    expect(
      statusLineParts(
        {
          quality_profile: null,
          last_search_at: null,
          last_search_outcome: null,
        },
        t,
        "en",
      ),
    ).toEqual([]);
  });
});
