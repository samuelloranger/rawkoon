import { useMemo, useEffect, useState } from "react";
import { useSearch } from "@tanstack/react-router";
import { useLibraryNavigation } from "@/features/medias/context/LibraryNavigationContext";
import { PageLayout } from "@/components/PageLayout";
import { useInfiniteLibrary } from "@/features/medias/hooks/useInfiniteLibrary";
import { useLibraryLanguageTags } from "@/features/medias/hooks/useLibraryLanguageTags";
import { useLiveSearchToast } from "@/features/medias/hooks/useLiveSearchToast";
import { useSearchLibraryMovie } from "@/features/medias/hooks/useSearchLibraryMovie";
import { useLibraryEvents } from "@/features/medias/hooks/useLibraryEvents";
import { LibraryGrowthStrip } from "@/features/library/LibraryGrowthStrip";
import { useAuth } from "@/lib/auth/useAuth";
import { GrabReadinessBanner } from "./GrabReadinessBanner";
import { LibraryPageHeader } from "./LibraryPageHeader";
import { LibrarySwitch } from "./LibrarySwitch";
import { TmdbSearchModal } from "./TmdbSearchModal";
import { LibraryToolbar } from "./LibraryToolbar";
import { LibraryGrid } from "./LibraryGrid";
import {
  useLibraryPageState,
  type LibraryPageSearchParams,
} from "./useLibraryPageState";

export function LibraryPage() {
  const { user } = useAuth();
  const { saveLibrarySearch } = useLibraryNavigation();
  const searchParams = useSearch({ from: "/library/" });

  // Keep the context in sync so LibraryItemPage can navigate back with filters intact.
  useEffect(() => {
    saveLibrarySearch(searchParams as Record<string, unknown>);
  }, [searchParams, saveLibrarySearch]);

  useLibraryEvents();

  const [addModalOpen, setAddModalOpen] = useState(false);

  const searchMovie = useSearchLibraryMovie();
  const liveSearchToast = useLiveSearchToast();

  // ─── Filter / sort state (URL-persisted) ───────────────────────────────────
  const { state, setState, setSort, resetFilters, activeFilterCount } =
    useLibraryPageState(searchParams as LibraryPageSearchParams);
  const {
    type: typeFilter,
    status: statusFilter,
    language: languageFilter,
    search,
    sortBy,
    sortDir,
    view: viewMode,
  } = state;

  // ─── Data fetch (server filters + sort + pagination via query params) ───────
  const { data, isLoading, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useInfiniteLibrary({
      type: typeFilter !== "all" ? typeFilter : undefined,
      status: statusFilter !== "all" ? statusFilter : undefined,
      q: search || undefined,
      language: languageFilter !== "all" ? languageFilter : undefined,
      sortBy,
      sortDir,
    });

  const { data: languageTagsData } = useLibraryLanguageTags();
  const languageTags = languageTagsData?.tags ?? [];

  useEffect(() => {
    if (languageTags.length === 0 && languageFilter !== "all") {
      setState({ language: "all" });
    }
  }, [languageTags.length, languageFilter, setState]);

  // Server returns already-sorted, already-filtered pages; the client only
  // flattens the loaded pages into one list for the virtualized grid.
  const sorted = useMemo(
    () => data?.pages.flatMap((p) => p.items) ?? [],
    [data?.pages],
  );

  const handleMovieSearch = (id: number) => {
    const item = sorted.find((m) => m.id === id);
    liveSearchToast.announceSearch(
      {
        mediaId: id,
        title: item?.title ?? "",
        profileName: item?.quality_profile?.name ?? null,
        isShow: false,
      },
      () => searchMovie.mutateAsync({ id }),
    );
  };

  const movieCount = data?.pages[0]?.movie_count ?? 0;
  const showCount = data?.pages[0]?.show_count ?? 0;
  const resultCount =
    data === undefined
      ? null
      : typeFilter === "movie"
        ? movieCount
        : typeFilter === "show"
          ? showCount
          : movieCount + showCount;
  return (
    <PageLayout>
      <LibrarySwitch active="media" />
      <LibraryPageHeader
        movieCount={movieCount}
        showCount={showCount}
        onAddClick={() => setAddModalOpen(true)}
        isAdmin={user?.is_admin ?? false}
      />

      {user?.is_admin && <GrabReadinessBanner />}

      <div className="mt-3 space-y-4">
        <LibraryGrowthStrip />

        <LibraryToolbar
          search={search}
          typeFilter={typeFilter}
          statusFilter={statusFilter}
          languageFilter={languageFilter}
          sortBy={sortBy}
          sortDir={sortDir}
          viewMode={viewMode}
          languageTags={languageTags}
          movieCount={movieCount}
          showCount={showCount}
          resultCount={resultCount}
          activeFilterCount={activeFilterCount}
          onSearchChange={(value) =>
            setState({ search: value }, { replace: true })
          }
          onTypeChange={(value) => setState({ type: value })}
          onStatusChange={(value) => setState({ status: value })}
          onLanguageChange={(value) => setState({ language: value })}
          onSortChange={setSort}
          onViewModeChange={(value) => setState({ view: value })}
          onReset={resetFilters}
        />

        <LibraryGrid
          items={sorted}
          isLoading={isLoading}
          viewMode={viewMode}
          filtered={
            typeFilter !== "all" ||
            statusFilter !== "all" ||
            languageFilter !== "all" ||
            search !== ""
          }
          onMovieSearch={handleMovieSearch}
          movieSearchPending={searchMovie.isPending}
          movieSearchId={searchMovie.variables?.id ?? null}
          hasNextPage={hasNextPage}
          isFetchingNextPage={isFetchingNextPage}
          onLoadMore={() => fetchNextPage()}
        />
      </div>

      <TmdbSearchModal
        isOpen={addModalOpen}
        onClose={() => setAddModalOpen(false)}
      />
    </PageLayout>
  );
}
