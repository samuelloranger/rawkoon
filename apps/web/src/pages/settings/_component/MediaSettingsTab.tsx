import { useTranslation } from "react-i18next";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { SegmentedTabs } from "@/components/ui/segmented-tabs";
import { QualityProfilesTab } from "@/pages/settings/_component/QualityProfilesTab";
import { CustomFormatsTab } from "@/pages/settings/_component/CustomFormatsTab";
import { MediaPostProcessingTab } from "@/pages/settings/_component/MediaPostProcessingTab";
import { LibraryHistoryTab } from "@/pages/medias/_component/LibraryHistoryTab";
import { ArrLibraryImportPanel } from "@/pages/settings/_component/ArrLibraryImportPanel";
import {
  SlidersHorizontal,
  FolderTree,
  Film,
  Download,
  Clapperboard,
  Tags,
} from "lucide-react";
import { SettingsPageHeader } from "@/pages/settings/_component/SettingsPageHeader";

type MediaSubTab =
  | "quality-profiles"
  | "custom-formats"
  | "library-settings"
  | "history"
  | "import";

export function MediaSettingsTab() {
  const { t } = useTranslation("common");
  const navigate = useNavigate();
  const { subtab } = useSearch({ from: "/settings/" });
  const activeSubTab: MediaSubTab =
    (subtab as MediaSubTab | undefined) ?? "quality-profiles";

  const setSubTab = (subtab: MediaSubTab) => {
    navigate({
      to: "/settings",
      search: { tab: "media", subtab },
      replace: true,
    });
  };

  const subTabs = [
    {
      id: "quality-profiles" as const,
      label: t("settings.media.tabs.qualityProfiles"),
      icon: SlidersHorizontal,
    },
    {
      id: "custom-formats" as const,
      label: t("settings.media.tabs.customFormats"),
      icon: Tags,
    },
    {
      id: "library-settings" as const,
      label: t("settings.media.tabs.librarySettings"),
      icon: FolderTree,
    },
    {
      id: "history" as const,
      label: t("settings.media.tabs.history"),
      icon: Film,
    },
    {
      id: "import" as const,
      label: t("settings.media.tabs.import"),
      icon: Download,
    },
  ];

  return (
    <div className="space-y-6">
      <SettingsPageHeader
        icon={Clapperboard}
        title={t("settings.media.title")}
        description={t("settings.media.description")}
      />

      <SegmentedTabs
        items={subTabs}
        value={activeSubTab}
        onChange={setSubTab}
      />

      <div>
        {activeSubTab === "quality-profiles" && <QualityProfilesTab />}
        {activeSubTab === "custom-formats" && <CustomFormatsTab />}
        {activeSubTab === "library-settings" && <MediaPostProcessingTab />}
        {activeSubTab === "history" && <LibraryHistoryTab />}
        {activeSubTab === "import" && <ArrLibraryImportPanel />}
      </div>
    </div>
  );
}
