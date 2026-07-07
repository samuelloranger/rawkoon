import { useTranslation } from "react-i18next";
import { TriangleAlert, X } from "lucide-react";
import type { LabeledTitleOption } from "@/lib/utils/interactive-search";
import type { IndexerWarning } from "@rawkoon/shared/types";
import { SearchTitleSelect } from "./SearchTitleSelect";

interface InteractiveSearchStatusStripProps {
  indexerWarnings: IndexerWarning[];
  dismissed: boolean;
  onDismiss: () => void;
  hiddenCount: number;
  hasViewOverrides: boolean;
  onResetView: () => void;
  visibleCount: number;
  totalReleases: number;
  isSearchMode: boolean;
  searchApiQuery: string;
  canSelectTitle: boolean;
  titleOptions: LabeledTitleOption[];
  selectedTitleQuery: string;
  onSelectTitle: (query: string) => void;
}

export function InteractiveSearchStatusStrip({
  indexerWarnings,
  dismissed,
  onDismiss,
  hiddenCount,
  hasViewOverrides,
  onResetView,
  visibleCount,
  totalReleases,
  isSearchMode,
  searchApiQuery,
  canSelectTitle,
  titleOptions,
  selectedTitleQuery,
  onSelectTitle,
}: InteractiveSearchStatusStripProps) {
  const { t } = useTranslation("common");

  return (
    <>
      {indexerWarnings.length > 0 && !dismissed && (
        <div
          role="alert"
          className="mb-3 flex items-start gap-3 rounded-xl border px-4 py-3 text-sm border-amber-700/40 bg-amber-950/20"
        >
          <TriangleAlert size={15} className="mt-0.5 shrink-0 text-amber-400" />
          <div className="min-w-0 flex-1">
            <span className="font-medium text-amber-200">
              {indexerWarnings.length === 1
                ? t("medias.interactive.indexerWarning.single", {
                    name: indexerWarnings[0].name,
                  })
                : t("medias.interactive.indexerWarning.multiple", {
                    count: indexerWarnings.length,
                    names: indexerWarnings.map((w) => w.name).join(", "),
                  })}
            </span>
            <span className="ml-1 text-amber-300">
              {t("medias.interactive.indexerWarning.hint")}
            </span>
          </div>
          <button
            type="button"
            onClick={onDismiss}
            className="shrink-0 transition-colors text-amber-400 hover:text-amber-200"
            aria-label={t("medias.interactive.indexerWarning.dismiss")}
          >
            <X size={14} />
          </button>
        </div>
      )}

      {/* Desktop results count + query pill — hidden on mobile (mobile uses drawer) */}
      {isSearchMode && searchApiQuery.length >= 2 && (
        <div className="mb-3 hidden flex-wrap items-center gap-x-2.5 gap-y-1 sm:flex">
          <span className="text-xs font-semibold text-neutral-200">
            {t("medias.interactive.resultsVisible", {
              visible: visibleCount,
              total: totalReleases,
            })}
          </span>
          {hiddenCount > 0 && (
            <span className="rounded-md px-2 py-0.5 text-[11px] bg-neutral-800 text-neutral-400">
              {t("medias.interactive.hiddenCount", {
                count: hiddenCount,
              })}
            </span>
          )}
          {hasViewOverrides && (
            <button
              type="button"
              onClick={onResetView}
              className="text-xs font-medium transition-colors text-primary-400 hover:text-primary-200"
            >
              {t("medias.interactive.resetView")}
            </button>
          )}
          <span className="flex min-w-0 max-w-[320px] items-center gap-1.5 text-[11px]">
            <span className="shrink-0 text-neutral-400">
              {t("medias.interactive.searchPrefix", "Search:")}
            </span>
            {canSelectTitle ? (
              <SearchTitleSelect
                options={titleOptions}
                value={selectedTitleQuery}
                onSelect={onSelectTitle}
                triggerClassName="max-w-[220px]"
              />
            ) : (
              <span
                className="truncate rounded-md px-2 py-0.5 font-medium bg-neutral-800 text-neutral-200"
                title={searchApiQuery}
              >
                {searchApiQuery || "…"}
              </span>
            )}
          </span>
        </div>
      )}
    </>
  );
}
