import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { FormInput } from "@/components/ui/form-field";
import { useLibraryScan } from "@/features/medias/hooks/useLibraryScan";
import { useReindexLanguages } from "@/features/medias/hooks/useReindexLanguages";
import { useReindexLanguagesStatus } from "@/features/medias/hooks/useReindexLanguagesStatus";
import { useUpdateMediaPostProcessingSettings } from "@/features/medias/hooks/useUpdateMediaPostProcessingSettings";
import { useProwlarrIntegration } from "@/pages/settings/useProwlarrIntegration";
import { useJackettIntegration } from "@/pages/settings/useJackettIntegration";
import type {
  MediaPostProcessingSettings,
  QualityProfilesListResponse,
} from "@rawkoon/shared/types";

interface MediaPostProcessingSettingsBodyProps {
  settings: MediaPostProcessingSettings;
  profilesData: QualityProfilesListResponse | undefined;
}

const SELECT_CLASS =
  "w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 focus:outline-none focus:ring-2 focus:ring-primary-500/40";

const LABEL_CLASS = "block text-sm font-medium text-neutral-300 mb-1.5";

function CardSection({
  title,
  description,
  children,
  actions,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-neutral-700 bg-neutral-800">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-neutral-700/60 px-6 py-4">
        <div>
          <h2 className="text-sm font-semibold text-neutral-100">{title}</h2>
          {description && (
            <p className="mt-0.5 text-xs text-neutral-400">{description}</p>
          )}
        </div>
        {actions}
      </div>
      <div className="space-y-4 p-6">{children}</div>
    </div>
  );
}

export function MediaPostProcessingSettingsBody({
  settings,
  profilesData,
}: MediaPostProcessingSettingsBodyProps) {
  const { t } = useTranslation("common");
  const updateMut = useUpdateMediaPostProcessingSettings();
  const scanMut = useLibraryScan();

  const mediaSettingsSchema = useMemo(
    () =>
      z.object({
        postProcessingEnabled: z.boolean(),
        moviesPath: z.string(),
        showsPath: z.string(),
        fileOperation: z.enum(["hardlink", "move"]),
        movieTemplate: z.string(),
        episodeTemplate: z.string(),
        minSeedRatio: z.number(),
        defaultQualityProfileId: z.string(),
        activeIndexerManager: z.string(),
      }),
    [],
  );

  type MediaSettingsFormValues = z.infer<typeof mediaSettingsSchema>;

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<MediaSettingsFormValues>({
    resolver: zodResolver(mediaSettingsSchema),
    defaultValues: {
      postProcessingEnabled: settings.post_processing_enabled,
      moviesPath: settings.movies_library_path ?? "",
      showsPath: settings.shows_library_path ?? "",
      fileOperation: settings.file_operation === "move" ? "move" : "hardlink",
      movieTemplate: settings.movie_template,
      episodeTemplate: settings.episode_template,
      minSeedRatio: settings.min_seed_ratio,
      defaultQualityProfileId:
        settings.default_quality_profile_id?.toString() ?? "",
      activeIndexerManager: settings.active_indexer_manager ?? "",
    },
  });

  const [scanPath, setScanPath] = useState("");
  const [scanType, setScanType] = useState<"movie" | "show">("movie");
  const [lastScan, setLastScan] = useState<{
    matched: number;
    unmatched: string[];
  } | null>(null);

  const { data: prowlarrData } = useProwlarrIntegration();
  const { data: jackettData } = useJackettIntegration();
  const prowlarrEnabled = Boolean(prowlarrData?.integration?.enabled);
  const jackettEnabled = Boolean(jackettData?.integration?.enabled);
  const indexerOptions = [
    ...(prowlarrEnabled ? [{ value: "prowlarr", label: "Prowlarr" }] : []),
    ...(jackettEnabled ? [{ value: "jackett", label: "Jackett" }] : []),
  ];

  const onSubmit = async (data: MediaSettingsFormValues) => {
    try {
      await updateMut.mutateAsync({
        post_processing_enabled: data.postProcessingEnabled,
        movies_library_path: data.moviesPath.trim() || null,
        shows_library_path: data.showsPath.trim() || null,
        file_operation: data.fileOperation,
        movie_template: data.movieTemplate,
        episode_template: data.episodeTemplate,
        min_seed_ratio: data.minSeedRatio,
        default_quality_profile_id:
          data.defaultQualityProfileId === ""
            ? null
            : parseInt(data.defaultQualityProfileId, 10),
        active_indexer_manager:
          data.activeIndexerManager === "prowlarr" ||
          data.activeIndexerManager === "jackett"
            ? data.activeIndexerManager
            : null,
      });
      toast.success(t("settings.mediaLibrary.saveSuccess"));
    } catch {
      toast.error(t("settings.mediaLibrary.saveError"));
    }
  };

  const onScan = async () => {
    const p = scanPath.trim();
    if (!p) {
      toast.error(t("settings.mediaLibrary.scanPath"));
      return;
    }
    setLastScan(null);
    try {
      const res = await scanMut.mutateAsync({ path: p, type: scanType });
      setLastScan({ matched: res.matched, unmatched: res.unmatched });
      toast.success(
        t("settings.mediaLibrary.scanResult", { count: res.matched }),
      );
    } catch {
      toast.error(t("settings.mediaLibrary.scanError"));
    }
  };

  return (
    <div className="space-y-4">
      {/* ── Post-processing settings ─────────────────────────────────── */}
      <CardSection
        title={t("settings.mediaLibrary.title")}
        description={t("settings.mediaLibrary.description")}
      >
        <form className="space-y-4" onSubmit={handleSubmit(onSubmit)}>
          <label className="flex items-center gap-2 text-sm font-medium text-neutral-200">
            <input
              type="checkbox"
              {...register("postProcessingEnabled")}
              className="rounded border-neutral-700"
            />
            {t("settings.mediaLibrary.postProcessingToggle")}
          </label>

          <div className="grid gap-4 md:grid-cols-2">
            <FormInput
              label={t("settings.mediaLibrary.moviesPath")}
              {...register("moviesPath")}
              placeholder="/data/movies"
              className="font-mono text-xs"
              error={errors.moviesPath?.message}
            />
            <FormInput
              label={t("settings.mediaLibrary.showsPath")}
              {...register("showsPath")}
              placeholder="/data/shows"
              className="font-mono text-xs"
              error={errors.showsPath?.message}
            />
          </div>

          <div>
            <label className={LABEL_CLASS}>
              {t("settings.mediaLibrary.fileOperation")}
            </label>
            <select {...register("fileOperation")} className={SELECT_CLASS}>
              <option value="hardlink">
                {t("settings.mediaLibrary.hardlink")}
              </option>
              <option value="move">{t("settings.mediaLibrary.move")}</option>
            </select>
            {errors.fileOperation && (
              <p className="mt-1 text-sm text-red-400">
                {errors.fileOperation.message}
              </p>
            )}
          </div>

          <div>
            <label className={LABEL_CLASS}>
              {t("settings.mediaLibrary.movieTemplate")}
            </label>
            <textarea
              {...register("movieTemplate")}
              rows={2}
              className="w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm font-mono text-neutral-100 focus:outline-none focus:ring-2 focus:ring-primary-500/40"
            />
            {errors.movieTemplate && (
              <p className="mt-1 text-sm text-red-400">
                {errors.movieTemplate.message}
              </p>
            )}
          </div>

          <div>
            <label className={LABEL_CLASS}>
              {t("settings.mediaLibrary.episodeTemplate")}
            </label>
            <textarea
              {...register("episodeTemplate")}
              rows={2}
              className="w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm font-mono text-neutral-100 focus:outline-none focus:ring-2 focus:ring-primary-500/40"
            />
            {errors.episodeTemplate && (
              <p className="mt-1 text-sm text-red-400">
                {errors.episodeTemplate.message}
              </p>
            )}
          </div>

          <FormInput
            label={t("settings.mediaLibrary.minSeedRatio")}
            type="number"
            min={0}
            step={0.1}
            {...register("minSeedRatio", { valueAsNumber: true })}
            error={errors.minSeedRatio?.message}
          />

          <div>
            <label className={LABEL_CLASS}>
              {t("settings.mediaLibrary.activeIndexerManager")}
            </label>
            {indexerOptions.length === 0 ? (
              <p className="text-sm text-neutral-400">
                {t("settings.mediaLibrary.noIndexerConfigured")}
              </p>
            ) : (
              <select
                {...register("activeIndexerManager")}
                className={SELECT_CLASS}
              >
                <option value="">
                  {t("settings.mediaLibrary.noIndexerSelected")}
                </option>
                {indexerOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            )}
            {errors.activeIndexerManager && (
              <p className="mt-1 text-sm text-red-400">
                {errors.activeIndexerManager.message}
              </p>
            )}
          </div>

          <div>
            <label className={LABEL_CLASS}>
              {t("settings.mediaLibrary.defaultQualityProfile")}
            </label>
            <select
              {...register("defaultQualityProfileId")}
              className={SELECT_CLASS}
            >
              <option value="">
                {t("settings.mediaLibrary.defaultQualityProfileNone")}
              </option>
              {(profilesData?.profiles ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            {errors.defaultQualityProfileId && (
              <p className="mt-1 text-sm text-red-400">
                {errors.defaultQualityProfileId.message}
              </p>
            )}
            <p className="mt-1.5 text-xs text-neutral-400">
              {t("settings.mediaLibrary.defaultQualityProfileHint")}
            </p>
          </div>

          <div className="pt-2 border-t border-neutral-700/60">
            <Button type="submit" disabled={updateMut.isPending}>
              {updateMut.isPending
                ? t("settings.mediaLibrary.saving")
                : t("settings.mediaLibrary.save")}
            </Button>
          </div>
        </form>
      </CardSection>

      {/* ── Library scan ─────────────────────────────────────────────── */}
      <CardSection
        title={t("settings.mediaLibrary.scanTitle")}
        description={t("settings.mediaLibrary.scanDescription")}
      >
        <FormInput
          label={t("settings.mediaLibrary.scanPath")}
          value={scanPath}
          onChange={(e) => setScanPath(e.target.value)}
          placeholder="/mnt/media/Movies"
          className="font-mono text-xs"
        />
        <div>
          <label className={LABEL_CLASS}>
            {t("settings.mediaLibrary.scanType")}
          </label>
          <select
            value={scanType}
            onChange={(e) =>
              setScanType(e.target.value === "show" ? "show" : "movie")
            }
            className={SELECT_CLASS}
          >
            <option value="movie">
              {t("settings.mediaLibrary.scanMovies")}
            </option>
            <option value="show">{t("settings.mediaLibrary.scanShows")}</option>
          </select>
        </div>
        <Button
          type="button"
          variant="secondary"
          onClick={() => void onScan()}
          disabled={scanMut.isPending}
        >
          {scanMut.isPending
            ? t("settings.mediaLibrary.scanRunning")
            : t("settings.mediaLibrary.scanRun")}
        </Button>
        {lastScan && lastScan.unmatched.length > 0 && (
          <div className="rounded-lg border border-neutral-700/60 bg-neutral-900/40 p-3 text-xs text-neutral-400">
            <p className="font-medium text-neutral-200 mb-1.5">
              {t("settings.mediaLibrary.scanUnmatched")} (
              {lastScan.unmatched.length})
            </p>
            <ul className="list-disc pl-4 max-h-40 overflow-y-auto font-mono space-y-0.5">
              {lastScan.unmatched.map((u) => (
                <li key={u}>{u}</li>
              ))}
            </ul>
          </div>
        )}
      </CardSection>

      {/* ── Reindex languages ────────────────────────────────────────── */}
      <ReindexLanguagesSection />
    </div>
  );
}

function ReindexLanguagesSection() {
  const { t } = useTranslation("common");
  const reindexMut = useReindexLanguages();
  const { data: status } = useReindexLanguagesStatus();
  const isRunning = status?.state === "active" || status?.state === "waiting";

  const onStart = async () => {
    try {
      await reindexMut.mutateAsync();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="overflow-hidden rounded-xl border border-neutral-700 bg-neutral-800">
      <div className="border-b border-neutral-700/60 px-6 py-4">
        <h2 className="text-sm font-semibold text-neutral-100">
          {t("medias.library.reindexLanguagesButton")}
        </h2>
      </div>
      <div className="space-y-3 p-6">
        <Button
          type="button"
          variant="secondary"
          onClick={() => void onStart()}
          disabled={isRunning || reindexMut.isPending}
        >
          {isRunning && status?.progress
            ? t("medias.library.reindexLanguagesRunning", {
                current: status.progress.current,
                total: status.progress.total,
              })
            : t("medias.library.reindexLanguagesButton")}
        </Button>
        {status?.state === "completed" && status.result && (
          <p className="text-xs text-neutral-400">
            {t("medias.library.reindexLanguagesDone", {
              updated: status.result.updated,
              errors: status.result.errors,
            })}
          </p>
        )}
        {status?.state === "failed" && status.error && (
          <p className="text-xs text-red-400">{status.error}</p>
        )}
      </div>
    </div>
  );
}
