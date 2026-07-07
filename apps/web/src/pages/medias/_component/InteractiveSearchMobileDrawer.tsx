import { ArrowDownAZ, ArrowUpZA } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";
import {
  type InteractiveSortKey,
  type InteractiveSortDir,
  type LabeledTitleOption,
} from "@/lib/utils/interactive-search";
import { SearchTitleSelect } from "./SearchTitleSelect";
import {
  Toggle,
  ChipMultiSelect,
  FilterSection,
  type FilterOption,
} from "./InteractiveSearchFilters";
import { MobileBottomSheet } from "./MobileBottomSheet";

interface InteractiveSearchMobileDrawerProps {
  open: boolean;
  onClose: () => void;

  isShow: boolean;
  availableSeasons: number[];
  selectedSeason: number | "complete" | null;
  onSeasonChange: (s: number | "complete" | null) => void;

  needsSearchQuery: boolean;
  visibleCount: number;
  totalReleases: number;
  hiddenCount: number;
  searchApiQuery: string;
  canSelectTitle: boolean;
  titleOptions: LabeledTitleOption[];
  selectedTitleQuery: string;
  onSelectTitle: (query: string) => void;

  hideRejected: boolean;
  onHideRejectedChange: (v: boolean) => void;
  showPacksOnly: boolean;
  onShowPacksOnlyChange: (v: boolean) => void;

  hasViewOverrides: boolean;
  onResetView: () => void;

  sortBy: InteractiveSortKey;
  sortDir: InteractiveSortDir;
  onSortByChange: (v: InteractiveSortKey) => void;
  onToggleSortDir: () => void;

  totalActiveFilters: number;
  hasAdvancedFilters: boolean;
  onClearFilters: () => void;

  trackerOptions: FilterOption[];
  includedTrackers: string[];
  excludedTrackers: string[];
  onIncludedTrackersChange: (v: string[]) => void;
  onExcludedTrackersChange: (v: string[]) => void;

  languageOptions: FilterOption[];
  includedLanguages: string[];
  onIncludedLanguagesChange: (v: string[]) => void;
}

export function InteractiveSearchMobileDrawer({
  open,
  onClose,
  isShow,
  availableSeasons,
  selectedSeason,
  onSeasonChange,
  needsSearchQuery,
  visibleCount,
  totalReleases,
  hiddenCount,
  searchApiQuery,
  canSelectTitle,
  titleOptions,
  selectedTitleQuery,
  onSelectTitle,
  hideRejected,
  onHideRejectedChange,
  showPacksOnly,
  onShowPacksOnlyChange,
  hasViewOverrides,
  onResetView,
  sortBy,
  sortDir,
  onSortByChange,
  onToggleSortDir,
  totalActiveFilters,
  hasAdvancedFilters,
  onClearFilters,
  trackerOptions,
  includedTrackers,
  excludedTrackers,
  onIncludedTrackersChange,
  onExcludedTrackersChange,
  languageOptions,
  includedLanguages,
  onIncludedLanguagesChange,
}: InteractiveSearchMobileDrawerProps) {
  const { t } = useTranslation("common");

  return (
    <MobileBottomSheet
      open={open}
      onClose={onClose}
      title={t("medias.interactive.filtersTitle")}
      closeLabel={t("common.close")}
      bodyClassName="space-y-5 py-4"
      footer={
        <>
          {hasViewOverrides && (
            <button
              type="button"
              onClick={onResetView}
              className="text-sm text-neutral-400 transition-colors hover:text-neutral-300"
            >
              {t("medias.interactive.resetView")}
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="ml-auto rounded-xl bg-primary-600 px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-primary-700"
          >
            {t("medias.library.done")}
          </button>
        </>
      }
    >
      {/* Toggles */}
      <section className="flex flex-col gap-1">
        <Toggle
          checked={hideRejected}
          onChange={onHideRejectedChange}
          label={t("medias.interactive.hideRejected")}
        />
        <Toggle
          checked={showPacksOnly}
          onChange={onShowPacksOnlyChange}
          label={t("medias.interactive.packsOnly")}
        />
      </section>

      {/* Status strip */}
      {!needsSearchQuery && (
        <section className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
          <span className="text-sm font-semibold text-neutral-200">
            {t("medias.interactive.resultsVisible", {
              visible: visibleCount,
              total: totalReleases,
            })}
          </span>
          {hiddenCount > 0 && (
            <span className="rounded-md px-2 py-0.5 text-xs bg-neutral-800 text-neutral-400">
              {t("medias.interactive.hiddenCount", {
                count: hiddenCount,
              })}
            </span>
          )}
          <div className="flex min-w-0 max-w-full items-center gap-1.5 text-xs">
            <span className="shrink-0 text-neutral-400">
              {t("medias.interactive.searchPrefix", "Search:")}
            </span>
            {canSelectTitle ? (
              <SearchTitleSelect
                options={titleOptions}
                value={selectedTitleQuery}
                onSelect={onSelectTitle}
                triggerClassName="h-8 flex-1 text-xs"
              />
            ) : (
              <span
                className="truncate rounded-md px-2 py-1 font-medium bg-neutral-800 text-neutral-200"
                title={searchApiQuery}
              >
                {searchApiQuery || "…"}
              </span>
            )}
          </div>
        </section>
      )}

      {/* Season selector */}
      {isShow && availableSeasons.length > 0 && (
        <section>
          <p className="mb-2.5 text-[10px] font-semibold uppercase tracking-widest text-neutral-500">
            {t("medias.interactive.seasonSearch")}
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => onSeasonChange(null)}
              className={cn(
                "min-h-[40px] rounded-xl px-4 py-2 text-sm font-medium transition-all",
                selectedSeason === null
                  ? "bg-primary-600 text-white shadow-sm"
                  : "bg-neutral-800 text-neutral-300",
              )}
            >
              {t("medias.interactive.seasonAll")}
            </button>
            {availableSeasons.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => onSeasonChange(selectedSeason === s ? null : s)}
                className={cn(
                  "min-h-[40px] rounded-xl px-4 py-2 text-sm font-medium transition-all",
                  selectedSeason === s
                    ? "bg-primary-600 text-white shadow-sm"
                    : "bg-neutral-800 text-neutral-300",
                )}
              >
                S{String(s).padStart(2, "0")}
              </button>
            ))}
            <button
              type="button"
              onClick={() =>
                onSeasonChange(
                  selectedSeason === "complete" ? null : "complete",
                )
              }
              className={cn(
                "min-h-[40px] rounded-xl px-4 py-2 text-sm font-medium transition-all",
                selectedSeason === "complete"
                  ? "bg-violet-600 text-white shadow-sm"
                  : "bg-neutral-800 text-neutral-300",
              )}
            >
              {t("medias.interactive.completeSeries")}
            </button>
          </div>
        </section>
      )}

      {/* Sort */}
      <section>
        <p className="mb-2.5 text-[10px] font-semibold uppercase tracking-widest text-neutral-500">
          {t("medias.interactive.sortLabel")}
        </p>
        <div className="mb-3 flex flex-wrap gap-2">
          {(
            [
              "seeders",
              "age",
              "size",
              "title",
              "quality",
            ] as InteractiveSortKey[]
          ).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => onSortByChange(key)}
              className={cn(
                "min-h-[40px] rounded-xl px-3.5 py-2 text-sm font-medium transition-all",
                sortBy === key
                  ? "shadow-sm bg-neutral-100 text-neutral-900"
                  : "bg-neutral-800 text-neutral-300",
              )}
            >
              {t(`medias.interactive.sortOptions.${key}`)}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => sortDir !== "asc" && onToggleSortDir()}
            className={cn(
              "flex min-h-[40px] items-center justify-center gap-2 rounded-xl text-sm font-medium transition-all",
              sortDir === "asc"
                ? "shadow-sm bg-neutral-100 text-neutral-900"
                : "bg-neutral-800 text-neutral-300",
            )}
          >
            <ArrowDownAZ size={14} />
            {t("medias.sortDirectionAsc")}
          </button>
          <button
            type="button"
            onClick={() => sortDir !== "desc" && onToggleSortDir()}
            className={cn(
              "flex min-h-[40px] items-center justify-center gap-2 rounded-xl text-sm font-medium transition-all",
              sortDir === "desc"
                ? "shadow-sm bg-neutral-100 text-neutral-900"
                : "bg-neutral-800 text-neutral-300",
            )}
          >
            <ArrowUpZA size={14} />
            {t("medias.sortDirectionDesc")}
          </button>
        </div>
      </section>

      {/* Advanced filters */}
      <section>
        <div className="mb-2.5 flex items-center justify-between">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-neutral-500">
            {t("medias.interactive.filtersButton")}
            {totalActiveFilters > 0 && (
              <span className="ml-1.5 inline-flex h-4 w-4 items-center justify-center rounded-full bg-primary-600 text-[9px] font-bold text-white">
                {totalActiveFilters}
              </span>
            )}
          </p>
          {hasAdvancedFilters && (
            <button
              type="button"
              onClick={onClearFilters}
              className="text-[11px] font-medium text-primary-400 hover:text-primary-200"
            >
              {t("medias.interactive.clearFilters")}
            </button>
          )}
        </div>
        <div className="space-y-4 divide-y divide-neutral-800">
          <FilterSection
            title={t("medias.interactive.trackersInclude")}
            badge={includedTrackers.length}
          >
            <ChipMultiSelect
              options={trackerOptions}
              selected={includedTrackers}
              onChange={onIncludedTrackersChange}
              emptyText={t("medias.interactive.noTrackers")}
            />
          </FilterSection>
          <div className="pt-3">
            <FilterSection
              title={t("medias.interactive.trackersExclude")}
              badge={excludedTrackers.length}
            >
              <ChipMultiSelect
                options={trackerOptions}
                selected={excludedTrackers}
                onChange={onExcludedTrackersChange}
                emptyText={t("medias.interactive.noTrackers")}
              />
            </FilterSection>
          </div>
          <div className="pt-3">
            <FilterSection
              title={t("medias.interactive.languagesInclude")}
              badge={includedLanguages.length}
            >
              <ChipMultiSelect
                options={languageOptions}
                selected={includedLanguages}
                onChange={onIncludedLanguagesChange}
                emptyText={t("medias.interactive.noLanguages")}
              />
            </FilterSection>
          </div>
        </div>
      </section>
    </MobileBottomSheet>
  );
}
