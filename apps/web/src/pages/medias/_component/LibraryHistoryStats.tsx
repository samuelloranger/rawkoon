import { useTranslation } from "react-i18next";
import { Activity, TrendingUp } from "lucide-react";

import { useDownloadHistoryStats } from "@/features/medias/hooks/useDownloadHistoryStats";
import { cn } from "@/lib/utils";
import { Card } from "./LibrarySharedUI";
import {
  IndexersBarChart,
  GrabsAreaChart,
  GrabStatusDonut,
} from "./LibraryHistoryCharts";

const panelClassName =
  "rounded-lg border border-neutral-700/60 bg-neutral-900/50";

// ─── Stats section components ─────────────────────────────────────────────────

function StatCard({
  label,
  value,
  color,
}: {
  label: string;
  value: string | number;
  color: string;
}) {
  return (
    <Card className={cn(panelClassName, "px-4 py-3")}>
      <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-neutral-400">
        {label}
      </p>
      <p className={cn("mt-1 text-2xl font-bold tabular-nums", color)}>
        {value}
      </p>
    </Card>
  );
}

// ─── Stats section ─────────────────────────────────────────────────────────────

export function StatsSection() {
  const { t } = useTranslation("common");
  const { data, isLoading } = useDownloadHistoryStats();
  const stats = data?.stats;

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div
              key={i}
              className="h-20 rounded-lg bg-neutral-800 animate-pulse"
            />
          ))}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {[0, 1].map((i) => (
            <div
              key={i}
              className="h-28 rounded-lg bg-neutral-800 animate-pulse"
            />
          ))}
        </div>
      </div>
    );
  }
  if (!stats) return null;

  const totalForChart =
    stats.completed_grabs + stats.failed_grabs + stats.active_grabs;

  return (
    <div className="space-y-4">
      {/* Key metrics — 5 cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <StatCard
          label={t("medias.history.statTotal")}
          value={stats.total_grabs.toLocaleString()}
          color="text-neutral-100"
        />
        <StatCard
          label={t("medias.history.statCompleted")}
          value={stats.completed_grabs.toLocaleString()}
          color="text-emerald-400"
        />
        <StatCard
          label={t("medias.history.statFailed")}
          value={stats.failed_grabs.toLocaleString()}
          color={stats.failed_grabs > 0 ? "text-rose-400" : "text-neutral-100"}
        />
        <StatCard
          label={t("medias.history.statActive")}
          value={stats.active_grabs.toLocaleString()}
          color="text-sky-400"
        />
        <StatCard
          label={t("medias.history.statSuccessRate")}
          value={stats.success_rate !== null ? `${stats.success_rate}%` : "—"}
          color={
            stats.success_rate != null && stats.success_rate >= 80
              ? "text-emerald-400"
              : stats.success_rate != null && stats.success_rate >= 50
                ? "text-amber-400"
                : "text-neutral-100"
          }
        />
      </div>

      {/* Charts row */}
      {(stats.top_indexers.length > 0 ||
        stats.grabs_by_day.length > 0 ||
        totalForChart > 0) && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {stats.top_indexers.length > 0 && (
            <Card className={cn(panelClassName, "px-4 py-3 space-y-2")}>
              <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-neutral-400 flex items-center gap-1.5">
                <TrendingUp size={10} />
                {t("medias.history.topIndexers")}
              </p>
              <IndexersBarChart indexers={stats.top_indexers} />
            </Card>
          )}
          {stats.grabs_by_day.length > 0 && (
            <Card className={cn(panelClassName, "px-4 py-3 space-y-2")}>
              <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-neutral-400 flex items-center gap-1.5">
                <Activity size={10} />
                {t("medias.history.last14Days")}
              </p>
              <GrabsAreaChart data={stats.grabs_by_day} />
              <p className="text-[10px] text-neutral-500">
                {stats.grabs_by_day
                  .reduce((s, d) => s + d.count, 0)
                  .toLocaleString()}{" "}
                {t("medias.history.grabsInPeriod")}
              </p>
            </Card>
          )}
          {totalForChart > 0 && (
            <GrabStatusDonut
              completed={stats.completed_grabs}
              failed={stats.failed_grabs}
              active={stats.active_grabs}
            />
          )}
        </div>
      )}
    </div>
  );
}
