import { useTranslation } from "react-i18next";
import { useNavigate } from "@tanstack/react-router";
import { AlertTriangle, Loader2, Search } from "lucide-react";
import { MediaPosterCard } from "@/components/MediaPosterCard";
import { cn } from "@/lib/utils";
import { formatDate } from "@rawkoon/shared/utils/date";
import type { LibraryMedia } from "@rawkoon/shared/types";
import type { ViewMode } from "@/utils/libraryUtils";
import { usePrefetchLibraryItem } from "@/features/medias/hooks/usePrefetchLibraryItem";
import { libraryStatusPresentation } from "@/utils/libraryStatusPresentation";

interface LibraryItemCardProps {
  item: LibraryMedia;
  onMovieSearch?: (id: number) => void;
  movieSearchPending?: boolean;
  viewMode?: ViewMode;
}

export function LibraryItemCard({
  item,
  onMovieSearch,
  movieSearchPending,
  viewMode = "grid",
}: LibraryItemCardProps) {
  const { t, i18n } = useTranslation("common");
  const navigate = useNavigate();
  const prefetchLibraryItem = usePrefetchLibraryItem();

  const p = libraryStatusPresentation(item.status);
  const statusLabel = t(p.labelKey);

  const digitalLabel =
    item.type === "movie" && item.digital_release_date
      ? formatDate(item.digital_release_date, i18n.language)
      : null;

  const ToneIcon =
    p.tone === "attention"
      ? AlertTriangle
      : p.tone === "progress"
        ? Loader2
        : null;

  const cornerBadge = p.showBadge ? (
    <div
      className={cn(
        "flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-semibold",
        p.badgeClass,
      )}
      title={statusLabel}
    >
      {ToneIcon && (
        <ToneIcon
          size={10}
          className={p.tone === "progress" ? "animate-spin" : undefined}
        />
      )}
      {statusLabel}
    </div>
  ) : null;

  return (
    <div
      className={cn(
        "rounded-2xl border border-neutral-700/60 bg-neutral-900 overflow-hidden cursor-pointer group",
        "transition-transform duration-200 hover:-translate-y-0.5 motion-reduce:transform-none",
      )}
      onClick={() =>
        navigate({
          to: "/library/$libraryId",
          params: { libraryId: String(item.id) },
        })
      }
      onMouseEnter={() => prefetchLibraryItem(item)}
      onTouchStart={() => prefetchLibraryItem(item)}
    >
      <MediaPosterCard
        posterUrl={item.poster_url}
        title={item.title}
        status={p.cardStatus}
        statusLabel={statusLabel}
        topRightContent={cornerBadge}
      >
        {viewMode !== "compact" && (
          <div className="pb-2 space-y-1">
            <div className="flex flex-wrap items-center gap-1">
              <span className="rounded-full px-1.5 py-0.5 text-[10px] font-medium bg-neutral-800 text-neutral-400">
                {item.year ?? "—"}
              </span>
              <span
                className={cn(
                  "rounded-full px-1.5 py-0.5 text-[10px] font-medium",
                  p.badgeClass,
                )}
              >
                {statusLabel}
              </span>
            </div>
            {digitalLabel && (
              <p className="text-[9px] text-neutral-400 leading-tight">
                {t("medias.library.digitalRelease", { date: digitalLabel })}
              </p>
            )}
            {p.quickAction === "search" &&
              item.type === "movie" &&
              onMovieSearch && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    onMovieSearch(item.id);
                  }}
                  disabled={movieSearchPending}
                  className="mt-1 inline-flex items-center gap-1 rounded-md bg-primary-600 px-2 py-1 text-[11px] font-semibold text-neutral-950 disabled:opacity-50"
                >
                  {movieSearchPending ? (
                    <Loader2 size={10} className="animate-spin" />
                  ) : (
                    <Search size={10} />
                  )}
                  {t("library.management.searchNow")}
                </button>
              )}
          </div>
        )}
      </MediaPosterCard>
    </div>
  );
}
