import { useTranslation } from "react-i18next";
import { PosterRail } from "@/pages/_component/PosterRail";
import { useRecentlyAdded } from "@/pages/_component/useRecentlyAdded";

/**
 * "Recently added" poster rail backed by the user's library, ordered by
 * `added_at` desc. Wraps the shared {@link PosterRail}.
 */
export function RecentlyAddedRail() {
  const { t } = useTranslation("common");
  const { data, isLoading } = useRecentlyAdded();

  const items = (data ?? []).map((m) => ({
    id: String(m.id),
    title: m.title,
    posterUrl: m.poster_url,
    libraryId: m.id,
  }));

  return (
    <PosterRail
      title={t("dashboard.home.recentlyAdded")}
      items={items}
      isLoading={isLoading}
      emptyLabel={t("dashboard.home.recentlyAddedEmpty")}
    />
  );
}
