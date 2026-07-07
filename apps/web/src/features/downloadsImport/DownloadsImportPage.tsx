import { useCallback, useState } from "react";
import type { DownloadListRow } from "@/features/downloadsImport/hooks/useDownloadsImport";
import type { TmdbMediaSearchItem } from "@rawkoon/shared/types";
import { Download, RotateCw, Search } from "lucide-react";
import { useTranslation } from "react-i18next";
import { PageLayout } from "@/components/PageLayout";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useDownloadsImport } from "@/features/downloadsImport/hooks/useDownloadsImport";
import { useStagedQueue } from "@/features/downloadsImport/hooks/useStagedQueue";
import { DownloadsTable } from "@/features/downloadsImport/components/DownloadsTable";
import { StagedQueueFooter } from "@/features/downloadsImport/components/StagedQueueFooter";

export function DownloadsImportPage() {
  const { t } = useTranslation("common");
  const { data, isLoading, isFetching, error, hardRefresh } =
    useDownloadsImport();
  const queue = useStagedQueue();

  const [popoverPath, setPopoverPath] = useState<string | null>(null);

  const { stageFromTmdbPick } = queue;
  const handlePick = useCallback(
    (row: DownloadListRow, item: TmdbMediaSearchItem) => {
      stageFromTmdbPick(row, item);
      setPopoverPath(null);
    },
    [stageFromTmdbPick],
  );

  const items = data?.items ?? [];
  const stagedCount = Object.keys(queue.stagedByPath).length;

  return (
    <PageLayout className="pb-28">
      <PageHeader
        icon={Search}
        title={t("downloadsImport.title")}
        subtitle={t("downloadsImport.subtitle")}
        actions={
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={isFetching}
            className="gap-1"
            onClick={() => hardRefresh()}
          >
            <RotateCw
              className={cn("h-3.5 w-3.5", isFetching && "animate-spin")}
            />
            {t("downloadsImport.refresh")}
          </Button>
        }
      />

      {error && (
        <div className="mb-4 rounded-xl border px-3 py-2 text-sm border-red-900 bg-red-950/40 text-red-300">
          {(error as Error).message ?? t("downloadsImport.loadError")}
          <Button
            className="ml-2 align-middle"
            size="sm"
            variant="outline"
            onClick={() => hardRefresh()}
          >
            {t("downloadsImport.retryFreshScan")}
          </Button>
        </div>
      )}

      {isLoading && (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div
              key={i}
              className="h-10 rounded-lg animate-pulse bg-white/10"
            />
          ))}
        </div>
      )}

      {!isLoading && !error && items.length === 0 && (
        <EmptyState
          icon={Download}
          title={t("downloadsImport.empty.title", {
            defaultValue: "No video files in Downloads folder",
          })}
          description={t("downloadsImport.empty.description", {
            defaultValue:
              "Confirm Movies and TV library folders in Settings → Media.",
          })}
        />
      )}

      {!isLoading && items.length > 0 && (
        <DownloadsTable
          items={items}
          stagedByPath={queue.stagedByPath}
          rowPhase={queue.rowPhase}
          rowError={queue.rowError}
          popoverPath={popoverPath}
          onSetPopoverPath={setPopoverPath}
          onPick={handlePick}
          onUnstage={queue.unstage}
          onRetry={queue.retryRow}
          batchRunning={queue.batch.phase === "running"}
        />
      )}

      <StagedQueueFooter
        stagedCount={stagedCount}
        batch={queue.batch}
        isMutating={queue.isMutating}
        onClear={queue.clearStagedAll}
        onSubmit={queue.runSubmit}
        onCancel={queue.cancelRun}
        onDismiss={queue.dismissDone}
      />
    </PageLayout>
  );
}
