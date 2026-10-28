import { describe, expect, it } from "bun:test";
import type { LibraryHealthIssue } from "@rawkoon/shared";
import {
  libraryHealthIssueKey,
  withoutIgnoredIssues,
} from "@rawkoon/api/services/libraryIntegrity/libraryHealthIgnoreFilter";

const durationIssue = (episodeId: number): LibraryHealthIssue => ({
  kind: "episode_duration_mismatch",
  media_id: 10,
  episode_id: episodeId,
  title: "Show",
  detail: `Episode ${episodeId} runs 22 min but TMDB says 44 min`,
});

describe("libraryHealthIssueKey", () => {
  it("names the kind and the ids, not the wording", () => {
    const issue = durationIssue(7);
    expect(libraryHealthIssueKey(issue)).toBe(
      "episode_duration_mismatch:10:7::::",
    );
    expect(libraryHealthIssueKey({ ...issue, detail: "reworded" })).toBe(
      libraryHealthIssueKey(issue),
    );
  });

  it("tells two kinds about the same episode apart", () => {
    const numbering: LibraryHealthIssue = {
      ...durationIssue(7),
      kind: "episode_number_mismatch",
    };
    expect(libraryHealthIssueKey(numbering)).not.toBe(
      libraryHealthIssueKey(durationIssue(7)),
    );
  });
});

describe("withoutIgnoredIssues", () => {
  it("drops ignored issues and recounts the summary", () => {
    const issues = [durationIssue(1), durationIssue(2), durationIssue(3)];
    const ignored = new Set([libraryHealthIssueKey(durationIssue(2))]);

    const result = withoutIgnoredIssues(issues, ignored);

    expect(result.issues.map((issue) => issue.episode_id)).toEqual([1, 3]);
    expect(result.issues[0]?.key).toBe(libraryHealthIssueKey(durationIssue(1)));
    expect(result.summary.total_issues).toBe(2);
    expect(result.summary.episode_duration_mismatches).toBe(2);
    expect(result.ignoredCount).toBe(1);
  });

  it("keeps everything when nothing is ignored", () => {
    const result = withoutIgnoredIssues([durationIssue(1)], new Set());
    expect(result.issues).toHaveLength(1);
    expect(result.ignoredCount).toBe(0);
  });
});
