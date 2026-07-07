import { useState } from "react";
import { ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { LibraryHealthLog } from "@rawkoon/shared/types";
import { getLibraryHealthRunStatusColor } from "./jobsUtils";

export function LibraryHealthCard({
  latest,
  t,
}: {
  latest: LibraryHealthLog | null;
  t: (key: string, opts?: Record<string, unknown>) => string;
}) {
  const [expanded, setExpanded] = useState(false);
  const issueCount = latest?.summary.total_issues ?? 0;
  const metrics: Array<[string, number]> = latest
    ? [
        [
          "downloaded_media_without_files",
          latest.summary.downloaded_media_without_files,
        ],
        [
          "downloaded_episodes_without_files",
          latest.summary.downloaded_episodes_without_files,
        ],
        ["missing_file_paths", latest.summary.missing_file_paths],
        ["stale_tmdb_statuses", latest.summary.stale_tmdb_statuses],
        ["episode_number_mismatches", latest.summary.episode_number_mismatches],
      ]
    : [];

  const shieldTone =
    latest?.status === "failed"
      ? "text-red-400"
      : latest?.status === "skipped"
        ? "text-amber-400"
        : issueCount > 0
          ? "text-amber-400"
          : "text-green-400";

  return (
    <section className="border border-neutral-700 rounded-lg p-4 bg-neutral-900/50">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <ShieldAlert className={`size-5 mt-0.5 ${shieldTone}`} />
          <div>
            <h3 className="text-sm font-semibold text-neutral-100">
              {t("settings.jobs.libraryHealth.title")}
            </h3>
            <p className="text-sm text-neutral-400 mt-1">
              {latest
                ? t("settings.jobs.libraryHealth.lastRun", {
                    count: issueCount,
                    date: new Date(latest.completed_at).toLocaleString(),
                  })
                : t("settings.jobs.libraryHealth.noRuns")}
            </p>
            {latest?.error && (
              <p className="text-sm text-red-400 mt-2">{latest.error}</p>
            )}
          </div>
        </div>
        {latest && (
          <span
            className={`text-[10px] uppercase font-bold px-2 py-1 rounded-full ${getLibraryHealthRunStatusColor(
              latest.status,
            )}`}
          >
            {t(`settings.jobs.libraryHealth.runStatus.${latest.status}`, {
              defaultValue: latest.status,
            })}
          </span>
        )}
      </div>

      {latest && (
        <div className="mt-4 space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
            {metrics.map(([key, value]) => (
              <div
                key={key}
                className="rounded-md bg-neutral-800 border border-neutral-700 p-3"
              >
                <div className="text-lg font-semibold text-neutral-100">
                  {value}
                </div>
                <div className="text-[11px] text-neutral-400 leading-tight">
                  {t(`settings.jobs.libraryHealth.metrics.${key}`)}
                </div>
              </div>
            ))}
          </div>

          {latest.warnings.length > 0 && (
            <div className="rounded-md bg-amber-900/20 border border-amber-800 p-3 text-xs text-amber-300 space-y-1">
              {latest.warnings.map((warning, i) => (
                <p key={i}>{warning}</p>
              ))}
            </div>
          )}

          {latest.issues.length > 0 && (
            <div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setExpanded(!expanded)}
                className="text-xs text-neutral-300 hover:text-white px-0"
              >
                {expanded
                  ? t("settings.jobs.libraryHealth.hideIssues")
                  : t("settings.jobs.libraryHealth.showIssues", {
                      count: latest.issues.length,
                    })}
              </Button>
              {expanded && (
                <>
                  <div className="mt-2 space-y-1.5 max-h-72 overflow-y-auto">
                    {latest.issues.slice(0, 100).map((issue, index) => (
                      <div
                        key={`${issue.kind}-${issue.media_id ?? ""}-${issue.episode_id ?? ""}-${issue.media_file_id ?? ""}-${index}`}
                        className="rounded-md bg-neutral-800 border border-neutral-700 px-3 py-2 text-xs"
                      >
                        <div className="font-medium text-neutral-100">
                          {t(`settings.jobs.libraryHealth.kinds.${issue.kind}`)}
                        </div>
                        <div className="text-neutral-400 mt-0.5 break-words">
                          {issue.detail}
                        </div>
                      </div>
                    ))}
                  </div>
                  {latest.issues.length > 100 && (
                    <p className="text-xs text-neutral-400 pt-1">
                      Showing 100 of {latest.issues.length} issues.
                    </p>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
