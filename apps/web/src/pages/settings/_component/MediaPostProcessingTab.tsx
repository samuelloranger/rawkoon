import { useTranslation } from "react-i18next";
import { Loader } from "@/components/Loader";
import { useMediaPostProcessingSettings } from "@/features/medias/hooks/useMediaPostProcessingSettings";
import { useQualityProfilesList } from "@/pages/settings/useQualityProfiles";
import { MediaPostProcessingSettingsBody } from "./MediaPostProcessingSettingsBody";
import { DownloadSafetySection } from "./DownloadSafetySection";
import { SeedingSettingsSection } from "./SeedingSettingsSection";

export function MediaPostProcessingTab() {
  const { t } = useTranslation("common");
  const { data, isLoading, error } = useMediaPostProcessingSettings();
  const { data: profilesData } = useQualityProfilesList();

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-16 text-neutral-500">
        <Loader size="md" />
        <span className="text-sm">{t("settings.mediaLibrary.loading")}</span>
      </div>
    );
  }

  if (error) {
    return (
      <p className="text-sm text-red-400">
        {t("settings.mediaLibrary.loadError")}
      </p>
    );
  }

  const settings = data?.settings;
  if (!settings) {
    return (
      <p className="text-sm text-red-400">
        {t("settings.mediaLibrary.loadError")}
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <MediaPostProcessingSettingsBody
        key={settings.updated_at}
        settings={settings}
        profilesData={profilesData}
      />
      <SeedingSettingsSection
        key={`seed-${settings.updated_at}`}
        settings={settings}
      />
      <DownloadSafetySection
        key={`safety-${settings.updated_at}`}
        settings={settings}
      />
    </div>
  );
}
