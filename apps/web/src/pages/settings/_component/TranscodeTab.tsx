import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useConfirm } from "@/components/confirm/ConfirmContext";
import { Switch } from "@/components/ui/switch";
import { formatBytes, formatDuration } from "@/features/transcode/format";
import {
  useTranscodeJobAction,
  useTranscodeJobs,
  useTranscodeSettings,
  useTranscodeSummary,
  useUpdateTranscodeSettings,
} from "@/features/transcode/hooks";
import { TranscodeAdvancedSettings } from "./TranscodeAdvancedSettings";
import { TranscodeHistoryTable } from "./TranscodeHistoryTable";
import { TranscodeQueueTable } from "./TranscodeQueueTable";
import { TranscodeRunningCard } from "./TranscodeRunningCard";
import { TranscodeStat as Stat } from "./TranscodeStat";

export function TranscodeTab() {
  const { t } = useTranslation("common");
  const active = useTranscodeJobs("active").data?.jobs ?? [];
  const history = useTranscodeJobs("history").data?.jobs ?? [];
  const settings = useTranscodeSettings().data;
  const summary = useTranscodeSummary(true).data;
  const update = useUpdateTranscodeSettings();
  const act = useTranscodeJobAction();
  const [dragId, setDragId] = useState<number | null>(null);

  const running = active.find((j) => j.status === "running") ?? null;
  const queued = active.filter((j) => j.status === "queued");

  const { confirm } = useConfirm();

  const freeSource = async (id: number, title: string) => {
    // The private-tracker warning needs the server's view of what would go.
    const preview = await act.previewFreeSource(id).catch(() => null);
    confirm({
      variant: "destructive",
      title: t("transcode.admin.freeSource.title"),
      description: (
        <>
          <p>{t("transcode.admin.freeSource.description", { title })}</p>
          {preview && preview.private_unmet > 0 && (
            <p className="mt-2 font-medium text-amber-200">
              {t("transcode.admin.freeSource.privateWarning", {
                count: preview.private_unmet,
              })}
            </p>
          )}
        </>
      ),
      confirmLabel: t("transcode.admin.freeSource.confirm"),
      onConfirm: async () => {
        try {
          const r = await act.freeSource(id);
          toast.success(
            r.torrents > 0
              ? t("transcode.admin.freeSource.done", {
                  count: r.torrents,
                  size: formatBytes(r.freed_bytes),
                })
              : t("transcode.admin.freeSource.nothing"),
          );
        } catch {
          toast.error(t("transcode.admin.actionFailed"));
        }
      },
    });
  };

  const discard = (id: number, title: string) =>
    confirm({
      variant: "destructive",
      title: t("transcode.admin.discard.title"),
      description: t("transcode.admin.discard.description", { title }),
      confirmLabel: t("transcode.admin.discard.confirm"),
      onConfirm: async () => {
        try {
          await act.discard(id);
          toast.success(t("transcode.admin.discard.done"));
        } catch {
          toast.error(t("transcode.admin.actionFailed"));
        }
      },
    });

  const safe = (p: Promise<unknown>) =>
    p.catch(() => toast.error(t("transcode.admin.actionFailed")));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2.5">
        <span className="flex-1" />
        {settings && (
          <label className="flex items-center gap-2 text-[13px] text-neutral-400">
            <Switch
              checked={settings.window_enabled}
              onCheckedChange={(v: boolean) =>
                update.mutate({ window_enabled: v })
              }
              aria-label={t("transcode.admin.runWindow")}
            />
            {t("transcode.admin.runWindow")}
            <input
              type="time"
              value={settings.window_start}
              aria-label="start"
              onChange={(e) => update.mutate({ window_start: e.target.value })}
              className="rounded-lg border border-neutral-800 bg-neutral-950 px-2 py-1 text-neutral-50"
            />
            –
            <input
              type="time"
              value={settings.window_end}
              aria-label="end"
              onChange={(e) => update.mutate({ window_end: e.target.value })}
              className="rounded-lg border border-neutral-800 bg-neutral-950 px-2 py-1 text-neutral-50"
            />
          </label>
        )}
        {settings && (
          <button
            type="button"
            onClick={() => update.mutate({ paused: !settings.paused })}
            className="rounded-lg border border-neutral-700 px-3 py-1.5 text-[13px] font-semibold text-neutral-200 hover:bg-neutral-900"
          >
            {settings.paused
              ? t("transcode.admin.resume")
              : t("transcode.admin.pause")}
          </button>
        )}
      </div>

      {summary && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat
            label={t("transcode.admin.stats.queued")}
            value={String(summary.queued_count)}
            hint={t("transcode.admin.statsQueuedHint", {
              time: formatDuration(summary.queued_eta_secs),
              size: formatBytes(summary.queued_source_bytes),
            })}
          />
          <Stat
            label={t("transcode.admin.stats.saved")}
            value={formatBytes(summary.saved_bytes_30d)}
            tone="text-emerald-300"
            hint={t("transcode.admin.statsSavedHint", {
              count: summary.done_count_30d,
            })}
          />
          <Stat
            label={t("transcode.admin.stats.afterSeeding")}
            value={formatBytes(summary.frees_after_seeding_bytes)}
            hint={t("transcode.admin.statsSeedHint")}
          />
          <Stat
            label={t("transcode.admin.stats.failed")}
            value={String(summary.failed_count)}
            tone="text-red-400"
            hint={t("transcode.admin.statsFailedHint")}
          />
        </div>
      )}

      {running && (
        <TranscodeRunningCard
          running={running}
          onCancel={() => safe(act.cancel(running.id))}
        />
      )}

      <TranscodeQueueTable
        queued={queued}
        act={act}
        safe={safe}
        dragId={dragId}
        setDragId={setDragId}
      />

      <TranscodeHistoryTable
        history={history}
        act={act}
        safe={safe}
        freeSource={freeSource}
        discard={discard}
      />

      {settings && (
        <TranscodeAdvancedSettings settings={settings} update={update} />
      )}
    </div>
  );
}
