import { Controller } from "react-hook-form";
import type { Control, FieldErrors } from "react-hook-form";
import { useTranslation } from "react-i18next";
import type { QualityProfilesListResponse } from "@rawkoon/shared/types";
import type { MediaSettingsFormValues } from "@/pages/settings/_component/MediaPostProcessingForm";
import {
  CardSection,
  ProfileSelect,
} from "@/pages/settings/_component/MediaPostProcessingCardParts";
import { useBookQualityProfiles } from "@/pages/books/_hooks/useBooks";

export function MediaPostProcessingDefaultsSection({
  control,
  errors,
  profilesData,
}: {
  control: Control<MediaSettingsFormValues>;
  errors: FieldErrors<MediaSettingsFormValues>;
  profilesData: QualityProfilesListResponse | undefined;
}) {
  const { t } = useTranslation("common");
  const { data: bookProfilesData } = useBookQualityProfiles();
  return (
    <CardSection
      id="library-defaults"
      title={t("settings.library.defaults.title")}
      description={t("settings.library.defaults.description")}
    >
      <Controller
        control={control}
        name="defaultMovieQualityProfileId"
        render={({ field }) => (
          <ProfileSelect
            id="media-post-processing-settings-body-default-movie-quality-profile-id"
            label={t("settings.mediaLibrary.defaultMovieQualityProfile")}
            noneLabel={t(
              "settings.mediaLibrary.defaultMovieQualityProfileNone",
            )}
            hint={t("settings.mediaLibrary.defaultMovieQualityProfileHint")}
            profiles={profilesData?.profiles ?? []}
            error={errors.defaultMovieQualityProfileId?.message}
            registration={field}
          />
        )}
      />
      <Controller
        control={control}
        name="defaultShowQualityProfileId"
        render={({ field }) => (
          <ProfileSelect
            id="media-post-processing-settings-body-default-show-quality-profile-id"
            label={t("settings.mediaLibrary.defaultShowQualityProfile")}
            noneLabel={t("settings.mediaLibrary.defaultShowQualityProfileNone")}
            hint={t("settings.mediaLibrary.defaultShowQualityProfileHint")}
            profiles={profilesData?.profiles ?? []}
            error={errors.defaultShowQualityProfileId?.message}
            registration={field}
          />
        )}
      />
      <Controller
        control={control}
        name="defaultBookQualityProfileId"
        render={({ field }) => (
          <ProfileSelect
            id="media-post-processing-settings-body-default-book-quality-profile-id"
            label={t("settings.books.files.defaultProfile")}
            noneLabel={t("settings.books.files.noDefaultProfile")}
            hint={t("settings.books.files.defaultProfileHint")}
            profiles={bookProfilesData?.profiles ?? []}
            error={errors.defaultBookQualityProfileId?.message}
            registration={field}
          />
        )}
      />
    </CardSection>
  );
}
