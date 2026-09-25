import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import type {
  TranscodeCodec,
  TranscodeEncoder,
  TranscodeEstimate,
  TranscodeJobSettings,
  TranscodeMode,
  TranscodePreset,
  TranscodeResolution,
  TranscodeSelection,
  TranscodeSpeed,
} from "@rawkoon/shared/types";
import { Dialog } from "@/components/dialog";
import { Switch } from "@/components/ui/switch";
import {
  derivedMbps,
  formatBytes,
  formatDuration,
  settingsKey,
  targetKbpsFromGb,
} from "@/features/transcode/format";
import {
  useEnqueueTranscode,
  useRefineTranscodeEstimate,
  useTranscodeCapabilities,
  useTranscodeEstimate,
} from "@/features/transcode/hooks";
import { Segmented } from "@/features/transcode/Segmented";

const DEFAULT: TranscodeJobSettings = {
  codec: "hevc",
  encoder: "software",
  resolution: "keep",
  mode: "quality",
  preset: "balanced",
  speed: "default",
  convertLosslessAudio: false,
};

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="my-2 grid grid-cols-[110px_1fr] items-center gap-3 mobile-max:grid-cols-1">
      <span className="text-[13px] text-neutral-400">{label}</span>
      <div>{children}</div>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="border-b border-neutral-800 py-3.5 last:border-b-0">
      <h3 className="mb-2.5 font-mono text-xs uppercase tracking-wider text-neutral-500">
        {title}
      </h3>
      {children}
    </section>
  );
}

export function ReencodeModal({
  isOpen,
  onClose,
  selection,
  subtitle,
}: {
  isOpen: boolean;
  onClose: () => void;
  selection: TranscodeSelection;
  subtitle: string;
}) {
  const { t } = useTranslation("common");
  const [s, setS] = useState<TranscodeJobSettings>(DEFAULT);
  const [gbPerFile, setGbPerFile] = useState(1.5);
  const [refined, setRefined] = useState<{
    key: string;
    data: TranscodeEstimate;
  } | null>(null);
  const caps = useTranscodeCapabilities(isOpen);
  const refine = useRefineTranscodeEstimate();
  const enqueue = useEnqueueTranscode();

  const has = (codec: TranscodeCodec, encoder: TranscodeEncoder) =>
    caps.data?.combos.some((c) => c.codec === codec && c.encoder === encoder) ??
    false;
  const gpuAvailable = has(s.codec, "vaapi");

  // Target mode needs the batch's duration/audio from a quality-mode estimate first.
  const baseEstimate = useTranscodeEstimate(
    selection,
    { ...s, mode: "quality", targetVideoKbps: undefined },
    isOpen,
  );
  const base = baseEstimate.data;
  const effective: TranscodeJobSettings = useMemo(() => {
    if (s.mode !== "target" || !base) return s;
    return {
      ...s,
      targetVideoKbps: targetKbpsFromGb(
        gbPerFile,
        base.files.length,
        Number(base.total_audio_bytes),
        base.total_duration_secs,
      ),
    };
  }, [s, base, gbPerFile]);
  const debounced = useDebounced(effective, 300);
  const live = useTranscodeEstimate(
    selection,
    debounced,
    isOpen &&
      (debounced.mode === "quality" || debounced.targetVideoKbps != null),
  );

  const key = settingsKey(effective);
  const est =
    refined && refined.key === key ? refined.data : (live.data ?? base);
  const outdated = refined != null && refined.key !== key;
  const sourceHeight = est?.source_height ?? null;
  const sourceWidth = est?.source_width ?? null;
  // Mirrors the API: a downscale applies only when the source does not already fit the target box.
  const fits = (bw: number, bh: number) =>
    sourceHeight != null &&
    sourceHeight <= bh &&
    (sourceWidth == null || sourceWidth <= bw);
  const count = est?.files.length ?? 0;
  const seeding = est?.files.filter((f) => f.nlink > 1).length ?? 0;
  const set = <K extends keyof TranscodeJobSettings>(
    k: K,
    v: TranscodeJobSettings[K],
  ) => setS((p) => ({ ...p, [k]: v }));

  const onRefine = async () => {
    try {
      const data = await refine.mutateAsync({ selection, settings: effective });
      setRefined({ key, data });
    } catch {
      toast.error(t("transcode.refineFailed"));
    }
  };

  const onSubmit = async () => {
    try {
      const r = await enqueue.mutateAsync({ selection, settings: effective });
      toast.success(t("transcode.queued", { count: r.count }));
      onClose();
    } catch {
      toast.error(t("transcode.queueFailed"));
    }
  };

  const saved = est
    ? Number(est.total_source_bytes) - Number(est.total_estimated_bytes)
    : 0;
  const nowPct =
    est && Number(est.total_source_bytes)
      ? (Number(est.frees_now_bytes) / Number(est.total_source_bytes)) * 100
      : 0;
  const laterPct =
    est && Number(est.total_source_bytes)
      ? (Number(est.frees_after_seeding_bytes) /
          Number(est.total_source_bytes)) *
        100
      : 0;
  const sourceLine =
    est?.source === "target"
      ? t("transcode.estimate.target")
      : outdated
        ? t("transcode.estimate.outdated")
        : est?.source === "refined"
          ? t("transcode.estimate.refined", {
              files: est.refined_files,
              clips: est.refined_clips,
            })
          : t("transcode.estimate.rough");

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title={t("transcode.title")}
      panelClassName="max-w-[560px] p-0"
      bodyScroll
    >
      <div className="flex min-h-0 flex-col">
        <p className="px-5 pb-3 text-[13px] text-neutral-400">{subtitle}</p>
        <div className="min-h-0 overflow-y-auto px-5">
          <Section title={t("transcode.sections.video")}>
            <Row label={t("transcode.codec")}>
              <Segmented<TranscodeCodec>
                ariaLabel={t("transcode.codec")}
                value={s.codec}
                onChange={(v) =>
                  setS((p) => ({
                    ...p,
                    codec: v,
                    encoder: has(v, p.encoder) ? p.encoder : "software",
                  }))
                }
                options={[
                  {
                    value: "hevc",
                    label: "HEVC",
                    hint: t("transcode.codecHevcHint"),
                    disabled: !has("hevc", "software") && !has("hevc", "vaapi"),
                  },
                  {
                    value: "av1",
                    label: "AV1",
                    hint: t("transcode.codecAv1Hint"),
                    disabled: !has("av1", "software") && !has("av1", "vaapi"),
                  },
                ]}
              />
            </Row>
            <Row label={t("transcode.encoder")}>
              <Segmented<TranscodeEncoder>
                ariaLabel={t("transcode.encoder")}
                value={s.encoder}
                onChange={(v) => set("encoder", v)}
                options={[
                  {
                    value: "software",
                    label: t("transcode.encoderCpu"),
                    hint: t("transcode.encoderCpuHint"),
                    disabled: !has(s.codec, "software"),
                  },
                  {
                    value: "vaapi",
                    label: t("transcode.encoderGpu"),
                    hint: t("transcode.encoderGpuHint"),
                    disabled: !gpuAvailable,
                    title: caps.data?.vaapi_unavailable_reason ?? undefined,
                  },
                ]}
              />
              <p className="mt-1 text-xs text-neutral-500">
                {caps.data?.device_label
                  ? t("transcode.detected", { label: caps.data.device_label })
                  : caps.data?.vaapi_unavailable_reason}
              </p>
            </Row>
            <Row label={t("transcode.resolution")}>
              <Segmented<TranscodeResolution>
                ariaLabel={t("transcode.resolution")}
                value={s.resolution}
                onChange={(v) => set("resolution", v)}
                options={[
                  {
                    value: "keep",
                    label: t("transcode.resKeep"),
                    hint: sourceHeight ? `${sourceHeight}p` : undefined,
                  },
                  {
                    value: 1080,
                    label: "1080p",
                    disabled: fits(1920, 1080),
                  },
                  {
                    value: 720,
                    label: "720p",
                    disabled: fits(1280, 720),
                  },
                ]}
              />
            </Row>
          </Section>

          <Section title={t("transcode.sections.size")}>
            <Row label={t("transcode.mode")}>
              <Segmented<TranscodeMode>
                ariaLabel={t("transcode.mode")}
                value={s.mode}
                onChange={(v) => set("mode", v)}
                options={[
                  {
                    value: "quality",
                    label: t("transcode.modeQuality"),
                    hint: t("transcode.modeQualityHint"),
                  },
                  {
                    value: "target",
                    label: t("transcode.modeTarget"),
                    hint: t("transcode.modeTargetHint"),
                  },
                ]}
              />
            </Row>
            {s.mode === "quality" ? (
              <>
                <Row label={t("transcode.preset")}>
                  <Segmented<TranscodePreset>
                    ariaLabel={t("transcode.preset")}
                    value={s.preset}
                    onChange={(v) =>
                      setS((p) => ({ ...p, preset: v, quality: undefined }))
                    }
                    options={[
                      { value: "high", label: t("transcode.presetHigh") },
                      {
                        value: "balanced",
                        label: t("transcode.presetBalanced"),
                      },
                      { value: "small", label: t("transcode.presetSmall") },
                    ]}
                  />
                </Row>
                <details className="mt-1.5">
                  <summary className="cursor-pointer text-[13px] text-neutral-400">
                    {t("transcode.advanced")}
                  </summary>
                  <Row label={t("transcode.qualityValue")}>
                    <input
                      type="number"
                      aria-label={t("transcode.qualityValue")}
                      value={s.quality ?? ""}
                      min={0}
                      max={255}
                      onChange={(e) =>
                        set(
                          "quality",
                          e.target.value === ""
                            ? undefined
                            : Number(e.target.value),
                        )
                      }
                      className="w-24 rounded-lg border border-neutral-800 bg-neutral-950 px-2.5 py-1.5 text-neutral-50"
                    />
                    <span className="ml-2 font-mono text-xs text-neutral-400">
                      {s.encoder === "vaapi"
                        ? t("transcode.qualityValueHintQp")
                        : t("transcode.qualityValueHintCrf")}
                    </span>
                  </Row>
                  {s.encoder === "software" && (
                    <Row label={t("transcode.speed")}>
                      <Segmented<TranscodeSpeed>
                        ariaLabel={t("transcode.speed")}
                        value={s.speed}
                        onChange={(v) => set("speed", v)}
                        options={[
                          {
                            value: "slower",
                            label: t("transcode.speedSlower"),
                          },
                          {
                            value: "default",
                            label: t("transcode.speedDefault"),
                          },
                          {
                            value: "faster",
                            label: t("transcode.speedFaster"),
                          },
                        ]}
                      />
                    </Row>
                  )}
                </details>
              </>
            ) : (
              <Row label={t("transcode.perFile")}>
                <label className="flex items-center gap-2">
                  <input
                    type="number"
                    step={0.1}
                    min={0.1}
                    value={gbPerFile}
                    onChange={(e) =>
                      setGbPerFile(Number(e.target.value) || 0.1)
                    }
                    className="w-24 rounded-lg border border-neutral-800 bg-neutral-950 px-2.5 py-1.5 text-neutral-50"
                  />
                  <span className="text-[13px] text-neutral-400">
                    {t("transcode.gbPerFile")}
                  </span>
                </label>
                {effective.targetVideoKbps != null && (
                  <p className="mt-1 text-xs text-neutral-500">
                    {t("transcode.derived", {
                      mbps: derivedMbps(effective.targetVideoKbps),
                    })}
                  </p>
                )}
              </Row>
            )}
          </Section>

          <Section title={t("transcode.sections.audio")}>
            <label className="flex cursor-pointer items-start gap-2.5">
              <Switch
                checked={s.convertLosslessAudio}
                onCheckedChange={(v: boolean) => set("convertLosslessAudio", v)}
                aria-label={t("transcode.convertAudio")}
              />
              <span>
                <span className="block font-medium text-neutral-50">
                  {t("transcode.convertAudio")}
                </span>
                <span className="block text-xs text-neutral-500">
                  {t("transcode.convertAudioHint")}
                </span>
              </span>
            </label>
            <div className="ml-11 mt-2 grid gap-1">
              {est?.audio_changes.length ? (
                est.audio_changes.map((a) => (
                  <div
                    key={a.label}
                    className="flex justify-between text-xs text-neutral-400"
                  >
                    <span>{a.label}</span>
                    <span>
                      {s.convertLosslessAudio ? (
                        <>
                          <span className="text-primary-400">→</span> {a.to}
                        </>
                      ) : (
                        t("transcode.copy")
                      )}
                    </span>
                  </div>
                ))
              ) : (
                <span className="text-xs text-neutral-500">
                  {t("transcode.noLossless")}
                </span>
              )}
            </div>
          </Section>

          {est && est.excluded.length > 0 && (
            <details className="mb-3 rounded-lg border border-neutral-800 px-3 py-2 text-xs text-neutral-400">
              <summary className="cursor-pointer">
                {t("transcode.excludedTitle", { count: est.excluded.length })}
              </summary>
              <ul className="mt-1.5 space-y-0.5">
                {est.excluded.map((x) => (
                  <li key={x.file_id}>
                    {x.title} — {x.reason}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>

        <div
          className="mx-5 mt-1 rounded-xl border border-neutral-800 bg-neutral-950 px-4 py-3.5"
          aria-live="polite"
        >
          {est ? (
            <>
              <div className="flex flex-wrap items-baseline gap-2.5">
                <span className="font-display text-2xl font-semibold text-neutral-50">
                  {est.source === "target" ? "" : "≈ "}
                  {formatBytes(est.total_estimated_bytes)}
                </span>
                <span className="text-sm text-neutral-500 line-through">
                  {formatBytes(est.total_source_bytes)}
                </span>
                <span className="text-xs text-neutral-400">
                  ±{est.range_pct}%
                </span>
                {saved > 0 && (
                  <span className="ml-auto rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-xs font-semibold text-emerald-300">
                    {t("transcode.estimate.saved", {
                      size: formatBytes(saved),
                    })}
                  </span>
                )}
              </div>
              <div className="my-3 flex h-1.5 overflow-hidden rounded-full bg-neutral-800">
                <i
                  className="block h-full bg-emerald-400"
                  style={{ width: `${nowPct}%` }}
                />
                <i
                  className="block h-full bg-emerald-400/35"
                  style={{ width: `${laterPct}%` }}
                />
              </div>
              <div className="grid grid-cols-3 gap-2.5">
                <div>
                  <div className="font-mono text-[11px] uppercase text-neutral-500">
                    {t("transcode.estimate.freesNow")}
                  </div>
                  <div className="font-medium text-neutral-50">
                    {formatBytes(est.frees_now_bytes)}
                  </div>
                </div>
                <div>
                  <div className="font-mono text-[11px] uppercase text-neutral-500">
                    {t("transcode.estimate.afterSeeding")}
                  </div>
                  <div className="text-neutral-400">
                    +{formatBytes(est.frees_after_seeding_bytes)}
                  </div>
                </div>
                <div>
                  <div className="font-mono text-[11px] uppercase text-neutral-500">
                    {t("transcode.estimate.time")}
                  </div>
                  <div className="font-medium text-neutral-50">
                    ~{formatDuration(est.eta_secs)}
                  </div>
                </div>
              </div>
              {seeding > 0 && (
                <p className="mt-2.5 rounded-lg border border-amber-400/25 bg-amber-400/10 px-2.5 py-2 text-xs text-amber-300">
                  {t("transcode.estimate.seedingWarning", {
                    count: seeding,
                    size: formatBytes(est.temporary_growth_bytes),
                  })}
                </p>
              )}
              <div className="mt-3 flex items-center justify-between border-t border-dashed border-neutral-800 pt-2.5 text-xs text-neutral-400">
                <span className={outdated ? "text-amber-300" : undefined}>
                  {refine.isPending
                    ? t("transcode.estimate.refining")
                    : sourceLine}
                </span>
                {s.mode === "quality" && (
                  <button
                    type="button"
                    onClick={onRefine}
                    disabled={refine.isPending || count === 0}
                    className="font-medium text-primary-400 disabled:opacity-40"
                  >
                    {refined
                      ? t("transcode.estimate.refineAgain")
                      : t("transcode.estimate.refine")}
                  </button>
                )}
              </div>
            </>
          ) : (
            <span className="text-sm text-neutral-400">
              {t("transcode.estimate.loading")}
            </span>
          )}
        </div>

        <div className="flex justify-end gap-2 px-5 pb-5 pt-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-sm font-semibold text-neutral-200"
          >
            {t("transcode.cancel")}
          </button>
          <button
            type="button"
            onClick={onSubmit}
            disabled={count === 0 || enqueue.isPending}
            className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-[#2A1A10] hover:bg-primary-500 disabled:opacity-50"
          >
            {t("transcode.submit", { count })}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
