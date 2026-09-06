import { Navigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { PageLayout } from "@/components/PageLayout";
import { PageHeader } from "@/components/PageHeader";
import { useFeatures } from "@/lib/routing/useFeatures";
import { useListeningStats } from "./useListeningStats";
import {
  ListeningStatsFigures,
  weekBarMaxSeconds,
  weekdayLabel,
} from "./ListeningStatsFigures";
import { formatListeningHours } from "./formatListeningHours";

export function ListeningStatsPage() {
  const { t } = useTranslation("common");
  const features = useFeatures();
  const stats = useListeningStats();

  if (features.isSuccess && !features.data.books_enabled) {
    return <Navigate to="/" />;
  }

  const data = stats.data;
  const maxSeconds = data ? weekBarMaxSeconds(data.week) : 1;

  return (
    <PageLayout>
      <PageHeader title={t("listening.title")} />
      {stats.isError ? (
        <p className="text-sm text-neutral-400">{t("listening.loadError")}</p>
      ) : stats.isLoading || !data ? (
        <p className="text-sm text-neutral-400">{t("books.loading")}</p>
      ) : (
        <div className="space-y-8">
          <ListeningStatsFigures stats={data} />

          <section>
            <h2 className="mb-4 text-sm font-semibold text-neutral-200">
              {t("listening.thisWeek")}
            </h2>
            <div className="flex h-32 items-end gap-2">
              {data.week.map((entry) => {
                const hoursLabel = formatListeningHours(entry.seconds);
                return (
                  <div
                    key={entry.day}
                    className="flex min-w-0 flex-1 flex-col items-center gap-2"
                  >
                    <div
                      role="img"
                      aria-label={`${weekdayLabel(entry.day)} ${hoursLabel}`}
                      className="flex w-full flex-1 items-end"
                    >
                      <div
                        className="w-full rounded-t bg-primary-500/80"
                        style={{
                          height:
                            entry.seconds === 0
                              ? 0
                              : `${(entry.seconds / maxSeconds) * 100}%`,
                        }}
                      />
                    </div>
                    <span className="text-[10px] text-neutral-500">
                      {weekdayLabel(entry.day)}
                    </span>
                  </div>
                );
              })}
            </div>
          </section>

          <section>
            <h2 className="mb-4 text-sm font-semibold text-neutral-200">
              {t("listening.series")}
            </h2>
            {data.series.length === 0 ? (
              <p className="text-sm text-neutral-500">
                {t("listening.emptySeries")}
              </p>
            ) : (
              <ul className="divide-y divide-neutral-800 rounded-xl border border-neutral-800">
                {data.series.map((entry) => (
                  <li key={entry.name} className="px-4 py-3">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <p className="font-medium text-neutral-100">
                        {entry.name}
                      </p>
                      <p className="font-mono text-sm tabular-nums text-neutral-400">
                        {entry.percent}%
                      </p>
                    </div>
                    <p className="mt-1 text-xs text-neutral-500">
                      {t("listening.booksOf", {
                        count: entry.books_finished,
                        total: entry.books_total,
                      })}
                    </p>
                    {entry.current_title ? (
                      <p className="mt-1 truncate text-sm text-neutral-300">
                        {entry.current_title}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </PageLayout>
  );
}
