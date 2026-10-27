import { useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Clapperboard, ListVideo, Plus } from "lucide-react";
import type { TmdbMediaSearchItem } from "@rawkoon/shared/types";
import { useCurrentUser } from "@/lib/auth/useAuth";
import { useAddTitle } from "@/features/medias/hooks/useAddTitle";
import { useSearchOnAddEnabled } from "@/features/medias/hooks/useSearchOnAddEnabled";
import { AddOnlyMenu } from "@/features/medias/components/AddSearchControls";
import { LibraryStatusChip } from "@/features/medias/components/LibraryStatusChip";

interface TmdbResultCardProps {
  item: TmdbMediaSearchItem;
  /** Opens the details dialog; the rest of the card is the secondary path. */
  onOpenDetails: () => void;
  onAdded: () => void;
}

/** One TMDB search result: Add in one click, Choose release for a manual pick, card body for details. */
export function TmdbResultCard({
  item,
  onOpenDetails,
  onAdded,
}: TmdbResultCardProps) {
  const { t } = useTranslation("common");
  const navigate = useNavigate();
  const { data: user } = useCurrentUser();
  const searchOnAdd = useSearchOnAddEnabled();
  const { addTitle, isAdding } = useAddTitle();

  const libraryId =
    item.library_id != null && item.library_id > 0 ? item.library_id : null;
  const inLibrary = item.already_exists;
  const canAdd = !inLibrary && item.can_add && user?.is_admin === true;

  const openLibraryItem = (search?: { tab: "releases" }) => {
    if (libraryId == null) return;
    void navigate({
      to: "/library/$libraryId",
      params: { libraryId: String(libraryId) },
      search,
    });
  };

  const handleAdd = async (searchOnAddOverride?: false) => {
    const response = await addTitle(item, { searchOnAdd: searchOnAddOverride });
    if (response) onAdded();
  };

  const handleChooseRelease = async () => {
    const response = await addTitle(item, {
      searchOnAdd: false,
      silent: true,
    });
    if (!response) return;
    onAdded();
    void navigate({
      to: "/library/$libraryId",
      params: { libraryId: String(response.item.id) },
      search: { tab: "releases" },
    });
  };

  return (
    <div className="flex flex-col gap-2.5 rounded-xl border border-neutral-700 bg-neutral-900 p-2.5">
      <button
        type="button"
        onClick={libraryId != null ? () => openLibraryItem() : onOpenDetails}
        className="focus-ring flex min-w-0 cursor-pointer gap-2.5 rounded-lg text-left"
      >
        <div className="h-16 w-12 shrink-0 overflow-hidden rounded-md bg-neutral-700">
          {item.poster_url ? (
            <img
              src={item.poster_url}
              alt=""
              loading="lazy"
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center">
              <Clapperboard className="h-5 w-5 text-neutral-500" />
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 text-sm font-medium text-neutral-50">
            {item.title}
          </p>
          <p className="mt-0.5 text-xs text-neutral-400">
            {[
              item.release_year ?? t("medias.unknownYear"),
              item.media_type === "movie"
                ? t("medias.filterMovies")
                : t("medias.filterSeries"),
            ].join(" · ")}
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {inLibrary ? (
              <LibraryStatusChip
                status={item.library_status}
                airingState={item.library_airing_state}
              />
            ) : !item.can_add ? (
              <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-[10px] font-medium text-amber-300">
                {t("medias.tmdb.notConfigured")}
              </span>
            ) : null}
          </div>
        </div>
      </button>

      {canAdd && (
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex items-stretch overflow-hidden rounded-lg bg-primary-600">
            <button
              type="button"
              onClick={() => void handleAdd()}
              disabled={isAdding}
              className="focus-ring inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-neutral-950 transition-[background-color] hover:bg-primary-500 active:bg-primary-700 disabled:opacity-50"
            >
              {isAdding ? (
                <div className="h-3 w-3 animate-spin rounded-full border-2 border-neutral-950 border-t-transparent" />
              ) : (
                <Plus size={12} />
              )}
              {t("medias.tmdb.addAction")}
            </button>
            {searchOnAdd && (
              <AddOnlyMenu
                onAddOnly={() => void handleAdd(false)}
                disabled={isAdding}
                className="border-l border-neutral-950/20 px-1.5 text-neutral-950 transition-[background-color] hover:bg-primary-500"
              />
            )}
          </div>
          <button
            type="button"
            onClick={() => void handleChooseRelease()}
            disabled={isAdding}
            className="focus-ring inline-flex items-center gap-1.5 rounded-lg border border-neutral-600 px-3 py-1.5 text-xs font-medium text-neutral-200 transition-colors hover:bg-neutral-800 disabled:opacity-50"
          >
            <ListVideo size={12} />
            {t("medias.tmdb.chooseRelease")}
          </button>
        </div>
      )}

      {inLibrary && libraryId != null && (
        <div className="flex">
          <button
            type="button"
            onClick={() => openLibraryItem()}
            className="focus-ring inline-flex items-center gap-1.5 rounded-lg border border-neutral-600 px-3 py-1.5 text-xs font-medium text-neutral-200 transition-colors hover:bg-neutral-800"
          >
            {t("medias.tmdb.openInLibrary")}
          </button>
        </div>
      )}
    </div>
  );
}
