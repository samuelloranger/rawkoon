import { describe, expect, it } from "bun:test";
import type { LibraryHealthIssue } from "@rawkoon/shared";
import {
  libraryHealthEmptySummary,
  summarizeLibraryHealthIssues,
} from "./libraryIntegritySummary";

describe("summarizeLibraryHealthIssues", () => {
  it("returns zeros for an empty issue list", () => {
    expect(summarizeLibraryHealthIssues([])).toEqual({
      downloaded_media_without_files: 0,
      downloaded_episodes_without_files: 0,
      missing_file_paths: 0,
      stale_tmdb_statuses: 0,
      episode_number_mismatches: 0,
      total_issues: 0,
    });
  });

  it("counts each issue kind and sets total_issues", () => {
    const issues: LibraryHealthIssue[] = [
      {
        kind: "downloaded_media_without_files",
        detail: "a",
      },
      {
        kind: "downloaded_episode_without_files",
        detail: "b",
      },
      {
        kind: "missing_file_path",
        detail: "c",
      },
      {
        kind: "stale_tmdb_status",
        detail: "d",
      },
      {
        kind: "episode_number_mismatch",
        detail: "e",
      },
      {
        kind: "episode_number_mismatch",
        detail: "f",
      },
    ];
    expect(summarizeLibraryHealthIssues(issues)).toEqual({
      downloaded_media_without_files: 1,
      downloaded_episodes_without_files: 1,
      missing_file_paths: 1,
      stale_tmdb_statuses: 1,
      episode_number_mismatches: 2,
      total_issues: 6,
    });
  });
});

describe("libraryHealthEmptySummary", () => {
  it("matches summarizeLibraryHealthIssues([])", () => {
    expect(libraryHealthEmptySummary()).toEqual(
      summarizeLibraryHealthIssues([]),
    );
  });
});
