import { Controller } from "react-hook-form";
import type { Control, FieldErrors, UseFormRegister } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { AdvancedDisclosure } from "@/components/ui/advanced-disclosure";
import { FormInput } from "@/components/ui/form-field";
import {
  LABEL_CLASS,
  SELECT_CLASS,
  type MediaSettingsFormValues,
} from "@/pages/settings/_component/MediaPostProcessingForm";
import { CardSection } from "@/pages/settings/_component/MediaPostProcessingCardParts";

export function MediaPostProcessingFoldersSection({
  control,
  register,
  errors,
}: {
  control: Control<MediaSettingsFormValues>;
  register: UseFormRegister<MediaSettingsFormValues>;
  errors: FieldErrors<MediaSettingsFormValues>;
}) {
  const { t } = useTranslation("common");
  return (
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
        <Controller
          control={control}
          name="fileOperation"
          render={({ field }) => (
            <select
              id="media-post-processing-settings-body-file-operation"
              {...field}
              className={SELECT_CLASS}
            >
              <option value="hardlink">
                {t("settings.mediaLibrary.hardlink")}
              </option>
              <option value="move">{t("settings.mediaLibrary.move")}</option>
            </select>
          )}
        />
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
  );
}
