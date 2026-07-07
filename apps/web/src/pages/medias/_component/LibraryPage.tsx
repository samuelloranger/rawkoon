import { useMemo, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearch } from "@tanstack/react-router";
import {
  Film,
  Tv,
  Clock,
  CheckCircle2,
  Download,
  BarChart3,
} from "lucide-react";
import { toast } from "sonner";
import { useLibraryNavigation } from "@/features/medias/context/LibraryNavigationContext";
import { PageLayout } from "@/components/PageLayout";
import { type SegmentedTabItem } from "@/components/ui/segmented-tabs";
import { useLibrary } from "@/features/medias/hooks/useLibrary";
import { useLibraryLanguageTags } from "@/features/medias/hooks/useLibraryLanguageTags";
import { useSearchLibraryMovie } from "@/features/medias/hooks/useSearchLibraryMovie";
import { useLibraryEvents } from "@/features/medias/hooks/useLibraryEvents";
import { useAuth } from "@/lib/auth/useAuth";
import {
  type FilterType,
  type FilterStatus,
  type SortDir,
  sortItems,
} from "@/utils/libraryUtils";
import { LibraryPageHeader } from "./LibraryPageHeader";
import { LibraryMobileFilterSheet } from "./LibraryMobileFilterSheet";
import { TmdbSearchModal } from "./TmdbSearchModal";
import { LibraryToolbar } from "./LibraryToolbar";
import { LibraryGrid } from "./LibraryGrid";
import { LibraryStatsPanel } from "./LibraryStatsPanel";
import { ManagementSection } from "./LibrarySharedUI";
import {
  useLibraryPageState,
  type LibraryPageSearchParams,
} from "./useLibraryPageState";

export function LibraryPage() {
  const { t } = useTranslation("common");
  const { user } = useAuth();
  const { saveLibrarySearch } = useLibraryNavigation();
  const searchParams = useSearch({ from: "/library/" });

  // Keep the context in sync so LibraryItemPage can navigate back with filters intact.
  useEffect(() => {
    saveLibrarySearch(searchParams as Record<string, unknown>);
  }, [searchParams, saveLibrarySearch]);

  useLibraryEvents();

  const [sheetOpen, setSheetOpen] = useState(false);
  const [addModalOpen, setAddModalOpen] = useState(false);

  const searchMovie = useSearchLibraryMovie();

  // ─── Filter / sort state (URL-persisted) ───────────────────────────────────
  const { state, setState, activeFilterCount } = useLibraryPageState(
    searchParams as LibraryPageSearchParams,
  );
  const {
    type: typeFilter,
    status: statusFilter,
    language: languageFilter,
    search,
    sortBy,
    sortDir,
    viewMode,
  } = state;

  // ─── Data fetch (server filters via query params) ──────────────────────────
  const { data, isLoading, refetch } = useLibrary({
    type: typeFilter !== "all" ? typeFilter : undefined,
    status: statusFilter !== "all" ? statusFilter : undefined,
    q: search || undefined,
    language: languageFilter !== "all" ? languageFilter : undefined,
  });

  const { data: languageTagsData } = useLibraryLanguageTags();
  const languageTags = languageTagsData?.tags ?? [];

  useEffect(() => {
    if (languageTags.length === 0 && languageFilter !== "all") {
      setState({ language: "all" });
    }
  }, [languageTags.length, languageFilter, setState]);

  // ─── Pipeline: fetched items → sort ─────────────────────────────────────────
  // Filtering is server-side (passed as query params to useLibrary above), so
  // the client only sorts. The full sorted list is rendered via a virtualized
  // continuous-scroll grid in LibraryGrid (no pagination).
  const allItems = useMemo(() => data?.items ?? [], [data?.items]);

  const sorted = useMemo(
    () => sortItems(allItems, sortBy, sortDir as SortDir),
    [allItems, sortBy, sortDir],
  );

  const handleMovieSearch = (id: number) => {
    searchMovie.mutate(
      { id },
      {
        onSuccess: (r) => {
          if (r.grabbed) toast.success(t("library.management.grabbed"));
          else toast.error(r.reason ?? t("library.management.grabFailed"));
        },
        onError: () => toast.error(t("library.management.grabFailed")),
      },
    );
  };

  const movieCount = data?.movie_count ?? 0;
  const showCount = data?.show_count ?? 0;
  const typeItems = [
    { id: "all", label: t("medias.library.typeAll") },
    {
      id: "movie",
      label: t("medias.library.moviesWithCount", { count: movieCount }),
      icon: Film,
    },
    {
      id: "show",
      label: t("medias.library.showsWithCount", { count: showCount }),
      icon: Tv,
    },
  ] satisfies SegmentedTabItem<FilterType>[];
  const statusItems = [
    { id: "all", label: t("medias.library.statusAll") },
    {
      id: "downloaded",
      label: t("medias.library.statusDownloaded"),
      icon: CheckCircle2,
    },
    {
      id: "wanted",
      label: t("medias.library.statusWanted"),
      icon: Clock,
    },
    {
      id: "downloading",
      label: t("medias.library.statusDownloading"),
      icon: Download,
    },
  ] satisfies SegmentedTabItem<FilterStatus>[];

  return (
    <PageLayout>
      <LibraryPageHeader
        movieCount={movieCount}
        showCount={showCount}
        isLoading={isLoading}
        onRefresh={() => refetch()}
        onAddClick={() => setAddModalOpen(true)}
        isAdmin={user?.is_admin ?? false}
      />

      <div className="space-y-4">
        <ManagementSection
          icon={BarChart3}
          title={t("library.stats.title")}
          collapsible
          defaultOpen
        >
          <LibraryStatsPanel />
        </ManagementSection>

        <LibraryToolbar
          search={search}
          typeFilter={typeFilter}
          statusFilter={statusFilter}
          languageFilter={languageFilter}
          sortBy={sortBy}
          sortDir={sortDir}
          viewMode={viewMode}
          languageTags={languageTags}
          typeItems={typeItems}
          statusItems={statusItems}
          activeFilterCount={activeFilterCount}
          onSearchChange={(value) => setState({ search: value })}
          onTypeChange={(value) => setState({ type: value })}
          onStatusChange={(value) => setState({ status: value })}
          onLanguageChange={(value) => setState({ language: value })}
          onSortByChange={(value) => setState({ sortBy: value })}
          onSortDirToggle={() =>
            setState({
              sortDir: sortDir === "asc" ? "desc" : "asc",
            })
          }
          onViewModeChange={(value) => setState({ viewMode: value })}
          onOpenMobileSheet={() => setSheetOpen(true)}
        />

        <LibraryGrid
          items={sorted}
          isLoading={isLoading}
          viewMode={viewMode}
          onMovieSearch={handleMovieSearch}
          movieSearchPending={searchMovie.isPending}
          movieSearchId={searchMovie.variables?.id ?? null}
        />
      </div>

      <LibraryMobileFilterSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        typeFilter={typeFilter}
        statusFilter={statusFilter}
        languageFilter={languageFilter}
        sortBy={sortBy}
        sortDir={sortDir}
        languageTags={languageTags}
        typeItems={typeItems}
        statusItems={statusItems}
        onTypeChange={(v) => setState({ type: v })}
        onStatusChange={(v) => setState({ status: v })}
        onLanguageChange={(v) => setState({ language: v })}
        onSortByChange={(v) => setState({ sortBy: v })}
        onSortDirChange={(v) => setState({ sortDir: v })}
        onReset={() =>
          setState({
            type: "all",
            status: "all",
            language: "all",
            sortBy: "added_at",
            sortDir: "desc",
          })
        }
      />
      <TmdbSearchModal
        isOpen={addModalOpen}
        onClose={() => setAddModalOpen(false)}
      />
    </PageLayout>
  );
}
