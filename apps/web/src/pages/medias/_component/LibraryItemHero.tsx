import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowLeft,
  Bookmark,
  BookmarkCheck,
  Clock,
  ExternalLink,
  Film,
  Play,
  Star,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatRuntimeMinutes } from "@rawkoon/shared/utils";
import { useStatusLabel } from "@/features/medias/hooks/useStatusLabel";
import { libraryStatusPresentation } from "@/utils/libraryStatusPresentation";
import { statusLineParts } from "@/features/medias/lib/itemPageActions";
import { LibraryControlStrip } from "./LibraryControlStrip";
import { LibraryItemActions } from "./LibraryItemActions";
import type {
  LibraryMedia,
  TmdbMediaDetailsResponse,
  MediaRatingsResponse,
  TmdbTrailerResponse,
} from "@rawkoon/shared/types";

type Props = {
  item: LibraryMedia;
  detailsData: TmdbMediaDetailsResponse | null;
  ratingsData: MediaRatingsResponse | null;
  trailerData: TmdbTrailerResponse | null;
  isInWatchlist: boolean;
  watchlistPending: boolean;
  mediaType: "movie" | "tv";
  isAdmin: boolean;
  onBack: () => void;
  onWatchlistToggle: () => void;
  onChooseRelease: () => void;
  onUpgradeSearch: () => void;
  onEditDetails: () => void;
  onSearchReleases: () => void;
  onUpgradeManualSearch: () => void;
  onRemoved: () => void;
};

export function LibraryItemHero({
  item,
  detailsData,
  ratingsData,
  trailerData,
  isInWatchlist,
  watchlistPending,
  mediaType,
  isAdmin,
  onBack,
  onWatchlistToggle,
  onChooseRelease,
  onUpgradeSearch,
  onEditDetails,
  onSearchReleases,
  onUpgradeManualSearch,
  onRemoved,
}: Props) {
  const { t, i18n } = useTranslation("common");
  const [backdropLoaded, setBackdropLoaded] = useState(false);
  const [posterError, setPosterError] = useState(false);

  const backdrop =
    item.backdrop_url ??
    detailsData?.primary_backdrop_url ??
    detailsData?.media_stills?.backdrops?.[0]?.url ??
    null;
  const runtime = formatRuntimeMinutes(detailsData?.runtime ?? null);
  const genres = detailsData?.genres ?? [];
  const voteAverage = detailsData?.vote_average ?? null;
  const rtScore = ratingsData?.rotten_tomatoes ?? null;
  const tmdbUrl = `https://www.themoviedb.org/${mediaType}/${item.tmdb_id}`;
  const p = libraryStatusPresentation(item.status, item.airing_state);
  const statusLabel = useStatusLabel(item, p.labelKey);
  const statusLine = isAdmin
    ? statusLineParts(item, t, i18n.language).join(" · ")
    : "";

  return (
    <div
      className={cn(
        "relative overflow-hidden",
        backdrop ? "min-h-[260px] md:min-h-[340px]" : "min-h-[160px]",
      )}
    >
      {/* Backdrop */}
      {backdrop ? (
        <>
          <div className="absolute inset-0 bg-neutral-900" />
          {/* The LCP element on this route — fetch it ahead of the poster. */}
          <img
            src={backdrop}
            alt=""
            aria-hidden
            decoding="async"
            fetchPriority="high"
            className={cn(
              "absolute inset-0 h-full w-full object-cover transition-opacity duration-700",
              backdropLoaded ? "opacity-100" : "opacity-0",
            )}
            onLoad={() => setBackdropLoaded(true)}
          />
          <div className="absolute inset-0 bg-gradient-to-t from-neutral-900 via-neutral-900/75 to-neutral-900/20" />
          <div className="absolute inset-0 bg-gradient-to-r from-neutral-900/60 to-transparent" />
        </>
      ) : (
        <div className="absolute inset-0 bg-gradient-to-b from-neutral-900 to-neutral-950" />
      )}

      {/* Content */}
      <div className="relative z-10 max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 pt-5 pb-7">
        {/* Back */}
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 text-xs text-white/55 hover:text-white/90 transition-colors mb-5"
        >
          <ArrowLeft size={13} />
          {t("medias.library.pageTitle", "Library")}
        </button>

        {/* Poster + meta row */}
        <div className="flex gap-5 md:gap-7 items-start">
          {/* Poster */}
          <div className="shrink-0">
            {item.poster_url && !posterError ? (
              <img
                src={item.poster_url}
                alt={item.title}
                decoding="async"
                className="w-[86px] md:w-[116px] rounded-xl object-cover shadow-2xl ring-1 ring-white/15"
                onError={() => setPosterError(true)}
              />
            ) : (
              <div className="w-[86px] md:w-[116px] aspect-[2/3] rounded-xl bg-white/8 ring-1 ring-white/12 flex items-center justify-center">
                <Film className="w-7 h-7 text-white/30" />
              </div>
            )}
          </div>

          {/* Meta */}
          <div className="flex-1 min-w-0 flex flex-col gap-2">
            <h1 className="font-display text-xl md:text-2xl lg:text-[1.65rem] font-bold text-white leading-tight">
              {item.title}
            </h1>

            {detailsData?.tagline && (
              <p className="text-sm italic text-white/65 leading-snug">
                {detailsData.tagline}
              </p>
            )}

            {/* Chips */}
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide bg-primary-500/15 text-primary-200 ring-1 ring-primary-500/30">
                {item.type === "show" ? t("medias.series") : t("medias.movie")}
              </span>
              {item.year && (
                <span className="text-xs text-white/55">{item.year}</span>
              )}
              {runtime && (
                <span className="flex items-center gap-0.5 text-xs text-white/55">
                  <Clock size={10} />
                  {runtime}
                </span>
              )}
              {detailsData?.number_of_seasons != null && (
                <span className="flex items-center gap-0.5 text-xs text-white/55">
                  <Film size={10} />
                  {detailsData.number_of_seasons}S ·{" "}
                  {detailsData.number_of_episodes}E
                </span>
              )}
              <span
                className={cn(
                  "px-1.5 py-0.5 rounded-full text-[10px] font-medium",
                  p.badgeClass,
                )}
              >
                {statusLabel}
              </span>
            </div>

            {statusLine && (
              <p className="text-xs text-white/65">{statusLine}</p>
            )}

            {/* Ratings */}
            {(voteAverage != null || rtScore) && (
              <div className="flex flex-wrap items-center gap-3">
                {voteAverage != null && (
                  <span className="flex items-center gap-1 text-sm font-semibold text-amber-400">
                    <Star size={11} className="fill-amber-400" />
                    {voteAverage.toFixed(1)}
                    <span className="text-[10px] font-normal text-white/45">
                      TMDB
                    </span>
                  </span>
                )}
                {rtScore && (
                  <span className="flex items-center gap-1 text-sm">
                    <img
                      src={
                        parseInt(rtScore) >= 60
                          ? "https://www.rottentomatoes.com/assets/pizza-pie/images/icons/tomatometer/tomatometer-fresh.149b5e8adc3.svg"
                          : "https://www.rottentomatoes.com/assets/pizza-pie/images/icons/tomatometer/tomatometer-rotten.f1ef4f02ce3.svg"
                      }
                      alt={
                        parseInt(rtScore) >= 60
                          ? "Rotten Tomatoes: Fresh"
                          : "Rotten Tomatoes: Rotten"
                      }
                      className="h-4 w-4"
                    />
                    <span className="text-white/75 font-semibold">
                      {rtScore}
                    </span>
                  </span>
                )}
              </div>
            )}

            {/* Genres */}
            {genres.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {genres.slice(0, 5).map((g) => (
                  <span
                    key={g.id}
                    className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-white/10 text-white/75 ring-1 ring-white/12"
                  >
                    {g.name}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Admin controls, then the quiet links */}
        <div className="mt-5 flex flex-col gap-3 md:ml-[9rem]">
          {isAdmin && (
            <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:flex-wrap sm:items-center">
              <LibraryItemActions
                item={item}
                isAdmin={isAdmin}
                onChooseRelease={onChooseRelease}
                onUpgradeSearch={onUpgradeSearch}
              />
              <LibraryControlStrip
                item={item}
                onEditDetails={onEditDetails}
                onSearchReleases={onSearchReleases}
                onUpgradeManualSearch={onUpgradeManualSearch}
                onRemoved={onRemoved}
              />
            </div>
          )}
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm text-white/70">
            <button
              type="button"
              onClick={onWatchlistToggle}
              disabled={watchlistPending}
              aria-pressed={isInWatchlist}
              className="focus-ring inline-flex items-center gap-1.5 rounded py-1 transition-colors hover:text-white disabled:opacity-50"
            >
              {isInWatchlist ? (
                <BookmarkCheck size={14} className="text-primary-300" />
              ) : (
                <Bookmark size={14} />
              )}
              {isInWatchlist
                ? t("medias.detail.inWatchlist")
                : t("medias.detail.addToWatchlist")}
            </button>
            {trailerData?.key && (
              <a
                href={`https://www.youtube.com/watch?v=${trailerData.key}`}
                target="_blank"
                rel="noreferrer"
                className="focus-ring inline-flex items-center gap-1.5 rounded py-1 transition-colors hover:text-white"
              >
                <Play size={14} />
                {t("medias.detail.watchTrailer")}
              </a>
            )}
            <a
              href={tmdbUrl}
              target="_blank"
              rel="noreferrer"
              className="focus-ring inline-flex items-center gap-1.5 rounded py-1 transition-colors hover:text-white"
            >
              <ExternalLink size={14} />
              TMDB
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
