import { describe, expect, it } from "bun:test";
import {
  downloadLifecycleKey,
  mergeLifecycleMetadata,
  planLifecycleWrite,
} from "@rawkoon/api/services/notification/notificationLifecycle";

describe("planLifecycleWrite", () => {
  it("writes and pushes an enabled stage that asks to push", () => {
    expect(
      planLifecycleWrite({ hasRow: true, enabled: true, push: true }),
    ).toEqual({
      action: "write",
      push: true,
    });
  });

  it("writes a grab without pushing", () => {
    expect(
      planLifecycleWrite({ hasRow: false, enabled: true, push: false }),
    ).toEqual({
      action: "write",
      push: false,
    });
  });

  it("quietly rewrites an existing row when the stage is turned off", () => {
    expect(
      planLifecycleWrite({ hasRow: true, enabled: false, push: true }),
    ).toEqual({
      action: "write",
      push: false,
    });
  });

  it("skips a turned-off stage with no row to update", () => {
    expect(
      planLifecycleWrite({ hasRow: false, enabled: false, push: true }),
    ).toEqual({
      action: "skip",
      push: false,
    });
  });
});

describe("mergeLifecycleMetadata", () => {
  it("replaces the stage fields but keeps the grab's release", () => {
    const grabbed = {
      lifecycle_key: "download:7",
      subject: "Show",
      code: "S01E02",
      detail: "Show.S01E02.1080p.WEB-GRP",
      release: "Show.S01E02.1080p.WEB-GRP",
    };
    const downloaded = {
      lifecycle_key: "download:7",
      subject: "Show",
      code: "S01E02",
      detail: "Episode name",
    };

    expect(mergeLifecycleMetadata(grabbed, downloaded)).toEqual({
      ...downloaded,
      release: "Show.S01E02.1080p.WEB-GRP",
    });
  });

  it("drops a detail the new stage doesn't send", () => {
    const merged = mergeLifecycleMetadata(
      { detail: "old", release: "R" },
      { subject: "Film" },
    );
    expect(merged).toEqual({ subject: "Film", release: "R" });
  });

  it("names the grab", () => {
    expect(downloadLifecycleKey(42)).toBe("download:42");
  });
});
