import { type ComponentType } from "react";
import { ArrowUpAZ, ArrowDownAZ } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";
import type {
  FilterType,
  FilterStatus,
  SortKey,
  SortDir,
} from "@/utils/libraryUtils";
import { LIBRARY_SORT_KEYS } from "@/utils/libraryUtils";
import { MobileBottomSheet } from "./MobileBottomSheet";

interface FilterItem {
  id: string;
  label: string;
  icon?: ComponentType<{ size?: number; className?: string }>;
}

interface LibraryMobileFilterSheetProps {
  open: boolean;
  onClose: () => void;
  typeFilter: FilterType;
  statusFilter: FilterStatus;
  languageFilter: string;
  sortBy: SortKey;
  sortDir: SortDir;
  languageTags: string[];
  typeItems: FilterItem[];
  statusItems: FilterItem[];
  onTypeChange: (value: FilterType) => void;
  onStatusChange: (value: FilterStatus) => void;
  onLanguageChange: (value: string) => void;
  onSortByChange: (value: SortKey) => void;
  onSortDirChange: (value: SortDir) => void;
  onReset: () => void;
}

export function LibraryMobileFilterSheet({
  open,
  onClose,
  typeFilter,
  statusFilter,
  languageFilter,
  sortBy,
  sortDir,
  languageTags,
  typeItems,
  statusItems,
  onTypeChange,
  onStatusChange,
  onLanguageChange,
  onSortByChange,
  onSortDirChange,
  onReset,
}: LibraryMobileFilterSheetProps) {
  const { t } = useTranslation("common");

  const hasActiveFilters =
    typeFilter !== "all" || statusFilter !== "all" || languageFilter !== "all";

  return (
    <MobileBottomSheet
      open={open}
      onClose={onClose}
      title={t("medias.library.filtersTitle")}
      closeLabel={t("common.close")}
      bodyClassName="space-y-6"
      footer={
        <>
          {hasActiveFilters && (
            <button
              type="button"
              onClick={onReset}
              className="text-sm text-neutral-400 transition-colors hover:text-neutral-300"
            >
              {t("common.clear")}
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="ml-auto rounded-xl bg-primary-600 px-6 py-2.5 text-sm font-semibold text-neutral-950 transition-colors hover:bg-primary-500"
          >
            {t("medias.library.done")}
          </button>
        </>
      }
    >
      {/* Type */}
      <section>
        <p className="mb-2.5 text-[10px] font-semibold uppercase tracking-widest text-neutral-500">
          {t("medias.library.typeSection")}
        </p>
        <div className="flex flex-wrap gap-2">
          {typeItems.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => onTypeChange(id as FilterType)}
              className={cn(
                "flex min-h-[40px] items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium transition-all",
                typeFilter === id
                  ? "bg-primary-600 text-neutral-950 shadow-sm"
                  : "bg-neutral-800 text-neutral-300",
              )}
            >
              {Icon && <Icon size={14} />}
              {label}
            </button>
          ))}
        </div>
      </section>

      {/* Status */}
      <section>
        <p className="mb-2.5 text-[10px] font-semibold uppercase tracking-widest text-neutral-500">
          {t("medias.library.statusSection")}
        </p>
        <div className="flex flex-wrap gap-2">
          {statusItems.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => onStatusChange(id as FilterStatus)}
              className={cn(
                "flex min-h-[40px] items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium transition-all",
                statusFilter === id
                  ? "bg-primary-600 text-neutral-950 shadow-sm"
                  : "bg-neutral-800 text-neutral-300",
              )}
            >
              {Icon && <Icon size={14} />}
              {label}
            </button>
          ))}
        </div>
      </section>

      {/* Language — only shown when tags are present */}
      {languageTags.length > 0 && (
        <section>
          <p className="mb-2.5 text-[10px] font-semibold uppercase tracking-widest text-neutral-500">
            {t("medias.library.languageAll")}
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => onLanguageChange("all")}
              className={cn(
                "min-h-[40px] rounded-xl px-4 py-2 text-sm font-medium transition-all",
                languageFilter === "all"
                  ? "bg-primary-600 text-neutral-950 shadow-sm"
                  : "bg-neutral-800 text-neutral-300",
              )}
            >
              {t("medias.library.languageOptionAll")}
            </button>
            {languageTags.map((tag) => (
              <button
                key={tag}
                type="button"
                onClick={() => onLanguageChange(tag)}
                className={cn(
                  "min-h-[40px] rounded-xl px-4 py-2 text-sm font-medium transition-all",
                  languageFilter === tag
                    ? "bg-primary-600 text-neutral-950 shadow-sm"
                    : "bg-neutral-800 text-neutral-300",
                )}
              >
                {tag}
              </button>
            ))}
          </div>
        </section>
      )}

      {/* Sort */}
      <section>
        <p className="mb-2.5 text-[10px] font-semibold uppercase tracking-widest text-neutral-500">
          {t("medias.library.sortSection")}
        </p>
        <div className="mb-3 flex flex-wrap gap-2">
          {LIBRARY_SORT_KEYS.map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => onSortByChange(key)}
              className={cn(
                "min-h-[40px] rounded-xl px-3.5 py-2 text-sm font-medium transition-all",
                sortBy === key
                  ? "shadow-sm bg-primary-600 text-neutral-950"
                  : "bg-neutral-800 text-neutral-300",
              )}
            >
              {t(`medias.library.sort.${key}`)}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => onSortDirChange("asc")}
            className={cn(
              "flex min-h-[40px] items-center justify-center gap-2 rounded-xl text-sm font-medium transition-all",
              sortDir === "asc"
                ? "shadow-sm bg-primary-600 text-neutral-950"
                : "bg-neutral-800 text-neutral-300",
            )}
          >
            <ArrowUpAZ size={14} />
            {t("medias.sortDirectionAsc")}
          </button>
          <button
            type="button"
            onClick={() => onSortDirChange("desc")}
            className={cn(
              "flex min-h-[40px] items-center justify-center gap-2 rounded-xl text-sm font-medium transition-all",
              sortDir === "desc"
                ? "shadow-sm bg-primary-600 text-neutral-950"
                : "bg-neutral-800 text-neutral-300",
            )}
          >
            <ArrowDownAZ size={14} />
            {t("medias.sortDirectionDesc")}
          </button>
        </div>
      </section>
    </MobileBottomSheet>
  );
}
