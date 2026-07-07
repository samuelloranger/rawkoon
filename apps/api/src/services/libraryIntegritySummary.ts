import type { LibraryHealthIssue, LibraryHealthSummary } from "@rawkoon/shared";

export type LibraryIntegrityStatus = "success" | "failed" | "skipped";

export type LibraryIntegrityResult = {
  status: LibraryIntegrityStatus;
  trigger: string;
  started_at: string;
  completed_at: string;
  duration_ms: number;
  summary: LibraryHealthSummary;
  issues: LibraryHealthIssue[];
  warnings: string[];
  error: string | null;
};

export function libraryHealthEmptySummary(): LibraryHealthSummary {
  return {
    downloaded_media_without_files: 0,
    downloaded_episodes_without_files: 0,
    missing_file_paths: 0,
    stale_tmdb_statuses: 0,
    episode_number_mismatches: 0,
    total_issues: 0,
  };
}

export function summarizeLibraryHealthIssues(
  issues: LibraryHealthIssue[],
): LibraryHealthSummary {
  const summary = libraryHealthEmptySummary();
  for (const issue of issues) {
    if (issue.kind === "downloaded_media_without_files") {
      summary.downloaded_media_without_files += 1;
    } else if (issue.kind === "downloaded_episode_without_files") {
      summary.downloaded_episodes_without_files += 1;
    } else if (issue.kind === "missing_file_path") {
      summary.missing_file_paths += 1;
    } else if (issue.kind === "stale_tmdb_status") {
      summary.stale_tmdb_statuses += 1;
    } else if (issue.kind === "episode_number_mismatch") {
      summary.episode_number_mismatches += 1;
    }
  }
  summary.total_issues = issues.length;
  return summary;
}
