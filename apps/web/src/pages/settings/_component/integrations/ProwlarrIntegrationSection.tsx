import { useTranslation } from "react-i18next";
import { useProwlarrIntegration } from "@/pages/settings/useProwlarrIntegration";
import { useProwlarrIndexers } from "@/pages/settings/useProwlarrIndexers";
import { useUpdateProwlarrIntegration } from "@/pages/settings/useUpdateProwlarrIntegration";
import { IndexerManagerIntegrationSection } from "@/pages/settings/_component/integrations/IndexerManagerIntegrationSection";

export function ProwlarrIntegrationSection() {
  const { data, isLoading } = useProwlarrIntegration();
  return (
    <ProwlarrIntegrationSectionImpl
      key={data?.integration?.type ?? "pending"}
      data={data}
      isLoading={isLoading}
    />
  );
}

function ProwlarrIntegrationSectionImpl({
  data,
  isLoading,
}: {
  data: ReturnType<typeof useProwlarrIntegration>["data"];
  isLoading: boolean;
}) {
  const { t } = useTranslation("common");
  const saveMutation = useUpdateProwlarrIntegration();

  return (
    <IndexerManagerIntegrationSection
      data={data}
      isLoading={isLoading}
      title="Prowlarr"
      description={t("settings.integrations.prowlarr.help")}
      saving={saveMutation.isPending}
      logoUrl="https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/png/prowlarr.png"
      translationKey="prowlarr"
      websiteUrlPlaceholder="https://prowlarr.example.com"
      save={saveMutation.mutateAsync}
      useIndexers={useProwlarrIndexers}
    />
  );
}
