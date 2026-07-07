import { useTranslation } from "react-i18next";

import { useLibraryStats } from "@/features/medias/hooks/useLibraryStats";
import { formatBytes } from "@/lib/utils/format";
import { cn } from "@/lib/utils";
import { Card } from "./LibrarySharedUI";
import type { LibraryStatsResolution } from "@rawkoon/shared/types";

const panelClassName =
  "rounded-lg border border-neutral-700/60 bg-neutral-900/50";

// Order resolutions from lowest to highest for a stable, readable breakdown.
const RESOLUTION_ORDER: LibraryStatsResolution[] = [
  "480p",
  "720p",
  "1080p",
  "4k",
  "unknown",
];

const RESOLUTION_LABELS: Record<LibraryStatsResolution, string> = {
  "480p": "480p",
  "720p": "720p",
  "1080p": "1080p",
  "4k": "4K",
  unknown: "SD / unknown",
};

function StatTile({
  label,
  value,
  color,
}: {
  label: string;
  value: string | number;
  color?: string;
}) {
  return (
    <Card className={cn(panelClassName, "px-4 py-3")}>
      <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-neutral-400">
        {label}
      </p>
      <p
        className={cn(
          "mt-1 text-2xl font-bold tabular-nums",
          color ?? "text-neutral-100",
        )}
      >
        {value}
      </p>
    </Card>
  );
}

function ResolutionBreakdown({
  rows,
}: {
  rows: { resolution: LibraryStatsResolution; size_bytes: number }[];
}) {
  const { t } = useTranslation("common");
  const visible = rows.filter((r) => r.size_bytes > 0);
  if (visible.length === 0) return null;

  const ordered = [...visible].sort(
    (a, b) =>
      RESOLUTION_ORDER.indexOf(a.resolution) -
      RESOLUTION_ORDER.indexOf(b.resolution),
  );
  const max = Math.max(...ordered.map((r) => r.size_bytes), 1);

  return (
    <Card className={cn(panelClassName, "px-4 py-3 space-y-2.5")}>
      <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-neutral-400">
        {t("library.stats.storageByResolution")}
      </p>
      <div className="space-y-2">
        {ordered.map((row) => (
          <div key={row.resolution} className="space-y-1">
            <div className="flex items-baseline justify-between gap-2 text-xs">
              <span className="text-neutral-300">
                {RESOLUTION_LABELS[row.resolution]}
              </span>
              <span className="font-mono tabular-nums text-neutral-100">
                {formatBytes(row.size_bytes)}
              </span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-neutral-800">
              <div
                className="h-full rounded-full bg-sky-500"
                style={{
                  width: `${Math.max((row.size_bytes / max) * 100, 2)}%`,
                }}
              />
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

export function LibraryStatsPanel() {
  const { t } = useTranslation("common");
  const { data: stats, isLoading, isError } = useLibraryStats();

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="h-20 rounded-lg bg-neutral-800 animate-pulse"
            />
          ))}
        </div>
        <div className="h-28 rounded-lg bg-neutral-800 animate-pulse" />
      </div>
    );
  }

  if (isError || !stats) {
    return (
      <p className="text-xs text-neutral-400">{t("library.stats.error")}</p>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <StatTile
          label={t("library.stats.movies")}
          value={stats.total_movies.toLocaleString()}
        />
        <StatTile
          label={t("library.stats.shows")}
          value={stats.total_shows.toLocaleString()}
        />
        <StatTile
          label={t("library.stats.downloaded")}
          value={stats.downloaded.toLocaleString()}
          color="text-emerald-400"
        />
        <StatTile
          label={t("library.stats.wanted")}
          value={stats.wanted.toLocaleString()}
          color={stats.wanted > 0 ? "text-amber-400" : "text-neutral-100"}
        />
        <StatTile
          label={t("library.stats.returningSeries")}
          value={stats.returning_series.toLocaleString()}
          color="text-sky-400"
        />
        <StatTile
          label={t("library.stats.totalStorage")}
          value={formatBytes(stats.storage_used_bytes)}
        />
      </div>

      <ResolutionBreakdown rows={stats.storage_by_resolution} />
    </div>
  );
}
