import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import type { BatchState } from "@/features/downloadsImport/hooks/useStagedQueue";

export function StagedQueueFooter({
  stagedCount,
  batch,
  isMutating,
  onClear,
  onSubmit,
  onCancel,
  onDismiss,
}: {
  stagedCount: number;
  batch: BatchState;
  isMutating: boolean;
  onClear: () => void;
  onSubmit: () => void;
  onCancel: () => void;
  onDismiss: () => void;
}) {
  const { t } = useTranslation("common");
  if (stagedCount === 0 && batch.phase === "idle") return null;
  return (
    <div className="fixed bottom-4 left-1/2 z-40 w-[calc(100%-2rem)] max-w-4xl -translate-x-1/2 rounded-xl border px-4 py-3 shadow-lg backdrop-blur border-neutral-700 bg-neutral-900/95 space-y-2">
      {batch.phase === "idle" && (
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <span>
            {t("downloadsImport.footer.staged", { count: stagedCount })}
          </span>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onClear}
              disabled={isMutating}
            >
              {t("downloadsImport.footer.clear")}
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={onSubmit}
              disabled={isMutating}
            >
              {t("downloadsImport.footer.submit")}
            </Button>
          </div>
        </div>
      )}
      {batch.phase === "running" && (
        <div className="space-y-1 text-sm">
          <div className="flex justify-between">
            <span>
              {t("downloadsImport.footer.processing", {
                processed: batch.processed,
                total: batch.total,
              })}
            </span>
            <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
              {t("downloadsImport.footer.cancel")}
            </Button>
          </div>
          <div className="h-2 w-full rounded-full overflow-hidden bg-white/15">
            <div
              className="h-2 rounded-full bg-primary-600 transition-all"
              style={{
                width: `${batch.total ? (100 * batch.processed) / batch.total : 0}%`,
              }}
            />
          </div>
        </div>
      )}
      {batch.phase === "done" && (
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <span>
            {batch.failures
              ? t("downloadsImport.footer.doneWithFailures", {
                  succeeded: batch.successes,
                  failed: batch.failures,
                })
              : t("downloadsImport.footer.doneSuccess", {
                  succeeded: batch.successes,
                })}
          </span>
          <Button size="sm" variant="outline" onClick={onDismiss}>
            {t("downloadsImport.footer.dismiss")}
          </Button>
        </div>
      )}
    </div>
  );
}
