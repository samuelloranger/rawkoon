import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useRemoveFromWatchlist } from "@/features/medias/hooks/useRemoveFromWatchlist";
import { useWatchlist } from "@/features/medias/hooks/useWatchlist";
import {
  type WatchlistItem,
  type TmdbMediaSearchItem,
} from "@rawkoon/shared/types";
import { BookmarkX, Clapperboard, Bookmark, Film } from "lucide-react";
import { PageLayout } from "@/components/PageLayout";
import { PageHeader } from "@/components/PageHeader";
import { ExploreCardDetailDialog } from "@/pages/medias/_component/ExploreCardDetailDialog";

function toDialogItem(item: WatchlistItem): TmdbMediaSearchItem {
  return {
    id: String(item.tmdb_id),
    tmdb_id: item.tmdb_id,
    media_type: item.media_type,
    title: item.title,
    release_year: item.release_year,
    poster_url: item.poster_url,
    overview: item.overview,
    vote_average: item.vote_average,
    already_exists: false,
    can_add: true,
    source_id: null,
  };
}

function WatchlistCard({
  item,
  onOpen,
}: {
  item: WatchlistItem;
  onOpen: (item: WatchlistItem) => void;
}) {
  const [imgError, setImgError] = useState(false);
  const removeMutation = useRemoveFromWatchlist();

  const score = item.vote_average ? Math.round(item.vote_average * 10) : null;
  const scoreColor =
    score === null
      ? ""
      : score >= 70
        ? "text-emerald-400"
        : score >= 50
          ? "text-amber-400"
          : "text-rose-400";

  return (
    <div className="group relative aspect-[2/3] w-full overflow-hidden rounded-xl bg-neutral-950 ring-1 ring-primary-500/30">
      {/* Click overlay */}
      <div
        role="button"
        tabIndex={0}
        aria-label={item.title}
        onClick={() => onOpen(item)}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onOpen(item)}
        className="absolute inset-0 z-10 cursor-pointer"
      />

      {/* Poster */}
      {item.poster_url && !imgError ? (
        <img
          src={item.poster_url}
          alt=""
          loading="lazy"
          aria-hidden
          onError={() => setImgError(true)}
          className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 ease-out group-hover:scale-[1.04]"
        />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center">
          <Film className="w-8 h-8 text-neutral-700" />
        </div>
      )}

      {/* Gradient */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-3/4 bg-gradient-to-t from-black via-black/60 to-transparent" />

      {/* Remove button */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          removeMutation.mutate({
            tmdb_id: item.tmdb_id,
            media_type: item.media_type,
          });
        }}
        disabled={removeMutation.isPending}
        aria-label={`Remove ${item.title} from watchlist`}
        className="absolute top-2 right-2 z-20 flex h-6 w-6 items-center justify-center rounded-full bg-neutral-950/70 text-neutral-300 opacity-0 transition-opacity duration-200 group-hover:opacity-100 hover:bg-neutral-950 hover:text-neutral-50 disabled:opacity-40"
      >
        {removeMutation.isPending ? (
          <div className="h-3 w-3 animate-spin rounded-full border-[1.5px] border-neutral-300 border-t-transparent" />
        ) : (
          <BookmarkX size={11} />
        )}
      </button>

      {/* Bottom info */}
      <div className="absolute inset-x-0 bottom-0 z-10 px-2.5 pb-2.5 pt-6 translate-y-[5px] transition-transform duration-300 ease-out group-hover:translate-y-0">
        <p className="text-[10.5px] font-semibold leading-tight text-neutral-50 line-clamp-2">
          {item.title}
        </p>
        <div className="mt-1 flex items-center gap-1 opacity-0 transition-opacity duration-250 group-hover:opacity-100">
          {item.release_year && (
            <span className="text-[9px] tabular-nums text-neutral-400">
              {item.release_year}
            </span>
          )}
          {score !== null && (
            <>
              <span className="text-[8px] text-neutral-600">·</span>
              <span
                className={`text-[9px] font-semibold tabular-nums ${scoreColor}`}
              >
                {score}%
              </span>
            </>
          )}
          <span className="ml-auto text-[8px] font-medium uppercase tracking-widest text-neutral-500">
            {item.media_type === "movie" ? "Film" : "TV"}
          </span>
        </div>
      </div>
    </div>
  );
}

export function WatchlistPage() {
  const { t } = useTranslation("common");
  const { data, isLoading } = useWatchlist();
  const [dialogItem, setDialogItem] = useState<TmdbMediaSearchItem | null>(
    null,
  );

  const items = data?.items ?? [];

  return (
    <PageLayout>
      <PageHeader
        icon={Bookmark}
        iconColor="text-amber-500"
        title={t("medias.watchlist.pageTitle")}
        subtitle={t("medias.watchlist.pageSubtitle")}
      />

      {isLoading ? (
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-6">
          {Array.from({ length: 12 }).map((_, i) => (
            <div
              key={i}
              className="aspect-[2/3] animate-pulse rounded-xl bg-neutral-900"
            />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-4 py-24 text-center">
          <Clapperboard size={40} className="text-neutral-700" />
          <div>
            <p className="text-sm font-medium text-neutral-500">
              {t("medias.watchlist.empty")}
            </p>
            <p className="mt-1 text-xs text-neutral-600">
              {t("medias.watchlist.emptyHint")}
            </p>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-6">
          {items.map((item) => (
            <WatchlistCard
              key={item.id}
              item={item}
              onOpen={(i) => setDialogItem(toDialogItem(i))}
            />
          ))}
        </div>
      )}

      {dialogItem && (
        <ExploreCardDetailDialog
          item={dialogItem}
          isOpen={true}
          onClose={() => setDialogItem(null)}
          onAdded={() => {}}
        />
      )}
    </PageLayout>
  );
}
