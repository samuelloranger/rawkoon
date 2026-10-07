import { useTranslation } from "react-i18next";
import { Sparkles } from "lucide-react";
import { SettingsPageHeader } from "@/pages/settings/_component/SettingsPageHeader";
import { AiProviderIntegrationSection } from "@/pages/settings/_component/integrations/AiProviderIntegrationSection";
import { AiStatsPanel } from "@/pages/settings/_component/ai/AiStatsPanel";
import { AiCallHistory } from "@/pages/settings/_component/ai/AiCallHistory";

export function AiSettingsTab() {
  const { t } = useTranslation("common");

  return (
    <div
      className="animate-in fade-in slide-in-from-right-4 duration-300 space-y-6"
      key="ai-tab"
    >
      <SettingsPageHeader
        icon={Sparkles}
        title={t("settings.ai.title")}
        description={t("settings.ai.description")}
      />
      <AiProviderIntegrationSection />
      <AiStatsPanel />
      <AiCallHistory />
    </div>
  );
}
