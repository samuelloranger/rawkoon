import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Eye, EyeOff, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useRemoveFromLibrary } from "@/features/medias/hooks/useRemoveFromLibrary";
import { useRetrySkippedMedia } from "@/features/medias/hooks/useRetrySkippedMedia";
import { useToggleMediaMonitored } from "@/features/medias/hooks/useToggleMediaMonitored";
import { Button } from "@/components/ui/button";
import { Card } from "./LibrarySharedUI";

interface LibraryActionsSectionProps {
  libraryId: number;
  itemStatus?: string;
  itemMonitored?: boolean;
  onDeleted?: () => void;
}

export function LibraryActionsSection({
  libraryId,
  itemStatus,
  itemMonitored = true,
  onDeleted,
}: LibraryActionsSectionProps) {
  const { t } = useTranslation("common");
  const removeMutation = useRemoveFromLibrary();
  const retryMutation = useRetrySkippedMedia();
  const toggleMonitoredMutation = useToggleMediaMonitored();
  const [deleteConfirm, setDeleteConfirm] = useState<"idle" | "confirm">(
    "idle",
  );
  const [deleteFiles, setDeleteFiles] = useState(true);

  if (deleteConfirm === "confirm") {
    return (
      <Card className="border-red-800/60 bg-red-950/10">
        <div className="px-4 py-3 space-y-3">
          <p className="text-xs font-semibold text-red-300">
            {t("library.management.deleteConfirmTitle")}
          </p>
          <label className="flex items-center gap-2 text-xs text-red-300 cursor-pointer">
            <input
              type="checkbox"
              checked={deleteFiles}
              onChange={(e) => setDeleteFiles(e.target.checked)}
              className="rounded border-red-300"
            />
            {t("library.management.deleteFilesLabel")}
          </label>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="destructive"
              size="sm"
              disabled={removeMutation.isPending}
              onClick={async () => {
                try {
                  await removeMutation.mutateAsync({
                    id: libraryId,
                    deleteFiles,
                  });
                  onDeleted?.();
                } catch {
                  // mutation error handled by hook
                }
              }}
              className="gap-1"
            >
              <Trash2 size={10} />
              {removeMutation.isPending
                ? t("library.management.deleting")
                : t("library.management.deleteConfirm")}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setDeleteConfirm("idle")}
            >
              {t("common.cancel")}
            </Button>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <div className="flex items-center justify-end gap-2 px-4 py-2">
      <button
        type="button"
        title={
          itemMonitored
            ? t("library.management.unmonitor")
            : t("library.management.monitor")
        }
        disabled={toggleMonitoredMutation.isPending}
        onClick={() => {
          void toggleMonitoredMutation
            .mutateAsync({ id: libraryId, monitored: !itemMonitored })
            .catch(() => toast.error(t("library.management.grabFailed")));
        }}
        className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-neutral-400 hover:bg-neutral-800 disabled:opacity-50 transition-colors"
      >
        {itemMonitored ? <Eye size={11} /> : <EyeOff size={11} />}
        {itemMonitored
          ? t("library.management.unmonitor")
          : t("library.management.monitor")}
      </button>
      {itemStatus === "skipped" && (
        <button
          type="button"
          title={t("library.management.retrySearchTitle")}
          disabled={retryMutation.isPending}
          onClick={() => {
            void retryMutation
              .mutateAsync({ mediaId: libraryId })
              .then(() =>
                toast.success(t("library.management.retrySearchQueued")),
              )
              .catch(() => toast.error(t("library.management.grabFailed")));
          }}
          className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800 disabled:opacity-50 transition-colors"
        >
          <RefreshCw size={11} />
          {t("library.management.retrySearch")}
        </button>
      )}
      <button
        type="button"
        onClick={() => setDeleteConfirm("confirm")}
        className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-red-400 hover:bg-red-950/30 transition-colors"
      >
        <Trash2 size={11} />
        {t("library.management.delete")}
      </button>
    </div>
  );
}
