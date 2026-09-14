import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useFanartIntegration } from "@/pages/settings/useFanartIntegration";
import { useUpdateFanartIntegration } from "@/pages/settings/useUpdateFanartIntegration";
import { IntegrationSectionCard } from "@/pages/settings/_component/integrations/IntegrationSectionCard";

export function FanartIntegrationSection() {
  const { data, isLoading } = useFanartIntegration();
  return (
    <FanartIntegrationSectionImpl
      key={data?.integration?.type ?? "pending"}
      data={data}
      isLoading={isLoading}
    />
  );
}

function FanartIntegrationSectionImpl({
  data,
  isLoading,
}: {
  data: ReturnType<typeof useFanartIntegration>["data"];
  isLoading: boolean;
}) {
  const { t } = useTranslation("common");
  const saveMutation = useUpdateFanartIntegration();

  const [apiKey, setApiKey] = useState("");
  const [enabled, setEnabled] = useState(Boolean(data?.integration?.enabled));
  const keyIsSet = Boolean(data?.integration?.api_key_set);

  const isDirty = useMemo(() => {
    if (!data?.integration) return false;
    return apiKey !== "" || enabled !== Boolean(data.integration.enabled);
  }, [data, apiKey, enabled]);

  const handleCancel = () => {
    setApiKey("");
    setEnabled(Boolean(data?.integration.enabled));
  };

  const handleSave = () => {
    saveMutation
      .mutateAsync({ api_key: apiKey, enabled })
      .then(() => {
        setApiKey("");
        toast.success(t("settings.integrations.saveSuccess"));
      })
      .catch(() => toast.error(t("settings.integrations.saveError")));
  };

  return (
    <IntegrationSectionCard
      title="fanart.tv"
      description={t("settings.integrations.fanart.help")}
      enabled={enabled}
      onEnabledChange={setEnabled}
      onCancel={handleCancel}
      onSave={handleSave}
      loading={isLoading}
      saving={saveMutation.isPending}
      isDirty={isDirty}
    >
      <div>
        <label
          htmlFor="fanart-integration-section-api-key"
          className="block text-sm font-medium text-neutral-300 mb-2"
        >
          {t("settings.integrations.fanart.apiKey")}
        </label>
        <input
          id="fanart-integration-section-api-key"
          type="password"
          value={apiKey}
          onChange={(event) => setApiKey(event.target.value)}
          placeholder={
            keyIsSet
              ? t("settings.integrations.fanart.apiKeySetPlaceholder")
              : t("settings.integrations.fanart.apiKeyPlaceholder")
          }
          className="focus-ring w-full px-4 py-2 border border-neutral-600 rounded-lg bg-neutral-900 text-white font-mono"
        />
        <p className="mt-1 text-xs text-neutral-400">
          {t("settings.integrations.fanart.apiKeyHelp")}
        </p>
      </div>
    </IntegrationSectionCard>
  );
}
