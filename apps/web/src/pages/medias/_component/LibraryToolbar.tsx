import { type ComponentType } from "react";
import { useTranslation } from "react-i18next";
import {
  Search as SearchIcon,
  ArrowUpAZ,
  ArrowDownAZ,
  LayoutGrid,
  Grid3X3,
  List,
  SlidersHorizontal,
  X,
} from "lucide-react";
import {
  SegmentedTabs,
  type SegmentedTabItem,
} from "@/components/ui/segmented-tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  type FilterType,
  type FilterStatus,
  type SortKey,
  type SortDir,
  type ViewMode,
  LIBRARY_SORT_KEYS,
} from "@/utils/libraryUtils";

interface ToolbarFilterItem {
  id: string;
  label: string;
  icon?: ComponentType<{ size?: number; className?: string }>;
}

interface LibraryToolbarProps {
  search: string;
  typeFilter: FilterType;
  statusFilter: FilterStatus;
  languageFilter: string;
  sortBy: SortKey;
  sortDir: SortDir;
  viewMode: ViewMode;
  languageTags: string[];
  typeItems: ToolbarFilterItem[];
  statusItems: ToolbarFilterItem[];
  activeFilterCount: number;
  onSearchChange: (value: string) => void;
  onTypeChange: (value: FilterType) => void;
  onStatusChange: (value: FilterStatus) => void;
  onLanguageChange: (value: string) => void;
  onSortByChange: (value: SortKey) => void;
  onSortDirToggle: () => void;
  onViewModeChange: (value: ViewMode) => void;
  onOpenMobileSheet: () => void;
}

export function LibraryToolbar({
  search,
  typeFilter,
  statusFilter,
  languageFilter,
  sortBy,
  sortDir,
  viewMode,
  languageTags,
  typeItems,
  statusItems,
  activeFilterCount,
  onSearchChange,
  onTypeChange,
  onStatusChange,
  onLanguageChange,
  onSortByChange,
  onSortDirToggle,
  onViewModeChange,
  onOpenMobileSheet,
}: LibraryToolbarProps) {
  const { t } = useTranslation("common");

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="relative w-full sm:w-auto">
          <SearchIcon
            size={13}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400 pointer-events-none"
          />
          <input
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder={t("medias.library.searchPlaceholder")}
            className="w-full sm:w-80 rounded-xl border border-neutral-700 bg-neutral-900 pl-8 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/40 focus:border-primary-500 transition"
          />
        </div>

        {/* Sort */}
        <div className="hidden sm:flex items-center gap-1.5 ml-auto">
          <Select
            value={sortBy}
            onValueChange={(value) => onSortByChange(value as SortKey)}
          >
            <SelectTrigger className="h-8 w-auto rounded-xl border-neutral-700 bg-neutral-900 px-2.5 py-1.5 text-xs text-neutral-300">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LIBRARY_SORT_KEYS.map((key) => (
                <SelectItem key={key} value={key} className="text-xs">
                  {t(`medias.library.sort.${key}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <button
            type="button"
            onClick={onSortDirToggle}
            className="rounded-xl border border-neutral-700 bg-neutral-900 p-1.5 text-neutral-500 hover:text-neutral-300 transition-colors"
            title={
              sortDir === "asc"
                ? t("medias.sortDirectionAsc")
                : t("medias.sortDirectionDesc")
            }
          >
            {sortDir === "asc" ? (
              <ArrowUpAZ size={14} />
            ) : (
              <ArrowDownAZ size={14} />
            )}
          </button>

          {/* View mode toggle */}
          <div className="flex items-center rounded-xl border border-neutral-700 bg-neutral-900 overflow-hidden">
            {(
              [
                {
                  mode: "grid" as ViewMode,
                  Icon: LayoutGrid,
                  label: "Grid",
                },
                {
                  mode: "compact" as ViewMode,
                  Icon: Grid3X3,
                  label: "Compact",
                },
                { mode: "list" as ViewMode, Icon: List, label: "List" },
              ] as const
            ).map(({ mode, Icon, label }) => (
              <button
                key={mode}
                type="button"
                onClick={() => onViewModeChange(mode)}
                title={label}
                className={cn(
                  "p-1.5 transition-colors",
                  viewMode === mode
                    ? "bg-neutral-800 text-neutral-200"
                    : "text-neutral-400 hover:text-neutral-300",
                )}
              >
                <Icon size={14} />
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Mobile: filter sheet trigger + view mode toggle */}
      <div className="flex flex-col gap-2 sm:hidden">
        <div className="flex items-center gap-2">
          {/* Filters button */}
          <button
            type="button"
            onClick={onOpenMobileSheet}
            className="relative flex h-9 items-center gap-1.5 rounded-xl border px-3 text-sm font-medium transition-colors border-neutral-700 bg-neutral-900 text-neutral-300"
          >
            <SlidersHorizontal size={13} />
            {t("medias.library.filtersButton")}
            {activeFilterCount > 0 && (
              <span className="absolute -right-1.5 -top-1.5 flex size-4 items-center justify-center rounded-full bg-primary-600 text-[9px] font-bold leading-none text-neutral-950">
                {activeFilterCount}
              </span>
            )}
          </button>

          {/* Sort chip */}
          <button
            type="button"
            onClick={onOpenMobileSheet}
            className="flex h-9 items-center gap-1.5 rounded-xl border px-3 text-xs transition-colors border-neutral-700 bg-neutral-900 text-neutral-400"
          >
            {sortDir === "asc" ? (
              <ArrowUpAZ size={12} />
            ) : (
              <ArrowDownAZ size={12} />
            )}
            {t(`medias.library.sort.${sortBy}`)}
          </button>

          <div className="flex-1" />

          {/* View mode toggle */}
          <div className="flex overflow-hidden rounded-xl border border-neutral-700 bg-neutral-900">
            {(
              [
                { mode: "grid" as ViewMode, Icon: LayoutGrid },
                { mode: "compact" as ViewMode, Icon: Grid3X3 },
                { mode: "list" as ViewMode, Icon: List },
              ] as const
            ).map(({ mode, Icon }) => (
              <button
                key={mode}
                type="button"
                onClick={() => onViewModeChange(mode)}
                className={cn(
                  "flex h-9 w-9 items-center justify-center transition-colors",
                  viewMode === mode
                    ? "bg-neutral-800 text-neutral-200"
                    : "text-neutral-400 hover:text-neutral-300",
                )}
              >
                <Icon size={14} />
              </button>
            ))}
          </div>
        </div>

        {/* Active filter chips */}
        {activeFilterCount > 0 && (
          <div className="no-scrollbar flex gap-1.5 overflow-x-auto pb-0.5">
            {typeFilter !== "all" && (
              <button
                type="button"
                onClick={() => onTypeChange("all")}
                className="flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium border-primary-800 bg-primary-900/30 text-primary-300"
              >
                {typeItems.find((i) => i.id === typeFilter)?.label}
                <X size={10} />
              </button>
            )}
            {statusFilter !== "all" && (
              <button
                type="button"
                onClick={() => onStatusChange("all")}
                className="flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium border-primary-800 bg-primary-900/30 text-primary-300"
              >
                {statusItems.find((i) => i.id === statusFilter)?.label}
                <X size={10} />
              </button>
            )}
            {languageFilter !== "all" && (
              <button
                type="button"
                onClick={() => onLanguageChange("all")}
                className="flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium border-primary-800 bg-primary-900/30 text-primary-300"
              >
                {languageFilter}
                <X size={10} />
              </button>
            )}
          </div>
        )}
      </div>

      <div className="hidden sm:flex sm:items-center sm:gap-3 sm:flex-wrap">
        <SegmentedTabs<FilterType>
          variant="chips"
          containerClassName="w-auto shrink-0"
          ariaLabel={t("medias.library.typeAll")}
          items={typeItems as SegmentedTabItem<FilterType>[]}
          value={typeFilter}
          onChange={onTypeChange}
        />
        <div className="h-4 w-px shrink-0 bg-neutral-700" />
        <SegmentedTabs<FilterStatus>
          variant="chips"
          containerClassName="w-auto shrink-0"
          ariaLabel={t("medias.library.statusAll")}
          items={statusItems as SegmentedTabItem<FilterStatus>[]}
          value={statusFilter}
          onChange={onStatusChange}
        />
        {languageTags.length > 0 && (
          <>
            <div className="h-4 w-px shrink-0 bg-neutral-700" />
            <Select value={languageFilter} onValueChange={onLanguageChange}>
              <SelectTrigger
                aria-label={t("medias.library.languageAll")}
                className="h-8 w-auto rounded-lg border-neutral-700 bg-neutral-900 px-3 py-1.5 text-xs"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all" className="text-xs">
                  {t("medias.library.languageAll")}
                </SelectItem>
                {languageTags.map((tag) => (
                  <SelectItem key={tag} value={tag} className="text-xs">
                    {tag}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </>
        )}
      </div>
    </div>
  );
}
