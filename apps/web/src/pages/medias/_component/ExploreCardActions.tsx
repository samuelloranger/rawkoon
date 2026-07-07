import { useTranslation } from "react-i18next";
import { Link } from "@tanstack/react-router";
import type {
  TmdbMediaSearchItem,
  TmdbTrailerResponse,
} from "@rawkoon/shared/types";
import {
  Bookmark,
  BookmarkCheck,
  Check,
  ExternalLink,
  Play,
  Plus,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useCurrentUser } from "@/lib/auth/useAuth";
import { RequestButton } from "@/pages/medias/_component/RequestButton";

interface ExploreCardActionsProps {
  item: TmdbMediaSearchItem;
  isInWatchlist: boolean;
  isAddPending: boolean;
  isWatchlistPending: boolean;
  trailerData: TmdbTrailerResponse | null;
  tmdbUrl: string;
  onAdd: () => void;
  onWatchlistToggle: () => void;
  onClose: () => void;
}

export function ExploreCardActions({
  item,
  isInWatchlist,
  isAddPending,
  isWatchlistPending,
  trailerData,
  tmdbUrl,
  onAdd,
  onWatchlistToggle,
  onClose,
}: ExploreCardActionsProps) {
  const { t } = useTranslation("common");
  const { data: currentUser } = useCurrentUser();
  const isAdmin = currentUser?.is_admin ?? false;

  return (
    <div className="flex flex-wrap items-center gap-2 border-y border-neutral-700/60 py-2 mb-3">
      {/* Watchlist toggle */}
      <button
        type="button"
        onClick={onWatchlistToggle}
        disabled={isWatchlistPending}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-[background-color] disabled:opacity-50",
          isInWatchlist
            ? "bg-amber-500/25 hover:bg-amber-500/35 text-amber-400"
            : "bg-amber-500/10 hover:bg-amber-500/20 text-amber-400",
        )}
      >
        {isInWatchlist ? <BookmarkCheck size={12} /> : <Bookmark size={12} />}
        {isInWatchlist
          ? t("medias.detail.inWatchlist", "Watchlist ✓")
          : t("medias.detail.addToWatchlist", "Watchlist")}
      </button>

      {/* TMDB link */}
      <a
        href={tmdbUrl}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1.5 rounded-lg bg-primary-900/30 px-3 py-1.5 text-xs font-medium text-primary-300 transition-[background-color] hover:bg-primary-900/40"
      >
        <ExternalLink size={12} />
        TMDB
      </a>

      {/* Trailer link */}
      {trailerData?.key && (
        <a
          href={`https://www.youtube.com/watch?v=${trailerData.key}`}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 rounded-lg bg-rose-900/30 px-3 py-1.5 text-xs font-medium text-rose-400 transition-[background-color] hover:bg-rose-900/20"
        >
          <Play size={12} />
          {t("medias.detail.watchTrailer")}
        </a>
      )}

      <div className="flex-1" />

      {/* Add to library — admin only */}
      {!item.already_exists && item.can_add && isAdmin && (
        <button
          onClick={onAdd}
          disabled={isAddPending}
          className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-3 py-1.5 text-xs font-semibold text-neutral-950 transition-[background-color] hover:bg-primary-500 active:bg-primary-700 disabled:opacity-50"
        >
          {isAddPending ? (
            <div className="h-3 w-3 animate-spin rounded-full border-2 border-neutral-950 border-t-transparent" />
          ) : (
            <Plus size={12} />
          )}
          {t("medias.detail.addToLibrary")}
        </button>
      )}

      {/* Request — non-admin when not in library */}
      {!item.already_exists && item.can_add && !isAdmin && (
        <RequestButton
          media={{
            tmdb_id: item.tmdb_id,
            type: item.media_type === "tv" ? "show" : "movie",
            title: item.title,
            poster_url: item.poster_url,
            year: item.release_year,
          }}
        />
      )}

      {/* Already in library */}
      {item.already_exists && item.library_id && (
        <Link
          to="/library/$libraryId"
          params={{ libraryId: String(item.library_id) }}
          onClick={onClose}
          className="inline-flex items-center gap-1 rounded-lg bg-emerald-500/10 px-3 py-1.5 text-xs font-medium transition-[background-color] hover:bg-emerald-500/20 text-emerald-400"
        >
          <Check size={12} /> {t("medias.detail.inLibrary")}
        </Link>
      )}
      {item.already_exists && !item.library_id && (
        <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-400">
          <Check size={12} /> {t("medias.detail.inLibrary")}
        </span>
      )}
    </div>
  );
}
