import { useMemo, useState } from "react";
import { useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { useLibraryNavigation } from "@/features/medias/context/LibraryNavigationContext";
import { useTranslation } from "react-i18next";
import { FolderOpen, Info, Search, Sparkles } from "lucide-react";
import { LastSearchNote } from "@/features/medias/components/LastSearchNote";
import { SegmentedTabs } from "@/components/ui/segmented-tabs";
import { useLibraryItem } from "@/features/medias/hooks/useLibraryItem";
import { useLibraryEvents } from "@/features/medias/hooks/useLibraryEvents";
import { useAddToWatchlist } from "@/features/medias/hooks/useAddToWatchlist";
import { useMediaModalData } from "@/features/medias/hooks/useMediaModalData";
import { useRemoveFromWatchlist } from "@/features/medias/hooks/useRemoveFromWatchlist";
import { useCurrentUser } from "@/lib/auth/useAuth";
import { LoadError, isNotFoundError } from "@/components/LoadError";
import {
  defaultItemTab,
  type ItemPageTab,
} from "@/features/medias/lib/itemPageActions";
import { LibraryEditDetailsPanel } from "./LibraryEditDetailsPanel";
import { LibraryFilesTab } from "./LibraryFilesTab";
import { SimilarMediasPanel } from "./SimilarMediasPanel";
import { useReleaseSearchContext } from "./useReleaseSearchContext";
import { LibraryItemHero } from "./LibraryItemHero";
import { LibraryItemInfoTab } from "./LibraryItemInfoTab";
import { LibraryItemSearchTab } from "./LibraryItemSearchTab";

export type LibraryItemSearchParams = {
  tab?: ItemPageTab;
  season?: number;
  episode?: number;
};

type PageTab = ItemPageTab;

export function LibraryItemPage() {
  const { libraryId } = useParams({ from: "/library/$libraryId" });
  const navigate = useNavigate({ from: "/library/$libraryId" });
  const { librarySearch } = useLibraryNavigation();
  const goBack = () =>
    navigate({ to: "/library", search: librarySearch ?? {} });
  const { t, i18n } = useTranslation("common");
  const search = useSearch({
    from: "/library/$libraryId",
  }) as LibraryItemSearchParams;

  useLibraryEvents();

  const { data: currentUser } = useCurrentUser();
  const isAdmin = currentUser?.is_admin ?? false;

  const id = parseInt(libraryId, 10);
  const {
    data: itemData,
    isLoading: itemLoading,
    error: itemError,
    refetch: refetchItem,
    isRefetching: itemRefetching,
  } = useLibraryItem(id);
  const item = itemData?.item ?? null;

  const mediaType = item ? (item.type === "show" ? "tv" : "movie") : "movie";

  const { data: modalData, isPending: modalPending } = useMediaModalData(
    mediaType,
    item?.tmdb_id ?? 0,
    { enabled: !!item },
    i18n.language,
  );

  const [editOpen, setEditOpen] = useState(false);
  const addToWatchlist = useAddToWatchlist();
  const removeFromWatchlist = useRemoveFromWatchlist();

  const {
    episodeSearchCtx,
    seasonSearchCtx,
    upgradeSearchMode,
    setEpisodeSearchCtx,
    setSeasonSearchCtx,
    setUpgradeSearchMode,
    chooseRelease,
    searchUpgrade,
  } = useReleaseSearchContext(() => setActiveTab("releases"));

  const detailsData = modalData?.details ?? null;
  const ratingsData = modalData?.ratings ?? null;
  const creditsData = modalData?.credits ?? null;
  const trailerData = modalData?.trailer ?? null;
  const providers = modalData?.providers ?? null;
  const isInWatchlist = modalData?.watchlist_status ?? false;

  const overview = detailsData?.overview ?? item?.overview ?? null;
  const voteAverage = detailsData?.vote_average ?? null;

  const tabs = useMemo(() => {
    const result: { key: PageTab; label: string; icon: typeof Info }[] = [
      { key: "info", label: t("medias.detail.tabInfo", "Info"), icon: Info },
    ];
    if (item?.tmdb_id)
      result.push({
        key: "similar",
        label: t("medias.detail.tabSimilar", "Similar"),
        icon: Sparkles,
      });
    // Files and Releases are admin-only surfaces (grab/search/delete/quality).
    if (isAdmin) {
      result.push({
        key: "files",
        label: t("medias.detail.tabFiles", "Files"),
        icon: FolderOpen,
      });
      result.push({
        key: "releases",
        label: t("medias.detail.tabReleases", "Releases"),
        icon: Search,
      });
    }
    return result;
  }, [item?.tmdb_id, t, isAdmin]);

  const activeTab = useMemo((): PageTab => {
    if (search.tab && tabs.some((tab) => tab.key === search.tab))
      return search.tab as PageTab;
    const fallback = defaultItemTab({
      isAdmin,
      status: item?.status,
      focusedEpisode: search.season != null || search.episode != null,
    });
    return tabs.some((tab) => tab.key === fallback) ? fallback : "info";
  }, [search.tab, search.season, search.episode, item?.status, tabs, isAdmin]);

  const setActiveTab = (tab: PageTab) =>
    navigate({
      search: (prev: LibraryItemSearchParams) => ({
        ...prev,
        tab,
        // A focused season belongs to the Files tab only.
        ...(tab === "files" ? {} : { season: undefined, episode: undefined }),
      }),
    });

  const handleWatchlistToggle = async () => {
    if (!item) return;
    if (isInWatchlist) {
      await removeFromWatchlist.mutateAsync({
        tmdb_id: item.tmdb_id,
        media_type: mediaType,
      });
    } else {
      await addToWatchlist.mutateAsync({
        tmdb_id: item.tmdb_id,
        media_type: mediaType,
        title: item.title,
        poster_url: item.poster_url,
        overview: item.overview,
        release_year: item.year,
        vote_average: voteAverage,
        release_date:
          mediaType === "movie" ? (detailsData?.release_date ?? null) : null,
      });
    }
  };

  // ── Loading skeleton ──────────────────────────────────────────────────────
  if (itemLoading && !item) {
    return (
      <div>
        <div className="relative h-[260px] md:h-[340px] bg-neutral-900 animate-pulse" />
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-3">
          <div className="h-2.5 bg-neutral-800 rounded w-20 animate-pulse" />
          <div className="h-6 bg-neutral-800 rounded w-56 animate-pulse" />
          <div className="h-3 bg-neutral-800 rounded w-80 animate-pulse" />
        </div>
      </div>
    );
  }

  // ── Not found ─────────────────────────────────────────────────────────────
  if (!item) {
    return (
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-16 text-center">
        <button
          type="button"
          onClick={() => goBack()}
          className="inline-flex items-center gap-1.5 text-sm text-neutral-500 hover:text-neutral-200 mb-8 transition-colors"
        >
          {t("medias.library.pageTitle", "Library")}
        </button>
        {itemError && !isNotFoundError(itemError) ? (
          <LoadError
            onRetry={() => void refetchItem()}
            retrying={itemRefetching}
          />
        ) : (
          <p className="text-neutral-400">
            {t("library.notFound", "Item not found in library.")}
          </p>
        )}
      </div>
    );
  }

  return (
    <div>
      <LibraryItemHero
        item={item}
        detailsData={detailsData}
        ratingsData={ratingsData}
        trailerData={trailerData}
        isInWatchlist={isInWatchlist}
        watchlistPending={
          addToWatchlist.isPending || removeFromWatchlist.isPending
        }
        mediaType={mediaType}
        isAdmin={isAdmin}
        onBack={() => goBack()}
        onWatchlistToggle={handleWatchlistToggle}
        onChooseRelease={chooseRelease}
        onUpgradeSearch={searchUpgrade}
        onEditDetails={() => setEditOpen(true)}
        onSearchReleases={() => setActiveTab("releases")}
        onUpgradeManualSearch={() => {
          setUpgradeSearchMode(true);
          setActiveTab("releases");
        }}
        onRemoved={() => goBack()}
      />
      {isAdmin && (
        <LibraryEditDetailsPanel
          open={editOpen}
          onClose={() => setEditOpen(false)}
          item={item}
          defaultBackdropUrl={
            detailsData?.primary_backdrop_url ??
            detailsData?.media_stills?.backdrops?.[0]?.url ??
            null
          }
          tmdb={{
            title:
              detailsData?.title_translations?.find(
                (tr) => tr.language_code === "en",
              )?.title ?? null,
            overview: detailsData?.overview ?? null,
            year:
              parseInt(
                (
                  detailsData?.release_date ??
                  detailsData?.first_air_date ??
                  ""
                ).slice(0, 4),
                10,
              ) || null,
          }}
          tmdbOriginalTitle={detailsData?.original_title ?? null}
          tmdbOriginalLanguage={detailsData?.original_language ?? null}
          tmdbTitleTranslations={detailsData?.title_translations ?? []}
          tmdbPending={modalPending}
        />
      )}

      {/* ── Body ──────────────────────────────────────────────────────────── */}
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-5 space-y-5">
        {/* Admins read the same miss in the header's status line. */}
        {!isAdmin && <LastSearchNote item={item} className="text-xs" />}

        {/* Overview */}
        {overview && (
          <p className="text-sm text-neutral-300 leading-relaxed max-w-2xl">
            {overview}
          </p>
        )}

        {/* Tabs */}
        <SegmentedTabs
          items={tabs.map((tab) => ({
            id: tab.key,
            label: tab.label,
            icon: tab.icon,
          }))}
          value={activeTab}
          onChange={setActiveTab}
          // underline indicator color is hardcoded on-palette (bg-primary-500) in segmented-tabs.tsx — no prop to override
          activeItemClassName="text-primary-300"
          inactiveItemClassName="text-neutral-400 hover:text-neutral-200"
          activeIconClassName="text-primary-400"
        />

        {/* Tab panels */}
        <div>
          {activeTab === "info" && (
            <div className="animate-in fade-in slide-in-from-bottom-1 duration-300 motion-reduce:animate-none">
              <LibraryItemInfoTab
                item={item}
                detailsData={detailsData}
                creditsData={creditsData}
                trailerData={trailerData}
                providers={providers}
                mediaType={mediaType}
                isPending={modalPending}
              />
            </div>
          )}

          {activeTab === "similar" && (
            <div className="min-h-[300px] pb-6 animate-in fade-in slide-in-from-bottom-1 duration-300 motion-reduce:animate-none">
              <SimilarMediasPanel
                isActive
                tmdbId={item.tmdb_id}
                mediaType={mediaType}
                onAdded={() => {}}
              />
            </div>
          )}

          {activeTab === "releases" && (
            <div className="min-h-[300px] pb-6 animate-in fade-in slide-in-from-bottom-1 duration-300 motion-reduce:animate-none">
              <LibraryItemSearchTab
                item={item}
                episodeSearchCtx={episodeSearchCtx}
                seasonSearchCtx={seasonSearchCtx}
                onClearEpisodeCtx={() => setEpisodeSearchCtx(null)}
                onClearSeasonCtx={() => setSeasonSearchCtx(null)}
                tmdbOriginalTitle={detailsData?.original_title ?? null}
                tmdbOriginalLanguage={detailsData?.original_language ?? null}
                tmdbTitleTranslations={detailsData?.title_translations ?? []}
                isUpgradeMode={upgradeSearchMode}
                onClearUpgradeMode={() => setUpgradeSearchMode(false)}
              />
            </div>
          )}

          {activeTab === "files" && (
            <div className="animate-in fade-in slide-in-from-bottom-1 duration-300 motion-reduce:animate-none">
              <LibraryFilesTab
                libraryId={item.id}
                focusSeason={search.season ?? null}
                focusEpisode={search.episode ?? null}
                onSearchEpisode={(ep) => {
                  setEpisodeSearchCtx(ep);
                  setSeasonSearchCtx(null);
                  setActiveTab("releases");
                }}
                onSearchSeason={(season) => {
                  setSeasonSearchCtx(season);
                  setEpisodeSearchCtx(null);
                  setActiveTab("releases");
                }}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
