import { useState } from "react";
import { useTranslation } from "react-i18next";
import type {
  DashboardUpcomingItem,
  TmdbMediaSearchItem,
} from "@rawkoon/shared/types";
import { PosterRail } from "@/pages/_component/PosterRail";
import { useDashboardUpcoming } from "@/pages/_component/useDashboardUpcoming";
import { ExploreCardDetailDialog } from "@/pages/medias/_component/ExploreCardDetailDialog";

/** Upcoming item id is `<media_type>-<tmdbId>[-...]`; derive the TMDB id. */
function toTmdbSearchItem(item: DashboardUpcomingItem): TmdbMediaSearchItem {
  const tmdbId = parseInt(item.id.split("-")[1] ?? "", 10);
  const releaseYear = item.release_date
    ? new Date(item.release_date).getFullYear()
    : null;
  return {
    id: item.id,
    tmdb_id: tmdbId,
    media_type: item.media_type,
    title: item.title,
    release_year:
      releaseYear && !Number.isNaN(releaseYear) ? releaseYear : null,
    poster_url: item.poster_url,
    overview: item.overview,
    vote_average: item.vote_average ?? null,
    already_exists: false,
    can_add: true,
    source_id: null,
    library_id: item.library_id,
  };
}

/**
 * "Upcoming releases" poster rail backed by the dashboard upcoming feed.
 * Items already in the library navigate to their detail page; items not yet
 * in the library open the TMDB add/search dialog so they can be added. Wraps
 * the shared {@link PosterRail}.
 */
export function UpcomingRail() {
  const { t } = useTranslation("common");
  const { data, isLoading, refetch } = useDashboardUpcoming();
  const [selected, setSelected] = useState<TmdbMediaSearchItem | null>(null);

  const items = (data?.items ?? []).map((item) => ({
    id: String(item.id),
    title: item.title,
    posterUrl: item.poster_url,
    ...(item.library_id != null
      ? { libraryId: item.library_id }
      : { onClick: () => setSelected(toTmdbSearchItem(item)) }),
  }));

  return (
    <>
      <PosterRail
        title={t("dashboard.home.upcoming")}
        items={items}
        isLoading={isLoading}
        emptyLabel={t("dashboard.home.upcomingEmpty")}
      />
      {selected && (
        <ExploreCardDetailDialog
          item={selected}
          isOpen
          onClose={() => setSelected(null)}
          onAdded={() => {
            setSelected(null);
            void refetch();
          }}
        />
      )}
    </>
  );
}
