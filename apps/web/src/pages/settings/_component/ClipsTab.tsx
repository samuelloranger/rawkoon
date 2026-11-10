import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import type { ClipProgress } from "@rawkoon/shared/types";
import { useConfirm } from "@/components/confirm/ConfirmContext";
import { Switch } from "@/components/ui/switch";
import { formatBytes, formatDuration } from "@/features/transcode/format";
import {
  useClipActions,
  useClipProgress,
  useUpdateClipSettings,
} from "@/features/clips/hooks";
import { ApiError } from "@/lib/api/client";
import { TranscodeStat as Stat } from "./TranscodeStat";

const label = (
  title: string,
  season: number | null,
  seasonLabel: (n: number) => string,
) => (season ? `${title} · ${seasonLabel(season)}` : title);

export function ClipsTab() {
  const { t } = useTranslation("common");
  const progress: ClipProgress | undefined = useClipProgress().data;
  const update = useUpdateClipSettings();
  const { retry, deleteAll } = useClipActions();
  const { confirm } = useConfirm();
  const season = (n: number) => t("clips.admin.season", { number: n });

  if (!progress) return null;
  const { settings } = progress;

  const setEnabled = (enabled: boolean) =>
    update.mutate(
      { enabled },
      {
        // 409 carries the storage guard's reason.
        onError: (e) =>
          toast.error(
            e instanceof ApiError ? e.message : t("clips.admin.actionFailed"),
          ),
      },
    );

  const onDeleteAll = () =>
    confirm({
      variant: "destructive",
      title: t("clips.admin.deleteAll.title"),
      description: t("clips.admin.deleteAll.description", {
        size: formatBytes(progress.total_bytes),
      }),
      confirmLabel: t("clips.admin.deleteAll.confirm"),
      onConfirm: async () => {
        try {
          const r = await deleteAll.mutateAsync();
          toast.success(
            t("clips.admin.deleteAll.done", {
              count: r.deleted_files,
              size: formatBytes(r.freed_bytes),
            }),
          );
        } catch (e) {
          toast.error(
            e instanceof ApiError ? e.message : t("clips.admin.actionFailed"),
          );
        }
      },
    });

  const btn =
    "rounded-lg border border-neutral-700 px-3 py-1.5 text-[13px] font-semibold text-neutral-200 hover:bg-neutral-900 disabled:cursor-not-allowed disabled:opacity-50";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2.5">
        <label className="flex items-center gap-2 text-[13px] text-neutral-300">
          <Switch
            checked={settings.enabled}
            onCheckedChange={setEnabled}
            aria-label={t("clips.admin.enable")}
          />
          {t("clips.admin.enable")}
        </label>
        <span className="flex-1" />
        <button
          type="button"
          onClick={() => update.mutate({ paused: !settings.paused })}
          className={btn}
        >
          {settings.paused ? t("clips.admin.resume") : t("clips.admin.pause")}
        </button>
        <button
          type="button"
          disabled={progress.failed === 0 || retry.isPending}
          onClick={() => retry.mutate()}
          className={btn}
        >
          {t("clips.admin.retryFailed")}
        </button>
      </div>
      <p className="text-xs text-neutral-500">{t("clips.admin.enableHint")}</p>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat
          label={t("clips.admin.stats.done")}
          value={String(progress.done)}
          tone="text-emerald-300"
          hint={t("clips.admin.stats.doneHint")}
        />
        <Stat
          label={t("clips.admin.stats.left")}
          value={String(progress.left)}
          hint={t("clips.admin.stats.leftHint")}
        />
        <Stat
          label={t("clips.admin.stats.failed")}
          value={String(progress.failed)}
          tone="text-red-400"
          hint={t("clips.admin.stats.failedHint")}
        />
        <Stat
          label={t("clips.admin.stats.size")}
          value={formatBytes(progress.total_bytes)}
          hint={t("clips.admin.stats.sizeHint")}
        />
      </div>

      {progress.running && (
        <section className="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
          <div className="text-[10px] font-bold uppercase tracking-[0.15em] text-neutral-400">
            {t("clips.admin.now")}
          </div>
          <div className="font-display text-[17px] font-semibold text-neutral-50">
            {label(
              progress.running.title,
              progress.running.season_number,
              season,
            )}
          </div>
          <div className="mt-1 text-sm text-neutral-400">
            {progress.eta_seconds != null
              ? t("clips.admin.eta", {
                  time: formatDuration(progress.eta_seconds),
                })
              : t("clips.admin.etaUnknown")}
          </div>
        </section>
      )}

      {progress.failed_items.length > 0 && (
        <section className="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
          <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.15em] text-neutral-400">
            {t("clips.admin.recentFailures")}
          </div>
          <ul className="space-y-1.5 text-sm">
            {progress.failed_items.map((f) => (
              <li key={f.clip_id}>
                <span className="text-neutral-100">
                  {label(f.title, f.season_number, season)}
                </span>
                {f.error && (
                  <span className="ml-2 break-all text-xs text-red-400">
                    {f.error}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="flex flex-wrap items-center gap-3 rounded-xl border border-neutral-800 bg-neutral-900 p-4">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-neutral-100">
            {t("clips.admin.deleteAll.title")}
          </div>
          <div className="text-xs text-neutral-500">
            {settings.enabled
              ? t("clips.admin.deleteAll.turnOffFirst")
              : t("clips.admin.deleteAll.hint")}
          </div>
        </div>
        <button
          type="button"
          disabled={settings.enabled || deleteAll.isPending}
          onClick={onDeleteAll}
          className={btn}
        >
          {t("clips.admin.deleteAll.button")}
        </button>
      </section>
    </div>
  );
}
