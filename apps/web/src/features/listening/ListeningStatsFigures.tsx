import type { BookListeningStats } from "@rawkoon/shared/types";
import { useTranslation } from "react-i18next";
import { formatListeningHours } from "./formatListeningHours";

export function ListeningStatsFigures({
  stats,
}: {
  stats: BookListeningStats;
}) {
  const { t } = useTranslation("common");

  return (
    <div className="grid grid-cols-2 gap-4">
      <div>
        <p className="font-display text-2xl font-semibold tabular-nums text-neutral-50">
          {stats.streak_days}
        </p>
        <p className="mt-0.5 text-xs text-neutral-500">
          {t("listening.streak", { count: stats.streak_days })}
        </p>
      </div>
      <div>
        <p className="font-mono text-2xl font-semibold tabular-nums text-neutral-50">
          {formatListeningHours(stats.week_secs)}
        </p>
        <p className="mt-0.5 text-xs text-neutral-500">
          {t("listening.thisWeek")}
        </p>
      </div>
    </div>
  );
}

export function weekdayLabel(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.toLocaleDateString(undefined, {
    weekday: "short",
    timeZone: "UTC",
  });
}

export function weekBarMaxSeconds(
  week: BookListeningStats["week"],
): number {
  return Math.max(...week.map((entry) => entry.seconds), 1);
}
