import { useTranslation } from "react-i18next";
import { UserCircle } from "lucide-react";
import type {
  TmdbMediaDetailsResponse,
  TmdbCreditsResponse,
  TmdbTrailerResponse,
  TmdbWatchProvidersResponse,
} from "@rawkoon/shared/types";
import { MediaDetailInfoSections } from "./MediaDetailInfoSections";
import { Eyebrow } from "./LibrarySharedUI";

type Props = {
  item: { title: string; tmdb_id: number; type: "movie" | "show" };
  detailsData: TmdbMediaDetailsResponse | null;
  creditsData: TmdbCreditsResponse | null;
  trailerData: TmdbTrailerResponse | null;
  providers: TmdbWatchProvidersResponse | null;
  mediaType: "movie" | "tv";
  isPending: boolean;
};

export function LibraryItemInfoTab({
  item,
  detailsData,
  creditsData,
  trailerData,
  providers,
  mediaType,
  isPending,
}: Props) {
  const { t } = useTranslation("common");

  const hasProviders =
    providers &&
    (providers.streaming.length > 0 ||
      providers.free.length > 0 ||
      providers.rent.length > 0 ||
      providers.buy.length > 0);

  if (isPending && !detailsData) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="h-7 w-7 animate-spin rounded-full border-2 border-neutral-700 border-t-primary-400" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Trailer embed */}
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

      {/* Cast */}
      {creditsData && creditsData.cast.length > 0 && (
        <div>
          <Eyebrow className="mb-2.5">
            {t("medias.detail.cast", "Cast")}
          </Eyebrow>
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
                    className="h-[54px] w-[54px] rounded-full object-cover ring-1 ring-border-strong transition hover:ring-primary-500/40"
                  />
                ) : (
                  <div className="flex h-[54px] w-[54px] items-center justify-center rounded-full bg-neutral-700 ring-1 ring-border-strong transition hover:ring-primary-500/40">
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
          <Eyebrow className="mb-2.5">
            {t("medias.detail.whereToWatch")}
          </Eyebrow>
          <div className="flex flex-col gap-2">
            {[
              { list: providers!.streaming, label: t("medias.detail.stream") },
              { list: providers!.free, label: t("medias.detail.free") },
              { list: providers!.rent, label: t("medias.detail.rent") },
              { list: providers!.buy, label: t("medias.detail.buy") },
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

      {detailsData && (
        <MediaDetailInfoSections
          details={detailsData}
          displayTitle={item.title}
          mediaType={mediaType}
          tmdbId={item.tmdb_id}
        />
      )}
    </div>
  );
}
