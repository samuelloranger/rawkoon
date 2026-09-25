import { Fragment, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import type { TranscodeJob, TranscodeStep } from "@rawkoon/shared/types";
import { Switch } from "@/components/ui/switch";
import { formatBytes, formatDuration } from "@/features/transcode/format";
import {
  useTranscodeJobAction,
  useTranscodeJobs,
  useTranscodeSettings,
  useTranscodeSummary,
  useUpdateTranscodeSettings,
} from "@/features/transcode/hooks";
import { cn } from "@/lib/utils";

const STEPS: TranscodeStep[] = ["encode", "validate", "replace", "rescan"];

function settingsLabel(j: TranscodeJob): string {
  const s = j.settings;
  const parts = [s.codec.toUpperCase(), s.encoder === "vaapi" ? "GPU" : "CPU"];
  if (s.resolution !== "keep") parts.push(`→${s.resolution}p`);
  parts.push(
    s.mode === "target"
      ? `${((s.targetVideoKbps ?? 0) / 1000).toFixed(1)} Mbps`
      : s.preset,
  );
  if (s.convertLosslessAudio) parts.push("EAC3");
  return parts.join(" · ");
}

function Stat({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint: string;
  tone?: string;
}) {
  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900 px-3.5 py-3">
      <div className="text-[10px] font-bold uppercase tracking-[0.15em] text-neutral-400">
        {label}
      </div>
      <div
        className={cn(
          "mt-0.5 font-display text-xl font-semibold text-neutral-50",
          tone,
        )}
      >
        {value}
      </div>
      <div className="text-xs text-neutral-500">{hint}</div>
    </div>
  );
}

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
  const batches = useMemo(() => {
    const out: { batchId: string; jobs: TranscodeJob[] }[] = [];
    for (const j of queued) {
      const last = out[out.length - 1];
      if (last?.batchId === j.batch_id) last.jobs.push(j);
      else out.push({ batchId: j.batch_id, jobs: [j] });
    }
    return out;
  }, [queued]);

  const safe = (p: Promise<unknown>) =>
    p.catch(() => toast.error(t("transcode.admin.actionFailed")));

  const stepIndex = running?.step ? STEPS.indexOf(running.step) : -1;
  const progress = running?.live?.progress ?? running?.progress ?? 0;
  const elapsed = running?.started_at
    ? Math.round((Date.now() - Date.parse(running.started_at)) / 1000)
    : 0;

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
        <section className="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
          <div className="flex items-start gap-3.5">
            <div className="min-w-0 flex-1">
              <div className="text-[10px] font-bold uppercase tracking-[0.15em] text-neutral-400">
                {t("transcode.admin.now")}
              </div>
              <div className="font-display text-[17px] font-semibold text-neutral-50">
                {running.title}
              </div>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                <span className="rounded-full border border-neutral-800 bg-neutral-950 px-2 text-[11px] text-neutral-400">
                  {settingsLabel(running)}
                </span>
              </div>
            </div>
            <button
              type="button"
              onClick={() => safe(act.cancel(running.id))}
              className="rounded-lg border border-neutral-700 px-3 py-1.5 text-[13px] font-semibold text-neutral-200"
            >
              {t("transcode.admin.cancelJob")}
            </button>
          </div>
          <div className="my-4 flex">
            <div className="relative flex-1 pt-3 text-[11px] text-neutral-400 before:absolute before:left-0 before:right-1 before:top-0 before:h-[3px] before:rounded before:bg-emerald-400">
              {t("transcode.admin.steps.queued")}
            </div>
            {STEPS.map((s, i) => (
              <div
                key={s}
                className={cn(
                  "relative flex-1 pt-3 text-[11px] before:absolute before:left-0 before:right-1 before:top-0 before:h-[3px] before:rounded",
                  i < stepIndex
                    ? "text-neutral-400 before:bg-emerald-400"
                    : i === stepIndex
                      ? "font-semibold text-neutral-50 before:bg-primary-400"
                      : "text-neutral-500 before:bg-neutral-800",
                )}
              >
                {t(`transcode.admin.steps.${s}`)}
                {s === "encode" && i === stepIndex
                  ? ` ${Math.round(progress * 100)}%`
                  : ""}
              </div>
            ))}
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-neutral-950">
            <i
              className="block h-full rounded-full bg-gradient-to-r from-primary-600 to-primary-400"
              style={{ width: `${Math.round(progress * 100)}%` }}
            />
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2.5 text-sm md:grid-cols-5">
            <div>
              <div className="font-mono text-[11px] text-neutral-500">
                {t("transcode.admin.speed")}
              </div>
              <div className="text-neutral-50">
                {running.live?.fps
                  ? `${Math.round(running.live.fps)} fps · ${running.live.speed ?? "–"}×`
                  : "–"}
              </div>
            </div>
            <div>
              <div className="font-mono text-[11px] text-neutral-500">
                {t("transcode.admin.elapsed")}
              </div>
              <div className="text-neutral-50">{formatDuration(elapsed)}</div>
            </div>
            <div>
              <div className="font-mono text-[11px] text-neutral-500">
                {t("transcode.admin.eta")}
              </div>
              <div className="text-neutral-50">
                {running.live?.eta_secs != null
                  ? `~${formatDuration(running.live.eta_secs)}`
                  : "–"}
              </div>
            </div>
            <div>
              <div className="font-mono text-[11px] text-neutral-500">
                {t("transcode.admin.size")}
              </div>
              <div className="text-neutral-50">
                {formatBytes(running.source_bytes)} →{" "}
                {running.live?.current_bytes
                  ? formatBytes(running.live.current_bytes)
                  : "–"}
              </div>
            </div>
            <div>
              <div className="font-mono text-[11px] text-neutral-500">
                {t("transcode.admin.estWas")}
              </div>
              <div className="text-neutral-400">
                {running.estimated_bytes
                  ? formatBytes(running.estimated_bytes)
                  : "–"}
              </div>
            </div>
          </div>
        </section>
      )}

      <div className="flex items-center justify-between">
        <h2 className="font-display text-[17px] font-semibold text-neutral-50">
          {t("transcode.admin.queue")}
        </h2>
        <span className="text-xs text-neutral-500">
          {t("transcode.admin.queueHint")}
        </span>
      </div>
      <section className="overflow-hidden rounded-xl border border-neutral-800 bg-neutral-900">
        {queued.length === 0 ? (
          <p className="px-4 py-6 text-sm text-neutral-400">
            {t("transcode.admin.emptyQueue")}
          </p>
        ) : (
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-neutral-800 text-left font-mono text-[11px] uppercase text-neutral-500">
                <th className="w-6 px-3 py-2" />
                <th className="px-3 py-2">{t("transcode.admin.cols.item")}</th>
                <th className="px-3 py-2 mobile-max:hidden">
                  {t("transcode.admin.cols.settings")}
                </th>
                <th className="px-3 py-2">{t("transcode.admin.cols.size")}</th>
                <th className="px-3 py-2">{t("transcode.admin.cols.est")}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {batches.map((b) => (
                <Fragment key={`${b.batchId}-${b.jobs[0].id}`}>
                  {b.jobs.length > 1 && (
                    <tr className="bg-neutral-950 text-xs text-neutral-400">
                      <td />
                      <td colSpan={4} className="px-3 py-2">
                        {t("transcode.admin.batch", {
                          title: b.jobs[0].title.split(" — ")[0],
                          count: b.jobs.length,
                        })}
                      </td>
                      <td className="whitespace-nowrap px-2 text-right">
                        <button
                          type="button"
                          aria-label={t("transcode.admin.moveTop")}
                          onClick={() => safe(act.batchTop(b.batchId))}
                          className="rounded px-1.5 py-1 hover:bg-neutral-900"
                        >
                          ⤒
                        </button>
                        <button
                          type="button"
                          onClick={() => safe(act.removeBatch(b.batchId))}
                          className="rounded px-1.5 py-1 hover:bg-neutral-900"
                        >
                          {t("transcode.admin.removeAll")}
                        </button>
                      </td>
                    </tr>
                  )}
                  {b.jobs.map((j) => (
                    <tr
                      key={j.id}
                      data-testid="queue-row"
                      draggable
                      onDragStart={() => setDragId(j.id)}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={() => {
                        if (dragId != null && dragId !== j.id)
                          void safe(act.moveBefore(dragId, j.id));
                        setDragId(null);
                      }}
                      className="border-b border-neutral-800 last:border-b-0"
                    >
                      <td className="cursor-grab px-3 py-2 text-neutral-500">
                        ⋮⋮
                      </td>
                      <td className="px-3 py-2 text-neutral-200">{j.title}</td>
                      <td className="px-3 py-2 text-neutral-400 mobile-max:hidden">
                        {settingsLabel(j)}
                      </td>
                      <td className="px-3 py-2 tabular-nums">
                        {formatBytes(j.source_bytes)}
                      </td>
                      <td className="px-3 py-2 tabular-nums text-emerald-300">
                        {j.estimated_bytes
                          ? `~${formatBytes(j.estimated_bytes)}`
                          : "–"}
                      </td>
                      <td className="whitespace-nowrap px-2 text-right text-neutral-500">
                        <button
                          type="button"
                          aria-label={t("transcode.admin.moveTop")}
                          onClick={() => safe(act.moveTop(j.id))}
                          className="rounded px-1.5 py-1 hover:bg-neutral-950"
                        >
                          ⤒
                        </button>
                        <button
                          type="button"
                          aria-label={t("transcode.admin.remove")}
                          onClick={() => safe(act.cancel(j.id))}
                          className="rounded px-1.5 py-1 hover:bg-neutral-950"
                        >
                          ✕
                        </button>
                      </td>
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <div className="flex items-center justify-between">
        <h2 className="font-display text-[17px] font-semibold text-neutral-50">
          {t("transcode.admin.history")}
        </h2>
        <span className="text-xs text-neutral-500">
          {t("transcode.admin.historyHint")} ·{" "}
          <button
            type="button"
            onClick={() => safe(act.clearHistory())}
            className="text-primary-400"
          >
            {t("transcode.admin.clearFinished")}
          </button>
        </span>
      </div>
      <section className="overflow-hidden rounded-xl border border-neutral-800 bg-neutral-900">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-neutral-800 text-left font-mono text-[11px] uppercase text-neutral-500">
              <th className="px-3 py-2">{t("transcode.admin.cols.item")}</th>
              <th className="px-3 py-2">{t("transcode.admin.cols.result")}</th>
              <th className="px-3 py-2">
                {t("transcode.admin.cols.beforeAfter")}
              </th>
              <th className="px-3 py-2">{t("transcode.admin.cols.saved")}</th>
              <th className="px-3 py-2 mobile-max:hidden">
                {t("transcode.admin.cols.ssim")}
              </th>
              <th className="px-3 py-2 mobile-max:hidden">
                {t("transcode.admin.cols.took")}
              </th>
              <th />
            </tr>
          </thead>
          <tbody>
            {history.map((j) => {
              const diff = j.output_bytes
                ? Number(j.source_bytes) - Number(j.output_bytes)
                : 0;
              const seeding = (j.source_nlink ?? 1) > 1;
              const took =
                j.started_at && j.finished_at
                  ? Math.round(
                      (Date.parse(j.finished_at) - Date.parse(j.started_at)) /
                        1000,
                    )
                  : null;
              return (
                <Fragment key={j.id}>
                  <tr className="border-b border-neutral-800">
                    <td className="px-3 py-2">{j.title}</td>
                    <td
                      className={cn(
                        "px-3 py-2",
                        j.status === "done"
                          ? "text-emerald-300"
                          : j.status === "failed"
                            ? "text-red-400"
                            : "text-neutral-400",
                      )}
                    >
                      {t(
                        `transcode.admin.result.${j.status === "done" ? "done" : j.status}`,
                      )}
                      {j.status === "done" && seeding && (
                        <span className="text-neutral-500">
                          {" "}
                          {t("transcode.admin.result.seeding")}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 tabular-nums">
                      {j.status === "done" && j.output_bytes
                        ? `${formatBytes(j.source_bytes)} → ${formatBytes(j.output_bytes)}`
                        : t("transcode.admin.kept", {
                            size: formatBytes(j.source_bytes),
                          })}
                    </td>
                    <td className="px-3 py-2 tabular-nums">
                      {j.status !== "done" ? (
                        "–"
                      ) : seeding ? (
                        <span className="text-neutral-400">
                          {t("transcode.admin.savedLater", {
                            size: formatBytes(diff),
                          })}
                        </span>
                      ) : (
                        <span className="text-emerald-300">
                          −{formatBytes(diff)}
                        </span>
                      )}
                    </td>
                    <td
                      className={cn(
                        "px-3 py-2 tabular-nums mobile-max:hidden",
                        j.status === "failed" &&
                          j.ssim_avg != null &&
                          "text-red-400",
                      )}
                    >
                      {j.ssim_avg?.toFixed(3) ?? "–"}
                    </td>
                    <td className="px-3 py-2 tabular-nums mobile-max:hidden">
                      {took != null ? formatDuration(took) : "–"}
                    </td>
                    <td className="px-2 text-right">
                      {(j.status === "failed" || j.status === "cancelled") && (
                        <button
                          type="button"
                          onClick={() => safe(act.retry(j.id))}
                          className="rounded px-1.5 py-1 text-neutral-400 hover:bg-neutral-950"
                        >
                          ↻ {t("transcode.admin.retry")}
                        </button>
                      )}
                    </td>
                  </tr>
                  {j.error && j.status === "failed" && (
                    <tr className="border-b border-neutral-800">
                      <td
                        colSpan={7}
                        className="px-3 pb-2 text-xs text-red-400"
                      >
                        {j.error}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </section>

      {settings && (
        <details className="text-sm text-neutral-400">
          <summary className="cursor-pointer">
            {t("transcode.admin.advanced")}
          </summary>
          <div className="mt-2 grid max-w-md gap-2">
            {(
              [
                ["ssim_threshold", t("transcode.admin.ssimThreshold"), 0.001],
                ["ssim_clip_min", t("transcode.admin.ssimClipMin"), 0.001],
              ] as const
            ).map(([k, label, step]) => (
              <label
                key={k}
                className="flex items-center justify-between gap-3"
              >
                {label}
                <input
                  type="number"
                  step={step}
                  min={0.5}
                  max={1}
                  defaultValue={settings[k]}
                  onBlur={(e) => update.mutate({ [k]: Number(e.target.value) })}
                  className="w-24 rounded-lg border border-neutral-800 bg-neutral-950 px-2 py-1 text-neutral-50"
                />
              </label>
            ))}
            <label className="flex items-center justify-between gap-3">
              {t("transcode.admin.cpuThreads")}
              <input
                type="number"
                min={1}
                defaultValue={settings.cpu_threads ?? ""}
                onBlur={(e) =>
                  update.mutate({
                    cpu_threads:
                      e.target.value === "" ? null : Number(e.target.value),
                  })
                }
                className="w-24 rounded-lg border border-neutral-800 bg-neutral-950 px-2 py-1 text-neutral-50"
              />
            </label>
          </div>
        </details>
      )}
    </div>
  );
}
