import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useUpdateMediaPostProcessingSettings } from "@/features/medias/hooks/useUpdateMediaPostProcessingSettings";
import type { ReleaseCheckValue } from "@/pages/settings/_component/ReleaseCheckFieldset";
import {
  mediaSettingsSchema,
  type MediaSettingsFormValues,
} from "@/pages/settings/_component/MediaPostProcessingForm";
import { MediaPostProcessingAddDialogSection } from "@/pages/settings/_component/MediaPostProcessingAddDialogSection";
import { CardSection } from "@/pages/settings/_component/MediaPostProcessingCardParts";
import { MediaPostProcessingDefaultsSection } from "@/pages/settings/_component/MediaPostProcessingDefaultsSection";
import { MediaPostProcessingFoldersSection } from "@/pages/settings/_component/MediaPostProcessingFoldersSection";
import { MediaPostProcessingMaintenanceSection } from "@/pages/settings/_component/MediaPostProcessingMaintenanceSection";
import { MediaPostProcessingScheduleSection } from "@/pages/settings/_component/MediaPostProcessingScheduleSection";
import type {
  MediaPostProcessingSettings,
  QualityProfilesListResponse,
} from "@rawkoon/shared/types";

interface MediaPostProcessingSettingsBodyProps {
  settings: MediaPostProcessingSettings;
  profilesData: QualityProfilesListResponse | undefined;
}

export function MediaPostProcessingSettingsBody({
  settings,
  profilesData,
}: MediaPostProcessingSettingsBodyProps) {
  const { t } = useTranslation("common");
  const updateMut = useUpdateMediaPostProcessingSettings();

  const {
    control,
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
      askBeforeAdding: settings.ask_before_adding,
      requestersChooseSeasons: settings.requesters_choose_seasons,
      defaultSeasonMode: settings.default_season_mode,
      defaultMonitorNewSeasons: settings.default_monitor_new_seasons,
      rssPollIntervalMinutes: String(settings.rss_poll_interval_minutes),
    },
  });

  const [releaseCheck, setReleaseCheck] = useState<ReleaseCheckValue>({
    cron: settings.release_check_cron,
    valid: true,
  });

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
        ask_before_adding: data.askBeforeAdding,
        requesters_choose_seasons: data.requestersChooseSeasons,
        default_season_mode: data.defaultSeasonMode,
        default_monitor_new_seasons: data.defaultMonitorNewSeasons,
        release_check_cron: releaseCheck.cron,
        rss_poll_interval_minutes: parseInt(data.rssPollIntervalMinutes, 10),
      });
      toast.success(t("settings.mediaLibrary.saveSuccess"));
    } catch {
      toast.error(t("settings.mediaLibrary.saveError"));
    }
  };

  return (
    <div className="space-y-4">
      <form className="space-y-4" onSubmit={handleSubmit(onSubmit)}>
        <MediaPostProcessingFoldersSection
          control={control}
          register={register}
          errors={errors}
        />

        <MediaPostProcessingDefaultsSection
          control={control}
          errors={errors}
          profilesData={profilesData}
        />

        <MediaPostProcessingAddDialogSection control={control} />

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

        <MediaPostProcessingScheduleSection
          control={control}
          initialCron={settings.release_check_cron}
          jackettActive={settings.active_indexer_manager === "jackett"}
          onReleaseCheckChange={setReleaseCheck}
        />

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

      <MediaPostProcessingMaintenanceSection />
    </div>
  );
}
