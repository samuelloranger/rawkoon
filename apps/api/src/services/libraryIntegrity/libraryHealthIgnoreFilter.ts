import type { LibraryHealthIssue, LibraryHealthSummary } from "@rawkoon/shared";
import { summarizeLibraryHealthIssues } from "@rawkoon/api/services/libraryIntegrity/libraryIntegritySummary";

/** Which thing an issue is about, so the same problem matches across runs. */
export function libraryHealthIssueKey(issue: LibraryHealthIssue): string {
  const ids = [
    issue.media_id,
    issue.episode_id,
    issue.media_file_id,
    issue.book_id,
    issue.book_edition_id,
    issue.book_file_id,
  ].map((id) => (id == null ? "" : String(id)));
  return [issue.kind, ...ids].join(":");
}

/** A run's issues with their keys, minus the ignored ones, and the summary recounted to match. */
export function withoutIgnoredIssues(
  issues: LibraryHealthIssue[],
  ignoredKeys: ReadonlySet<string>,
): {
  issues: LibraryHealthIssue[];
  summary: LibraryHealthSummary;
  ignoredCount: number;
} {
  const kept: LibraryHealthIssue[] = [];
  let ignoredCount = 0;
  for (const issue of issues) {
    const key = libraryHealthIssueKey(issue);
    if (ignoredKeys.has(key)) ignoredCount += 1;
    else kept.push({ ...issue, key });
  }
  return {
    issues: kept,
    summary: summarizeLibraryHealthIssues(kept),
    ignoredCount,
  };
}
