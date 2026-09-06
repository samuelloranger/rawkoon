import { useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Headphones } from "lucide-react";
import { WidgetShell, WidgetHeader } from "@/pages/_component/widgetPrimitives";
import { useFeatures } from "@/lib/routing/useFeatures";
import { useListeningStats } from "./useListeningStats";
import { ListeningStatsFigures } from "./ListeningStatsFigures";

export function ListeningStatsWidget() {
  const { t } = useTranslation("common");
  const navigate = useNavigate();
  const features = useFeatures();
  const stats = useListeningStats();

  if (features.data?.books_enabled === false) return null;
  if (stats.isError) return null;
  if (stats.isLoading && features.isLoading) return null;
  if (!stats.data) return null;

  const activeSeries = stats.data.series.find((entry) => entry.current_title);

  return (
    <WidgetShell>
      <button
        type="button"
        className="focus-ring block w-full text-left"
        onClick={() => void navigate({ to: "/stats" })}
      >
        <WidgetHeader icon={Headphones} title={t("listening.title")} />
        <div className="space-y-3 px-4 py-3">
          <ListeningStatsFigures stats={stats.data} />
          {activeSeries ? (
            <p className="truncate text-sm text-neutral-300">
              {t("listening.seriesLine", {
                name: activeSeries.name,
                percent: activeSeries.percent,
              })}
            </p>
          ) : null}
          {stats.data.since === null ? (
            <p className="text-xs text-neutral-500">{t("listening.hoursHint")}</p>
          ) : null}
        </div>
      </button>
    </WidgetShell>
  );
}
