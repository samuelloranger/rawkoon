import { useTranslation } from "react-i18next";
import { RefreshCw, TriangleAlert } from "lucide-react";
import type { InteractiveReleaseItem } from "@rawkoon/shared/types";
import { ReleaseCard } from "./ReleaseCard";
import { Button } from "@/components/ui/button";

interface InteractiveSearchResultsListProps {
  releases: InteractiveReleaseItem[];
  isLoading: boolean;
  needsSearchQuery: boolean;
  errorMessage: string | null;
  grabBusy: boolean;
  pendingReleaseKey: string | null;
  grabbedTitles: Set<string>;
  onDownload: (release: InteractiveReleaseItem) => void;
  onBlock?: (release: InteractiveReleaseItem) => void;
  blockingReleaseKey?: string | null;
  blockedTitles?: Set<string>;
  onRefetch: () => void;
  totalReleases: number;
  isError: boolean;
  onResetView: () => void;
  aiPickKey?: string | null;
}

export function InteractiveSearchResultsList({
  releases,
  isLoading,
  needsSearchQuery,
  errorMessage,
  grabBusy,
  pendingReleaseKey,
  grabbedTitles,
  onDownload,
  onBlock,
  blockingReleaseKey,
  blockedTitles,
  onRefetch,
  totalReleases,
  isError,
  onResetView,
  aiPickKey,
}: InteractiveSearchResultsListProps) {
  const { t } = useTranslation("common");

  return (
    <div className="pt-4">
      {needsSearchQuery ? (
        <div className="flex h-full items-center justify-center py-8">
          <div className="max-w-md text-center text-sm text-neutral-400">
            {t("medias.interactive.minQuery")}
          </div>
        </div>
      ) : isLoading ? (
        <div className="flex h-full items-center justify-center py-8">
          <div className="text-sm text-neutral-400">
            {t("medias.interactive.loading")}
          </div>
        </div>
      ) : isError ? (
        <div className="flex h-full items-center justify-center py-8">
          <div className="max-w-md rounded-2xl border p-5 text-center border-amber-700/40 bg-amber-950/20">
            <div className="mx-auto mb-3 inline-flex h-10 w-10 items-center justify-center rounded-full bg-amber-900/40 text-amber-300">
              <TriangleAlert size={18} />
            </div>
            <p className="text-sm font-semibold text-neutral-100">
              {t("medias.interactive.errorTitle")}
            </p>
            <p className="mt-1 text-sm text-neutral-400">
              {errorMessage ?? t("medias.interactive.errorDescription")}
            </p>
            <Button type="button" onClick={onRefetch} className="mt-4 gap-2">
              <RefreshCw size={14} />
              {t("medias.interactive.retry")}
            </Button>
          </div>
        </div>
      ) : releases.length === 0 ? (
        <div className="flex h-full items-center justify-center py-8">
          <div className="max-w-md text-center">
            <p className="text-sm font-medium text-neutral-200">
              {totalReleases > 0
                ? t("medias.interactive.noMatches")
                : t("medias.interactive.empty")}
            </p>
            {totalReleases > 0 && (
              <button
                type="button"
                onClick={onResetView}
                className="mt-3 text-sm font-medium transition-colors text-primary-400 hover:text-primary-200"
              >
                {t("medias.interactive.resetView")}
              </button>
            )}
          </div>
        </div>
      ) : (
        <div>
          <div className="space-y-2">
            {releases.map((release) => {
              const releaseKey = `${release.guid}-${release.indexer_id ?? "x"}`;
              return (
                <ReleaseCard
                  key={releaseKey}
                  release={release}
                  onDownload={() => void onDownload(release)}
                  onBlock={onBlock ? () => void onBlock(release) : undefined}
                  isDownloading={pendingReleaseKey === releaseKey}
                  isBusy={grabBusy}
                  isBlocking={blockingReleaseKey === releaseKey}
                  blocked={
                    blockedTitles?.has(release.title.trim().toLowerCase()) ??
                    false
                  }
                  alreadyGrabbed={grabbedTitles.has(
                    release.title.trim().toLowerCase(),
                  )}
                  isAiPick={aiPickKey != null && release.guid === aiPickKey}
                  t={t}
                />
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
