import { useState } from "react";
import { useTranslation } from "react-i18next";
import type {
  DashboardUpcomingItem,
  TmdbMediaSearchItem,
} from "@rawkoon/shared/types";
import { PosterRail } from "@/pages/_component/PosterRail";
import { useDashboardUpcoming } from "@/pages/_component/useDashboardUpcoming";
import { ExploreCardDetailDialog } from "@/pages/medias/_component/ExploreCardDetailDialog";

/**
 * Short, locale-aware release date for a card ("Sep 12", or "Sep 12, 2027"
 * when it falls outside the current year). ISO dates are day-only, so format
 * in UTC to avoid a timezone shifting the day backwards.
 */
function formatReleaseDate(iso: string, locale: string): string | null {
  const date = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;
  const sameYear = date.getUTCFullYear() === new Date().getUTCFullYear();
  return new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    year: sameYear ? undefined : "numeric",
    timeZone: "UTC",
  }).format(date);
}

/** `S2 E5` when both are known (single-episode days only), else null. */
function episodeLabel(item: DashboardUpcomingItem): string | null {
  if (item.media_type !== "tv") return null;
  if (item.season_number == null || item.episode_number == null) return null;
  return `S${item.season_number} E${item.episode_number}`;
}

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
  const { t, i18n } = useTranslation("common");
  const { data, isLoading, refetch } = useDashboardUpcoming();
  const [selected, setSelected] = useState<TmdbMediaSearchItem | null>(null);

  const items = (data?.items ?? []).map((item) => {
    const date = item.release_date
      ? formatReleaseDate(item.release_date, i18n.language)
      : null;
    const episode = episodeLabel(item);
    return {
      id: String(item.id),
      title: item.title,
      posterUrl: item.poster_url,
      meta:
        date || episode ? (
          <div className="flex items-baseline justify-between gap-1.5">
            {date && (
              <span className="text-[10px] font-medium text-white/70">
                {date}
              </span>
            )}
            {episode && (
              <span className="shrink-0 text-[10px] font-semibold tracking-wide text-primary-300">
                {episode}
              </span>
            )}
          </div>
        ) : undefined,
      ...(item.library_id != null
        ? { libraryId: item.library_id }
        : { onClick: () => setSelected(toTmdbSearchItem(item)) }),
    };
  });

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
