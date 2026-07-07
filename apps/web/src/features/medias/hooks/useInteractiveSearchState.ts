import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useInteractiveDownload } from "@/features/medias/hooks/useInteractiveDownload";
import { useInteractiveSearch } from "@/features/medias/hooks/useInteractiveSearch";
import { useLibraryGrabRelease } from "@/features/medias/hooks/useLibraryGrabRelease";
import { useLibraryEpisodes } from "@/features/medias/hooks/useLibraryEpisodes";
import { useLibraryDownloads } from "@/features/medias/hooks/useLibraryDownloads";
import type { InteractiveReleaseItem, MediaItem } from "@rawkoon/shared/types";
import {
  filterAndSortReleases,
  normalizeFilterKey,
  UNKNOWN_TRACKER_KEY,
  UNKNOWN_LANGUAGE_KEY,
  type InteractiveSortKey,
  type InteractiveSortDir,
  type LabeledTitleOption,
} from "@/lib/utils/interactive-search";
export type FilterOption = { key: string; label: string };

export interface UseInteractiveSearchStateProps {
  isActive: boolean;
  media?: MediaItem | null;
  mode?: "arr" | "search";
  libraryMediaId?: number | null;
  defaultSearchQuery?: string | null;
  /** Per-language title options for the search-title picker (labels included) */
  titleOptions?: LabeledTitleOption[];
  episodeId?: number | null;
  defaultSeason?: number | "complete" | null;
  isUpgradeMode?: boolean;
  onDownloadSuccess?: () => void;
}

export interface FilterState {
  filterQuery: string;
  searchApiQuery: string;
  showFilters: boolean;
  hideRejected: boolean;
  sortBy: InteractiveSortKey;
  sortDir: InteractiveSortDir;
  includedTrackers: string[];
  excludedTrackers: string[];
  includedLanguages: string[];
  /** null = episode/free-text, number = season pack, "complete" = full series */
  selectedSeason: number | "complete" | null;
  showPacksOnly: boolean;
}

export function useInteractiveSearchState({
  isActive,
  media = null,
  mode = "search",
  libraryMediaId = null,
  defaultSearchQuery = null,
  titleOptions = [],
  episodeId = null,
  defaultSeason = null,
  isUpgradeMode = false,
  onDownloadSuccess,
}: UseInteractiveSearchStateProps) {
  const { t } = useTranslation("common");
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const libId =
    libraryMediaId != null && libraryMediaId > 0 ? libraryMediaId : null;
  const isSearchMode = mode === "search";
  const sourceId = media?.source_id ?? null;
  const canRenderBody = isSearchMode || (media != null && sourceId != null);

  const localizedQuery = defaultSearchQuery?.trim() ?? "";
  const canSelectTitle = isSearchMode && titleOptions.length > 1;

  const buildInitialFilters = (): FilterState => ({
    filterQuery: "",
    searchApiQuery: localizedQuery,
    showFilters: false,
    hideRejected: true,
    sortBy: libId ? "quality" : "seeders",
    sortDir: "desc",
    includedTrackers: [],
    excludedTrackers: [],
    includedLanguages: [],
    selectedSeason: defaultSeason ?? null,
    showPacksOnly: false,
  });

  const [filters, setFilters] = useState<FilterState>(buildInitialFilters);
  const [pendingReleaseKey, setPendingReleaseKey] = useState<string | null>(
    null,
  );
  const [indexerWarningsDismissed, setIndexerWarningsDismissed] =
    useState(false);
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);

  const {
    filterQuery,
    searchApiQuery,
    showFilters,
    hideRejected,
    sortBy,
    sortDir,
    includedTrackers,
    excludedTrackers,
    includedLanguages,
    selectedSeason,
    showPacksOnly,
  } = filters;

  const isShow = media?.media_type === "series";
  const mediaTmdbId = media?.tmdb_id ?? null;
  const episodesQuery = useLibraryEpisodes(isShow && isActive ? libId : null);
  const availableSeasons = useMemo(() => {
    if (!episodesQuery.data?.seasons) return [];
    return episodesQuery.data.seasons
      .map((s) => s.season)
      .filter((s) => s > 0)
      .sort((a, b) => a - b);
  }, [episodesQuery.data]);

  const activeQuery = useInteractiveSearch(searchApiQuery, {
    enabled: isActive,
    library_media_id: libId,
    season: selectedSeason,
    tmdb_id: mediaTmdbId ?? null,
    media_type:
      media?.media_type === "series" ? "tv" : (media?.media_type ?? null),
  });
  const interactiveDownloadMutation = useInteractiveDownload();
  const libraryGrabMutation = useLibraryGrabRelease(libId);
  const grabBusy =
    libraryGrabMutation.isPending || interactiveDownloadMutation.isPending;

  const downloadsQuery = useLibraryDownloads(libId);
  const grabbedTitles = useMemo(() => {
    const set = new Set<string>();
    for (const row of downloadsQuery.data?.items ?? []) {
      if (row.release_title) set.add(row.release_title.trim().toLowerCase());
    }
    return set;
  }, [downloadsQuery.data]);

  // Reset filters when the search context changes, adjusting state during
  // render instead of in an effect (avoids a committed frame of stale filters).
  const resetKey = `${isActive}|${media?.id ?? ""}|${defaultSearchQuery ?? ""}|${defaultSeason ?? ""}|${libId ?? ""}`;
  const [prevResetKey, setPrevResetKey] = useState(resetKey);
  if (resetKey !== prevResetKey) {
    setPrevResetKey(resetKey);
    if (isActive) {
      setFilters(buildInitialFilters());
      setPendingReleaseKey(null);
    }
  }

  useEffect(() => {
    if (!isActive) return;
    const frame = window.requestAnimationFrame(() => {
      searchInputRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [isActive, media?.id, defaultSearchQuery, libId]);

  const selectSearchTitle = (query: string) => {
    setFilters((prev) => ({ ...prev, searchApiQuery: query }));
  };

  const trackerOptions = useMemo<FilterOption[]>(() => {
    const options = new Map<string, string>();

    for (const release of activeQuery.data?.releases ?? []) {
      const trackerLabel =
        release.indexer?.trim() || t("medias.interactive.unknownIndexer");
      const trackerKey = release.indexer?.trim()
        ? normalizeFilterKey(release.indexer)
        : UNKNOWN_TRACKER_KEY;
      if (!options.has(trackerKey)) options.set(trackerKey, trackerLabel);
    }

    return [...options.entries()]
      .map(([key, label]) => ({ key, label }))
      .sort((a, b) =>
        a.label.localeCompare(b.label, undefined, { sensitivity: "base" }),
      );
  }, [activeQuery.data?.releases, t]);

  const languageOptions = useMemo<FilterOption[]>(() => {
    const options = new Map<string, string>();

    for (const release of activeQuery.data?.releases ?? []) {
      const languages =
        release.languages.length > 0
          ? release.languages
          : [t("medias.interactive.unknownLanguage")];
      for (const language of languages) {
        const trimmed = language.trim();
        if (!trimmed) continue;
        const languageKey =
          release.languages.length > 0
            ? normalizeFilterKey(trimmed)
            : UNKNOWN_LANGUAGE_KEY;
        if (!options.has(languageKey)) options.set(languageKey, trimmed);
      }
    }

    return [...options.entries()]
      .map(([key, label]) => ({ key, label }))
      .sort((a, b) =>
        a.label.localeCompare(b.label, undefined, { sensitivity: "base" }),
      );
  }, [activeQuery.data?.releases, t]);

  const releases = useMemo(() => {
    let list = filterAndSortReleases(activeQuery.data?.releases ?? [], {
      filterQuery,
      hideRejected,
      includedTrackers,
      excludedTrackers,
      includedLanguages,
      sortBy,
      sortDir,
      isSearchMode,
      mediaTitle: media?.title ?? defaultSearchQuery ?? null,
      mediaYear: media?.year ?? null,
    });
    if (showPacksOnly || selectedSeason != null) {
      list = list.filter((r) => r.is_season_pack || r.is_complete_series);
    }
    return list;
  }, [
    activeQuery.data?.releases,
    defaultSearchQuery,
    excludedTrackers,
    filterQuery,
    hideRejected,
    includedLanguages,
    includedTrackers,
    isSearchMode,
    media?.title,
    media?.year,
    selectedSeason,
    showPacksOnly,
    sortBy,
    sortDir,
  ]);

  const downloadRelease = async (release: InteractiveReleaseItem) => {
    const releaseKey = `${release.guid}-${release.indexer_id ?? "x"}`;
    setPendingReleaseKey(releaseKey);

    try {
      if (isSearchMode && libId != null && release.download_url) {
        // Library grab — records in DB and sends URL to qBittorrent
        if (libraryGrabMutation.isPending) return;
        await libraryGrabMutation.mutateAsync({
          download_url: release.download_url,
          release_title: release.title,
          indexer: release.indexer,
          quality_parsed: release.parsed_quality ?? undefined,
          size_bytes: release.size_bytes,
          episode_id: episodeId,
          ...(isUpgradeMode ? { is_upgrade: true } : {}),
        });
      } else if (isSearchMode && release.download_token) {
        if (interactiveDownloadMutation.isPending) return;
        const res = await interactiveDownloadMutation.mutateAsync({
          token: release.download_token,
        });
        const resolvedUrl = res.magnet_url ?? res.download_url;
        if (libId != null && resolvedUrl) {
          if (libraryGrabMutation.isPending) return;
          await libraryGrabMutation.mutateAsync({
            download_url: resolvedUrl,
            release_title: release.title,
            indexer: release.indexer,
            quality_parsed: release.parsed_quality ?? undefined,
            size_bytes: release.size_bytes,
            episode_id: episodeId,
            ...(isUpgradeMode ? { is_upgrade: true } : {}),
          });
        }
      } else {
        return;
      }

      toast.success(t("medias.interactive.downloadStarted"));
      onDownloadSuccess?.();
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : t("medias.interactive.downloadFailed");
      toast.error(message);
    } finally {
      setPendingReleaseKey(null);
    }
  };

  const totalReleases = activeQuery.data?.releases.length ?? 0;
  const indexerWarnings = activeQuery.data?.indexer_warnings ?? [];

  // Re-arm the indexer-warning banner whenever a new fetch starts (render-time
  // state adjustment — see resetKey above).
  const isFetchingActive = isActive && activeQuery.isFetching;
  const [prevIsFetchingActive, setPrevIsFetchingActive] =
    useState(isFetchingActive);
  if (isFetchingActive !== prevIsFetchingActive) {
    setPrevIsFetchingActive(isFetchingActive);
    if (isFetchingActive) setIndexerWarningsDismissed(false);
  }

  const hasAdvancedFilters =
    includedTrackers.length > 0 ||
    excludedTrackers.length > 0 ||
    includedLanguages.length > 0;
  const totalActiveFilters =
    includedTrackers.length +
    excludedTrackers.length +
    includedLanguages.length;
  const hasViewOverrides = totalActiveFilters > 0 || !hideRejected;
  const visibleCount = releases.length;
  const hiddenCount = Math.max(0, totalReleases - visibleCount);
  const errorMessage =
    activeQuery.error instanceof Error ? activeQuery.error.message : null;
  const needsSearchQuery = searchApiQuery.length < 2;

  const resetView = () => {
    setFilters((prev) => ({
      ...prev,
      hideRejected: false,
      includedTrackers: [],
      excludedTrackers: [],
      includedLanguages: [],
    }));
  };

  const handleIncludedTrackersChange = (values: string[]) => {
    setFilters((prev) => ({
      ...prev,
      includedTrackers: values,
      excludedTrackers: prev.excludedTrackers.filter(
        (k) => !values.includes(k),
      ),
    }));
  };

  const handleExcludedTrackersChange = (values: string[]) => {
    setFilters((prev) => ({
      ...prev,
      excludedTrackers: values,
      includedTrackers: prev.includedTrackers.filter(
        (k) => !values.includes(k),
      ),
    }));
  };

  return {
    // refs
    searchInputRef,
    // filter state
    filters,
    setFilters,
    filterQuery,
    searchApiQuery,
    showFilters,
    hideRejected,
    sortBy,
    sortDir,
    includedTrackers,
    excludedTrackers,
    includedLanguages,
    selectedSeason,
    showPacksOnly,
    // drawer
    mobileDrawerOpen,
    setMobileDrawerOpen,
    // dismissal
    indexerWarningsDismissed,
    setIndexerWarningsDismissed,
    pendingReleaseKey,
    // computed values
    isShow,
    isSearchMode,
    canRenderBody,
    canSelectTitle,
    titleOptions,
    selectedTitleQuery: searchApiQuery,
    trackerOptions,
    languageOptions,
    releases,
    grabBusy,
    totalReleases,
    indexerWarnings,
    hasAdvancedFilters,
    totalActiveFilters,
    hasViewOverrides,
    visibleCount,
    hiddenCount,
    errorMessage,
    needsSearchQuery,
    availableSeasons,
    grabbedTitles,
    // query
    activeQuery,
    // handlers
    selectSearchTitle,
    downloadRelease,
    resetView,
    handleIncludedTrackersChange,
    handleExcludedTrackersChange,
  };
}
