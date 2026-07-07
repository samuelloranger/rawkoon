import { useTranslation } from "react-i18next";
import { useJackettIntegration } from "@/pages/settings/useJackettIntegration";
import { useJackettIndexers } from "@/pages/settings/useJackettIndexers";
import { useUpdateJackettIntegration } from "@/pages/settings/useUpdateJackettIntegration";
import { IndexerManagerIntegrationSection } from "@/pages/settings/_component/integrations/IndexerManagerIntegrationSection";

export function JackettIntegrationSection() {
  const { data, isLoading } = useJackettIntegration();
  return (
    <JackettIntegrationSectionImpl
      key={data?.integration?.type ?? "pending"}
      data={data}
      isLoading={isLoading}
    />
  );
}

function JackettIntegrationSectionImpl({
  data,
  isLoading,
}: {
  data: ReturnType<typeof useJackettIntegration>["data"];
  isLoading: boolean;
}) {
  const { t } = useTranslation("common");
  const saveMutation = useUpdateJackettIntegration();

  return (
    <IndexerManagerIntegrationSection
      data={data}
      isLoading={isLoading}
      title="Jackett"
      description={t("settings.integrations.jackett.help")}
      saving={saveMutation.isPending}
      logoUrl="https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/png/jackett.png"
      translationKey="jackett"
      websiteUrlPlaceholder="https://jackett.example.com"
      save={saveMutation.mutateAsync}
      useIndexers={useJackettIndexers}
    />
  );
}
