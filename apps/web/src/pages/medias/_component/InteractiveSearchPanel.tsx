import { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useInteractiveSearchState } from "@/features/medias/hooks/useInteractiveSearchState";
import { useAddToBlocklist } from "@/features/medias/hooks/useBlocklist";
import { useCurrentUser } from "@/lib/auth/useAuth";
import type { InteractiveReleaseItem } from "@rawkoon/shared/types";
import { useLocalAiIntegration } from "@/pages/settings/useLocalAiIntegration";
import { useAiPick } from "@/pages/medias/_component/useAiPick";
import { AiPickBanner } from "@/pages/medias/_component/AiPickBanner";
import { useFetcher } from "@/lib/api/context";
import { MEDIAS_ENDPOINTS } from "@/lib/endpoints";
import { InteractiveSearchToolbar } from "./InteractiveSearchToolbar";
import { InteractiveSearchStatusStrip } from "./InteractiveSearchStatusStrip";
import { InteractiveSearchResultsList } from "./InteractiveSearchResultsList";
import { InteractiveSearchMobileDrawer } from "./InteractiveSearchMobileDrawer";
import type { MediaItem } from "@rawkoon/shared/types";
import type { LabeledTitleOption } from "@/lib/utils/interactive-search";

export interface InteractiveSearchPanelProps {
  isActive: boolean;
  media?: MediaItem | null;
  mode?: "arr" | "search";
  /** Native library row id — enables quality scoring on search results */
  libraryMediaId?: number | null;
  /** Prefill search query when opening (e.g. media title) — localized EN/FR (UI) title */
  defaultSearchQuery?: string | null;
  /** Per-language title options for the search-title picker (labels included) */
  titleOptions?: LabeledTitleOption[];
  /** Episode to link the grab to (shows only) */
  episodeId?: number | null;
  /** Pre-select a season (number) or complete series ("complete") when opening */
  defaultSeason?: number | "complete" | null;
  /** When true, grabs are sent with is_upgrade: true */
  isUpgradeMode?: boolean;
  onDownloadSuccess?: () => void;
}

export function InteractiveSearchPanel(props: InteractiveSearchPanelProps) {
  const state = useInteractiveSearchState(props);

  const { data: aiConfig } = useLocalAiIntegration();
  const aiEnabled = Boolean(aiConfig?.integration?.enabled);

  const mediaType =
    props.media?.media_type === "series"
      ? "tv"
      : (props.media?.media_type ?? "movie");

  const aiPick = useAiPick({
    enabled:
      aiEnabled && state.releases.length > 0 && !state.activeQuery.isLoading,
    releases: state.releases,
    mediaTitle: props.media?.title ?? props.defaultSearchQuery ?? "",
    mediaYear: props.media?.year ?? null,
    mediaType: mediaType as "movie" | "tv",
  });

  const pickedRelease =
    aiPick.data?.release_key != null
      ? (state.releases.find((r) => r.guid === aiPick.data?.release_key) ??
        null)
      : null;

  const [aiDismissed, setAiDismissed] = useState(false);

  const { t } = useTranslation("common");
  const { data: currentUser } = useCurrentUser();
  const addToBlocklist = useAddToBlocklist();
  const [blockingReleaseKey, setBlockingReleaseKey] = useState<string | null>(
    null,
  );
  const [blockedTitles, setBlockedTitles] = useState<Set<string>>(new Set());

  const releaseKeyOf = (release: InteractiveReleaseItem) =>
    `${release.guid}-${release.indexer_id ?? "x"}`;

  const handleBlock = async (release: InteractiveReleaseItem) => {
    const key = releaseKeyOf(release);
    setBlockingReleaseKey(key);
    try {
      await addToBlocklist.mutateAsync({
        release_title: release.title,
        ...(release.indexer ? { indexer: release.indexer } : {}),
        ...(props.libraryMediaId != null
          ? { media_id: props.libraryMediaId }
          : {}),
        ...(props.episodeId != null ? { episode_id: props.episodeId } : {}),
      });
      setBlockedTitles((prev) =>
        new Set(prev).add(release.title.trim().toLowerCase()),
      );
      toast.success(t("medias.interactive.blockSuccess"));
    } catch (err: unknown) {
      const msg =
        err && typeof err === "object" && "message" in err
          ? String((err as Error).message)
          : t("medias.interactive.blockFailed");
      toast.error(msg);
    } finally {
      setBlockingReleaseKey(null);
    }
  };

  const candidateKeys = state.releases
    .filter((r) => !r.rejected)
    .map((r) => r.guid)
    .join(",");

  // Re-show the AI suggestion when the candidate set changes (render-time
  // state adjustment, not an effect).
  const [prevCandidateKeys, setPrevCandidateKeys] = useState(candidateKeys);
  if (candidateKeys !== prevCandidateKeys) {
    setPrevCandidateKeys(candidateKeys);
    setAiDismissed(false);
  }

  // Pre-warm the LLM as soon as the panel opens so the model is already loaded
  // by the time search results arrive (~1-3s later).
  const fetcher = useFetcher();
  const warmedRef = useRef(false);
  useEffect(() => {
    if (!aiEnabled || warmedRef.current) return;
    warmedRef.current = true;
    void fetcher(MEDIAS_ENDPOINTS.INTERACTIVE_SEARCH_AI_WARM).catch(() => {});
  }, [aiEnabled, fetcher]);

  if (!state.canRenderBody) return null;

  return (
    <div className="flex flex-col">
      <InteractiveSearchToolbar
        filterQuery={state.filterQuery}
        showFilters={state.showFilters}
        hideRejected={state.hideRejected}
        sortBy={state.sortBy}
        sortDir={state.sortDir}
        includedTrackers={state.includedTrackers}
        excludedTrackers={state.excludedTrackers}
        includedLanguages={state.includedLanguages}
        selectedSeason={state.selectedSeason}
        showPacksOnly={state.showPacksOnly}
        setFilters={state.setFilters}
        isShow={state.isShow}
        availableSeasons={state.availableSeasons}
        trackerOptions={state.trackerOptions}
        languageOptions={state.languageOptions}
        hasAdvancedFilters={state.hasAdvancedFilters}
        totalActiveFilters={state.totalActiveFilters}
        isFetching={state.activeQuery.isFetching}
        needsSearchQuery={state.needsSearchQuery}
        onOpenMobileDrawer={() => state.setMobileDrawerOpen(true)}
        searchInputRef={state.searchInputRef}
        onRefetch={() => void state.activeQuery.refetch()}
        onIncludedTrackersChange={state.handleIncludedTrackersChange}
        onExcludedTrackersChange={state.handleExcludedTrackersChange}
      />

      {/* Mobile bottom drawer — all controls except search + toggles */}
      <InteractiveSearchMobileDrawer
        open={state.mobileDrawerOpen}
        onClose={() => state.setMobileDrawerOpen(false)}
        isShow={state.isShow}
        availableSeasons={state.availableSeasons}
        selectedSeason={state.selectedSeason}
        onSeasonChange={(s) =>
          state.setFilters((prev) => ({ ...prev, selectedSeason: s }))
        }
        needsSearchQuery={state.needsSearchQuery}
        visibleCount={state.visibleCount}
        totalReleases={state.totalReleases}
        hiddenCount={state.hiddenCount}
        searchApiQuery={state.searchApiQuery}
        canSelectTitle={state.canSelectTitle}
        titleOptions={state.titleOptions}
        selectedTitleQuery={state.selectedTitleQuery}
        onSelectTitle={state.selectSearchTitle}
        hideRejected={state.hideRejected}
        onHideRejectedChange={(v) =>
          state.setFilters((prev) => ({ ...prev, hideRejected: v }))
        }
        showPacksOnly={state.showPacksOnly}
        onShowPacksOnlyChange={(v) =>
          state.setFilters((prev) => ({ ...prev, showPacksOnly: v }))
        }
        hasViewOverrides={state.hasViewOverrides}
        onResetView={state.resetView}
        sortBy={state.sortBy}
        sortDir={state.sortDir}
        onSortByChange={(v) =>
          state.setFilters((prev) => ({ ...prev, sortBy: v }))
        }
        onToggleSortDir={() =>
          state.setFilters((prev) => ({
            ...prev,
            sortDir: prev.sortDir === "asc" ? "desc" : "asc",
          }))
        }
        totalActiveFilters={state.totalActiveFilters}
        hasAdvancedFilters={state.hasAdvancedFilters}
        onClearFilters={() =>
          state.setFilters((prev) => ({
            ...prev,
            includedTrackers: [],
            excludedTrackers: [],
            includedLanguages: [],
          }))
        }
        trackerOptions={state.trackerOptions}
        includedTrackers={state.includedTrackers}
        excludedTrackers={state.excludedTrackers}
        onIncludedTrackersChange={state.handleIncludedTrackersChange}
        onExcludedTrackersChange={state.handleExcludedTrackersChange}
        languageOptions={state.languageOptions}
        includedLanguages={state.includedLanguages}
        onIncludedLanguagesChange={(values) =>
          state.setFilters((prev) => ({ ...prev, includedLanguages: values }))
        }
      />

      <div className="pt-3">
        <InteractiveSearchStatusStrip
          indexerWarnings={state.indexerWarnings}
          dismissed={state.indexerWarningsDismissed}
          onDismiss={() => state.setIndexerWarningsDismissed(true)}
          hiddenCount={state.hiddenCount}
          hasViewOverrides={state.hasViewOverrides}
          onResetView={state.resetView}
          visibleCount={state.visibleCount}
          totalReleases={state.totalReleases}
          isSearchMode={state.isSearchMode}
          searchApiQuery={state.searchApiQuery}
          canSelectTitle={state.canSelectTitle}
          titleOptions={state.titleOptions}
          selectedTitleQuery={state.selectedTitleQuery}
          onSelectTitle={state.selectSearchTitle}
        />

        {!aiDismissed && aiEnabled && (
          <AiPickBanner
            isLoading={aiPick.isLoading}
            isError={aiPick.isError}
            release={pickedRelease}
            reasoning={aiPick.data?.reasoning ?? null}
            grabBusy={state.grabBusy}
            onGrab={state.downloadRelease}
            onRetry={() => void aiPick.refetch()}
            onDismiss={() => setAiDismissed(true)}
          />
        )}

        <InteractiveSearchResultsList
          releases={state.releases}
          isLoading={state.activeQuery.isLoading}
          needsSearchQuery={state.needsSearchQuery}
          errorMessage={state.errorMessage}
          grabBusy={state.grabBusy}
          pendingReleaseKey={state.pendingReleaseKey}
          grabbedTitles={state.grabbedTitles}
          onDownload={state.downloadRelease}
          onBlock={
            currentUser?.is_admin ? (r) => void handleBlock(r) : undefined
          }
          blockingReleaseKey={blockingReleaseKey}
          blockedTitles={blockedTitles}
          onRefetch={() => void state.activeQuery.refetch()}
          totalReleases={state.totalReleases}
          isError={state.activeQuery.isError}
          onResetView={state.resetView}
          aiPickKey={
            !aiDismissed && aiEnabled
              ? (aiPick.data?.release_key ?? null)
              : null
          }
        />
      </div>
    </div>
  );
}
