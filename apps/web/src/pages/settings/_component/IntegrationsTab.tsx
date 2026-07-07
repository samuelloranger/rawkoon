import { useTranslation } from "react-i18next";
import { Plug2 } from "lucide-react";
import { SettingsPageHeader } from "@/pages/settings/_component/SettingsPageHeader";
import { JellyfinIntegrationSection } from "@/pages/settings/_component/integrations/JellyfinIntegrationSection";
import { ProwlarrIntegrationSection } from "@/pages/settings/_component/integrations/ProwlarrIntegrationSection";
import { JackettIntegrationSection } from "@/pages/settings/_component/integrations/JackettIntegrationSection";
import { QbittorrentIntegrationSection } from "@/pages/settings/_component/integrations/QbittorrentIntegrationSection";
import { TmdbIntegrationSection } from "@/pages/settings/_component/integrations/TmdbIntegrationSection";
import { LocalAiIntegrationSection } from "@/pages/settings/_component/integrations/LocalAiIntegrationSection";

export function IntegrationsTab() {
  const { t } = useTranslation("common");

  return (
    <div
      className="animate-in fade-in slide-in-from-right-4 duration-300 space-y-6"
      key="integrations-tab"
    >
      <SettingsPageHeader
        icon={Plug2}
        title={t("settings.integrations.title")}
        description={t("settings.integrations.description")}
      />

      <div className="space-y-6 animate-in fade-in duration-200">
        <div className="space-y-3">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-500 px-1">
            {t("settings.integrations.groups.media")}
          </h3>
          <div className="space-y-3">
            <JellyfinIntegrationSection />
            <TmdbIntegrationSection />
          </div>
        </div>
        <div className="space-y-3">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-500 px-1">
            {t("settings.integrations.indexers")}
          </h3>
          <div className="space-y-3">
            <ProwlarrIntegrationSection />
            <JackettIntegrationSection />
          </div>
        </div>
        <div className="space-y-3">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-500 px-1">
            {t("settings.integrations.groups.infrastructure")}
          </h3>
          <div className="space-y-3">
            <QbittorrentIntegrationSection />
          </div>
        </div>
        <div className="space-y-3">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-500 px-1">
            {t("settings.integrations.groups.other")}
          </h3>
          <div className="space-y-3">
            <LocalAiIntegrationSection />
          </div>
        </div>
      </div>
    </div>
  );
}
