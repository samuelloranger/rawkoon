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
import {
  ReleaseCheckFieldset,
  type ReleaseCheckValue,
} from "@/pages/settings/_component/ReleaseCheckFieldset";
import { AdvancedDisclosure } from "@/components/ui/advanced-disclosure";
import {
  DEFAULT_RSS_POLL_INTERVAL_MINUTES,
  RSS_POLL_INTERVAL_MINUTES,
} from "@rawkoon/shared/utils";
import { useBookQualityProfiles } from "@/pages/books/_hooks/useBooks";
import type {
  MediaPostProcessingSettings,
  QualityProfilesListResponse,
} from "@rawkoon/shared/types";

interface MediaPostProcessingSettingsBodyProps {
  settings: MediaPostProcessingSettings;
  profilesData: QualityProfilesListResponse | undefined;
}

const SELECT_CLASS =
  "focus-ring w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-100";

const LABEL_CLASS = "block text-sm font-medium text-neutral-300 mb-1.5";

function CardSection({
  id,
  title,
  description,
  children,
  actions,
}: {
  id?: string;
  title: string;
  description?: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div
      id={id}
      className="scroll-mt-24 overflow-hidden rounded-xl border border-neutral-700 bg-neutral-800"
    >
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

function ProfileSelect({
  id,
  label,
  noneLabel,
  hint,
  profiles,
  error,
  registration,
}: {
  id: string;
  label: string;
  noneLabel: string;
  hint: string;
  profiles: { id: number; name: string }[];
  error?: string;
  registration: React.ComponentProps<"select">;
}) {
  return (
    <div>
      <label htmlFor={id} className={LABEL_CLASS}>
        {label}
      </label>
      <select id={id} {...registration} className={SELECT_CLASS}>
        <option value="">{noneLabel}</option>
        {profiles.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      {error && <p className="mt-1 text-sm text-red-400">{error}</p>}
      <p className="mt-1.5 text-xs text-neutral-400">{hint}</p>
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
        downloadsPath: z.string(),
        fileOperation: z.enum(["hardlink", "move"]),
        movieTemplate: z.string(),
        episodeTemplate: z.string(),
        defaultMovieQualityProfileId: z.string(),
        defaultShowQualityProfileId: z.string(),
        defaultBookQualityProfileId: z.string(),
        searchOnAdd: z.enum(["on", "off"]),
        rssPollIntervalMinutes: z.string(),
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
      downloadsPath: settings.downloads_path ?? "",
      fileOperation: settings.file_operation === "move" ? "move" : "hardlink",
      movieTemplate: settings.movie_template,
      episodeTemplate: settings.episode_template,
      defaultMovieQualityProfileId:
        settings.default_movie_quality_profile_id?.toString() ?? "",
      defaultShowQualityProfileId:
        settings.default_show_quality_profile_id?.toString() ?? "",
      defaultBookQualityProfileId:
        settings.default_book_quality_profile_id?.toString() ?? "",
      searchOnAdd: settings.search_on_add ? "on" : "off",
      rssPollIntervalMinutes: String(settings.rss_poll_interval_minutes),
    },
  });

  const [releaseCheck, setReleaseCheck] = useState<ReleaseCheckValue>({
    cron: settings.release_check_cron,
    valid: true,
  });
  const [scanPath, setScanPath] = useState("");
  const [scanType, setScanType] = useState<"movie" | "show">("movie");
  const [lastScan, setLastScan] = useState<{
    matched: number;
    unmatched: string[];
  } | null>(null);

  const { data: bookProfilesData } = useBookQualityProfiles();

  const onSubmit = async (data: MediaSettingsFormValues) => {
    try {
      await updateMut.mutateAsync({
        post_processing_enabled: data.postProcessingEnabled,
        movies_library_path: data.moviesPath.trim() || null,
        shows_library_path: data.showsPath.trim() || null,
        downloads_path: data.downloadsPath.trim() || null,
        file_operation: data.fileOperation,
        movie_template: data.movieTemplate,
        episode_template: data.episodeTemplate,
        default_movie_quality_profile_id:
          data.defaultMovieQualityProfileId === ""
            ? null
            : parseInt(data.defaultMovieQualityProfileId, 10),
        default_show_quality_profile_id:
          data.defaultShowQualityProfileId === ""
            ? null
            : parseInt(data.defaultShowQualityProfileId, 10),
        default_book_quality_profile_id:
          data.defaultBookQualityProfileId === ""
            ? null
            : parseInt(data.defaultBookQualityProfileId, 10),
        search_on_add: data.searchOnAdd === "on",
        release_check_cron: releaseCheck.cron,
        rss_poll_interval_minutes: parseInt(data.rssPollIntervalMinutes, 10),
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
      <form className="space-y-4" onSubmit={handleSubmit(onSubmit)}>
        {/* ── Folders ────────────────────────────────────────────────── */}
        <CardSection
          title={t("settings.library.folders.title")}
          description={t("settings.library.folders.description")}
        >
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
            <FormInput
              label={t("settings.mediaLibrary.downloadsPath")}
              {...register("downloadsPath")}
              placeholder="/data/downloads"
              className="font-mono text-xs"
              error={errors.downloadsPath?.message}
            />
          </div>

          <div>
            <label
              htmlFor="media-post-processing-settings-body-file-operation"
              className={LABEL_CLASS}
            >
              {t("settings.mediaLibrary.fileOperation")}
            </label>
            <select
              id="media-post-processing-settings-body-file-operation"
              {...register("fileOperation")}
              className={SELECT_CLASS}
            >
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

          <AdvancedDisclosure label={t("settings.library.folders.templates")}>
            <div>
              <label
                htmlFor="media-post-processing-settings-body-movie-template"
                className={LABEL_CLASS}
              >
                {t("settings.mediaLibrary.movieTemplate")}
              </label>
              <textarea
                id="media-post-processing-settings-body-movie-template"
                {...register("movieTemplate")}
                rows={2}
                className="focus-ring w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm font-mono text-neutral-100"
              />
              {errors.movieTemplate && (
                <p className="mt-1 text-sm text-red-400">
                  {errors.movieTemplate.message}
                </p>
              )}
            </div>
            <div>
              <label
                htmlFor="media-post-processing-settings-body-episode-template"
                className={LABEL_CLASS}
              >
                {t("settings.mediaLibrary.episodeTemplate")}
              </label>
              <textarea
                id="media-post-processing-settings-body-episode-template"
                {...register("episodeTemplate")}
                rows={2}
                className="focus-ring w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm font-mono text-neutral-100"
              />
              {errors.episodeTemplate && (
                <p className="mt-1 text-sm text-red-400">
                  {errors.episodeTemplate.message}
                </p>
              )}
            </div>
          </AdvancedDisclosure>
        </CardSection>

        {/* ── Defaults ───────────────────────────────────────────────── */}
        <CardSection
          id="library-defaults"
          title={t("settings.library.defaults.title")}
          description={t("settings.library.defaults.description")}
        >
          <ProfileSelect
            id="media-post-processing-settings-body-default-movie-quality-profile-id"
            label={t("settings.mediaLibrary.defaultMovieQualityProfile")}
            noneLabel={t(
              "settings.mediaLibrary.defaultMovieQualityProfileNone",
            )}
            hint={t("settings.mediaLibrary.defaultMovieQualityProfileHint")}
            profiles={profilesData?.profiles ?? []}
            error={errors.defaultMovieQualityProfileId?.message}
            registration={register("defaultMovieQualityProfileId")}
          />
          <ProfileSelect
            id="media-post-processing-settings-body-default-show-quality-profile-id"
            label={t("settings.mediaLibrary.defaultShowQualityProfile")}
            noneLabel={t("settings.mediaLibrary.defaultShowQualityProfileNone")}
            hint={t("settings.mediaLibrary.defaultShowQualityProfileHint")}
            profiles={profilesData?.profiles ?? []}
            error={errors.defaultShowQualityProfileId?.message}
            registration={register("defaultShowQualityProfileId")}
          />
          <ProfileSelect
            id="media-post-processing-settings-body-default-book-quality-profile-id"
            label={t("settings.books.files.defaultProfile")}
            noneLabel={t("settings.books.files.noDefaultProfile")}
            hint={t("settings.books.files.defaultProfileHint")}
            profiles={bookProfilesData?.profiles ?? []}
            error={errors.defaultBookQualityProfileId?.message}
            registration={register("defaultBookQualityProfileId")}
          />
        </CardSection>

        {/* ── Adding a title ─────────────────────────────────────────── */}
        <CardSection title={t("settings.mediaLibrary.searchOnAdd.title")}>
          <div className="space-y-2">
            {(["on", "off"] as const).map((value) => (
              <label
                key={value}
                className="flex items-start gap-2 text-sm text-neutral-200"
              >
                <input
                  type="radio"
                  value={value}
                  {...register("searchOnAdd")}
                  className="mt-0.5"
                />
                <span>
                  {value === "on"
                    ? t("settings.mediaLibrary.searchOnAdd.on")
                    : t("settings.mediaLibrary.searchOnAdd.off")}
                </span>
              </label>
            ))}
          </div>
        </CardSection>

        {/* ── How often to check ─────────────────────────────────────── */}
        <CardSection title={t("settings.library.schedule.title")}>
          <ReleaseCheckFieldset
            initialCron={settings.release_check_cron}
            onChange={setReleaseCheck}
          />
          <div>
            <label
              htmlFor="media-post-processing-settings-body-rss-poll-interval"
              className={LABEL_CLASS}
            >
              {t("settings.mediaLibrary.rssPoll.title")}
            </label>
            <select
              id="media-post-processing-settings-body-rss-poll-interval"
              {...register("rssPollIntervalMinutes")}
              className={SELECT_CLASS}
            >
              {RSS_POLL_INTERVAL_MINUTES.map((minutes) => (
                <option key={minutes} value={minutes}>
                  {minutes === DEFAULT_RSS_POLL_INTERVAL_MINUTES
                    ? t("settings.mediaLibrary.rssPoll.optionDefault", {
                        count: minutes,
                      })
                    : t("settings.mediaLibrary.rssPoll.option", {
                        count: minutes,
                      })}
                </option>
              ))}
            </select>
            <p className="mt-1.5 text-xs text-neutral-400">
              {t("settings.mediaLibrary.rssPoll.description")}
            </p>
            {settings.active_indexer_manager === "jackett" && (
              <p className="mt-1.5 text-xs text-amber-300/90">
                {t("settings.mediaLibrary.rssPoll.jackettCache")}
              </p>
            )}
          </div>
        </CardSection>

        <div>
          <Button
            type="submit"
            disabled={updateMut.isPending || !releaseCheck.valid}
          >
            {updateMut.isPending
              ? t("settings.mediaLibrary.saving")
              : t("settings.mediaLibrary.save")}
          </Button>
        </div>
      </form>

      <AdvancedDisclosure label={t("settings.library.maintenance")}>
        {/* ── Library scan ─────────────────────────────────────────────── */}
        <CardSection
          title={t("settings.mediaLibrary.scanTitle")}
          description={t("settings.mediaLibrary.scanDescription")}
        >
          <FormInput
            label={t("settings.mediaLibrary.scanPath")}
            value={scanPath}
            onChange={(e) => setScanPath(e.target.value)}
            placeholder="/data/Movies"
            className="font-mono text-xs"
          />
          <div>
            <label
              htmlFor="media-post-processing-settings-body-scan-type"
              className={LABEL_CLASS}
            >
              {t("settings.mediaLibrary.scanType")}
            </label>
            <select
              id="media-post-processing-settings-body-scan-type"
              value={scanType}
              onChange={(e) =>
                setScanType(e.target.value === "show" ? "show" : "movie")
              }
              className={SELECT_CLASS}
            >
              <option value="movie">
                {t("settings.mediaLibrary.scanMovies")}
              </option>
              <option value="show">
                {t("settings.mediaLibrary.scanShows")}
              </option>
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
      </AdvancedDisclosure>
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
