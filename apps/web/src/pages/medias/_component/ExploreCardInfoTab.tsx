import { useTranslation } from "react-i18next";
import {
  type TmdbTrailerResponse,
  type TmdbCreditsResponse,
  type TmdbWatchProvidersResponse,
  type TmdbMediaDetailsResponse,
  type MediaModalLibraryEpisodes,
} from "@rawkoon/shared/types";
import { Check, UserCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { MediaDetailInfoSections } from "@/pages/medias/_component/MediaDetailInfoSections";

interface ExploreCardInfoTabProps {
  mediaType: "movie" | "tv";
  tmdbId: number;
  displayTitle: string;
  overview: string | null;
  trailerData: TmdbTrailerResponse | null;
  creditsData: TmdbCreditsResponse | null;
  providers: TmdbWatchProvidersResponse | null;
  detailsData: TmdbMediaDetailsResponse | null;
  libraryEpisodes: MediaModalLibraryEpisodes | null;
  episodesBySeason: Map<number, { episode_number: number }[]>;
}

interface SeasonListProps {
  seasons: TmdbMediaDetailsResponse["seasons"];
  libraryEpisodes: MediaModalLibraryEpisodes | null;
  episodesBySeason: Map<number, { episode_number: number }[]>;
}

function SeasonList({
  seasons,
  libraryEpisodes,
  episodesBySeason,
}: SeasonListProps) {
  const { t } = useTranslation("common");

  return (
    <div>
      <p className="mb-2.5 text-[10px] font-semibold uppercase tracking-widest text-neutral-500">
        {t("medias.detail.seasons", "Seasons")}
      </p>
      <div className="flex flex-col gap-4">
        {seasons.map((s) => {
          const seasonEps = episodesBySeason.get(s.season_number) ?? [];
          const onDisk = libraryEpisodes?.in_library ? seasonEps.length : null;
          const total = s.episode_count;
          const complete =
            onDisk != null && total != null && total > 0 && onDisk === total;
          const hasEpisodeData =
            libraryEpisodes?.in_library && seasonEps.length > 0;

          return (
            <div key={s.season_number}>
              {/* Season header */}
              <div className="mb-1.5 flex items-center justify-between gap-2 border-b pb-1.5 border-neutral-800">
                <span className="text-[13px] font-medium text-neutral-200">
                  {s.name}
                </span>
                {libraryEpisodes?.in_library && onDisk != null ? (
                  <span
                    className={cn(
                      "inline-flex shrink-0 items-center gap-1 text-[11px] tabular-nums",
                      complete
                        ? "font-semibold text-emerald-400"
                        : "text-neutral-400",
                    )}
                    title={t("medias.detail.seasonOnDiskTitle")}
                  >
                    {total != null
                      ? t("medias.detail.seasonOnDiskRatio", {
                          onDisk,
                          total,
                        })
                      : t("medias.detail.seasonOnDiskCount", {
                          count: onDisk,
                        })}
                    {complete && (
                      <Check size={11} className="shrink-0" aria-hidden />
                    )}
                  </span>
                ) : !libraryEpisodes?.in_library && s.episode_count != null ? (
                  <span className="shrink-0 text-[11px] text-neutral-500">
                    {t("medias.detail.seasonEpisodes", {
                      count: s.episode_count,
                    })}
                  </span>
                ) : null}
              </div>

              {/* Episode rows */}
              {hasEpisodeData && (
                <div className="flex flex-col">
                  {seasonEps.map((ep) => (
                    <div
                      key={ep.episode_number}
                      className={cn(
                        "grid grid-cols-[2rem_minmax(0,1fr)_1rem] items-center gap-x-2 rounded px-1 py-1 text-[12px] transition-colors",
                        "text-neutral-300",
                      )}
                    >
                      <span className="shrink-0 tabular-nums text-right font-mono text-[11px] text-neutral-600">
                        {`E${String(ep.episode_number).padStart(2, "0")}`}
                      </span>
                      <span className="min-w-0 truncate leading-snug">
                        {`Episode ${ep.episode_number}`}
                      </span>
                      <Check
                        size={11}
                        className="shrink-0 text-emerald-400"
                        aria-hidden
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function ExploreCardInfoTab({
  mediaType,
  tmdbId,
  displayTitle,
  overview,
  trailerData,
  creditsData,
  providers,
  detailsData,
  libraryEpisodes,
  episodesBySeason,
}: ExploreCardInfoTabProps) {
  const { t } = useTranslation("common");

  const hasProviders =
    providers &&
    (providers.streaming.length > 0 ||
      providers.free.length > 0 ||
      providers.rent.length > 0 ||
      providers.buy.length > 0);

  return (
    <div className="flex flex-col gap-4 pb-4 animate-in fade-in slide-in-from-bottom-1 duration-300 motion-reduce:animate-none">
      {/* Trailer */}
      {trailerData?.key && (
        <div
          className="relative w-full overflow-hidden rounded-xl bg-black"
          style={{ aspectRatio: "16/9" }}
        >
          <iframe
            src={`https://www.youtube.com/embed/${trailerData.key}?rel=0`}
            title={trailerData.name ?? "Trailer"}
            allow="encrypted-media; fullscreen"
            allowFullScreen
            className="absolute inset-0 h-full w-full"
          />
        </div>
      )}

      {/* Overview */}
      {overview && (
        <p className="text-sm leading-relaxed text-neutral-400">{overview}</p>
      )}
      {!overview && (
        <p className="text-sm italic text-neutral-500">
          {t("medias.detail.noOverview")}
        </p>
      )}

      {detailsData && (
        <MediaDetailInfoSections
          details={detailsData}
          displayTitle={displayTitle}
          mediaType={mediaType}
          tmdbId={tmdbId}
        />
      )}

      {/* Cast */}
      {creditsData && creditsData.cast.length > 0 && (
        <div>
          <p className="mb-2.5 text-[10px] font-semibold uppercase tracking-widest text-neutral-500">
            {t("medias.detail.cast", "Cast")}
          </p>
          <div
            className="flex gap-3 overflow-x-auto pb-1"
            style={{ scrollbarWidth: "none" }}
          >
            {creditsData.cast.map((member) => (
              <div
                key={member.id}
                className="flex w-[54px] shrink-0 flex-col items-center gap-1"
              >
                {member.profile_url ? (
                  <img
                    src={member.profile_url}
                    alt={member.name}
                    className="h-[54px] w-[54px] rounded-full object-cover ring-1 ring-neutral-700"
                  />
                ) : (
                  <div className="flex h-[54px] w-[54px] items-center justify-center rounded-full bg-neutral-700">
                    <UserCircle className="w-7 h-7 text-neutral-500" />
                  </div>
                )}
                <p className="line-clamp-2 text-center text-[10px] font-medium leading-tight text-neutral-300">
                  {member.name}
                </p>
                {member.character && (
                  <p className="line-clamp-1 text-center text-[9px] leading-tight text-neutral-500">
                    {member.character}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Where to watch */}
      {hasProviders && (
        <div>
          <p className="mb-2.5 text-[10px] font-semibold uppercase tracking-widest text-neutral-500">
            {t("medias.detail.whereToWatch")}
          </p>
          <div className="flex flex-col gap-2">
            {[
              {
                list: providers!.streaming,
                label: t("medias.detail.stream"),
              },
              {
                list: providers!.free,
                label: t("medias.detail.free"),
              },
              {
                list: providers!.rent,
                label: t("medias.detail.rent"),
              },
              {
                list: providers!.buy,
                label: t("medias.detail.buy"),
              },
            ]
              .filter(({ list }) => list.length > 0)
              .map(({ list, label }) => (
                <div key={label} className="flex items-center gap-2">
                  <span className="w-12 shrink-0 text-[11px] text-neutral-500">
                    {label}
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {list.map((p) => (
                      <img
                        key={p.id}
                        src={p.logo_url}
                        alt={p.name}
                        title={p.name}
                        className="h-7 w-7 rounded-md object-cover"
                      />
                    ))}
                  </div>
                </div>
              ))}
          </div>
        </div>
      )}

      {/* Seasons + Episodes */}
      {mediaType === "tv" && detailsData && detailsData.seasons.length > 0 && (
        <SeasonList
          seasons={detailsData.seasons}
          libraryEpisodes={libraryEpisodes}
          episodesBySeason={episodesBySeason}
        />
      )}
    </div>
  );
}
