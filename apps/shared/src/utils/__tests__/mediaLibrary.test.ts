import { describe, expect, it } from "bun:test";

import { isRemovableDownloadHistoryEntry } from "../media-library";

describe("isRemovableDownloadHistoryEntry", () => {
  it("removes a failed row or one whose import failed outright", () => {
    expect(isRemovableDownloadHistoryEntry({ failed: true })).toBe(true);
    expect(
      isRemovableDownloadHistoryEntry({ failed: false, postProcessError: "x" }),
    ).toBe(true);
  });

  it("keeps a partly imported pack that still has a destination", () => {
    expect(
      isRemovableDownloadHistoryEntry({
        failed: false,
        post_process_error: "S1E10 failed",
        post_process_destination_path: "/lib/a.mkv",
      }),
    ).toBe(false);
  });

  it("keeps a clean row", () => {
    expect(isRemovableDownloadHistoryEntry({ failed: false })).toBe(false);
  });
});
