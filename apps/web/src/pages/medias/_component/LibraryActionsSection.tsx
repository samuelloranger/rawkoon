import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Eye, EyeOff, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useRemoveFromLibrary } from "@/features/medias/hooks/useRemoveFromLibrary";
import { useRetrySkippedMedia } from "@/features/medias/hooks/useRetrySkippedMedia";
import { useToggleMediaMonitored } from "@/features/medias/hooks/useToggleMediaMonitored";
import { useLibraryDownloads } from "@/features/medias/hooks/useLibraryDownloads";
import { useSeeding } from "@/features/seeding/hooks/useSeeding";
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
  const confirming = deleteConfirm === "confirm";
  const { data: downloads } = useLibraryDownloads(
    confirming ? libraryId : null,
  );
  const heldHashes = new Set(
    (downloads?.items ?? [])
      .filter((i) => i.seed?.state === "seeding" && i.torrent_hash)
      .map((i) => (i.torrent_hash as string).toLowerCase()),
  );
  const { data: seeding } = useSeeding({
    enabled: confirming && heldHashes.size > 0,
  });
  const owesSeedTime = (seeding?.torrents ?? []).some(
    (s) => heldHashes.has(s.hash) && s.owes_seed_time,
  );
  const [releaseNow, setReleaseNow] = useState(false);

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
          {heldHashes.size > 0 && (
            <fieldset className="space-y-1.5">
              <legend className="text-[11px] text-red-300/80">
                {t("library.management.seedingTitle", {
                  count: heldHashes.size,
                })}
              </legend>
              {[
                {
                  value: false,
                  label: t("library.management.keepSeeding"),
                  hint: t("library.management.keepSeedingHint"),
                },
                {
                  value: true,
                  label: t("library.management.releaseNow"),
                  hint: t("library.management.releaseNowHint"),
                },
              ].map((opt) => (
                <label
                  key={String(opt.value)}
                  className="flex cursor-pointer items-start gap-2 text-xs text-red-200"
                >
                  <input
                    type="radio"
                    name={`release-${libraryId}`}
                    className="mt-0.5"
                    checked={releaseNow === opt.value}
                    onChange={() => setReleaseNow(opt.value)}
                    aria-label={opt.label}
                  />
                  <span>
                    <span className="block font-semibold">{opt.label}</span>
                    <span className="text-red-300/70">{opt.hint}</span>
                  </span>
                </label>
              ))}
              {releaseNow && owesSeedTime && (
                <p className="rounded-md border border-amber-900/70 bg-amber-950/40 px-2 py-1.5 text-[11px] text-amber-200">
                  {t("library.management.hnrWarning")}
                </p>
              )}
            </fieldset>
          )}

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
                    releaseTorrents: releaseNow && heldHashes.size > 0,
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
