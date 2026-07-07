import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useJellyfinIntegration } from "@/pages/settings/useJellyfinIntegration";
import { useUpdateJellyfinIntegration } from "@/pages/settings/useUpdateJellyfinIntegration";
import { toast } from "sonner";
import { IntegrationSectionCard } from "@/pages/settings/_component/integrations/IntegrationSectionCard";
import { IntegrationUrlInput } from "@/pages/settings/_component/integrations/IntegrationUrlInput";

export function JellyfinIntegrationSection() {
  const { data, isLoading } = useJellyfinIntegration();
  return (
    <JellyfinIntegrationSectionImpl
      key={data?.integration?.type ?? "pending"}
      data={data}
      isLoading={isLoading}
    />
  );
}

function JellyfinIntegrationSectionImpl({
  data,
  isLoading,
}: {
  data: ReturnType<typeof useJellyfinIntegration>["data"];
  isLoading: boolean;
}) {
  const { t } = useTranslation("common");
  const saveMutation = useUpdateJellyfinIntegration();

  const [websiteUrl, setWebsiteUrl] = useState(
    data?.integration?.website_url || "",
  );
  const [apiKey, setApiKey] = useState(data?.integration?.api_key || "");
  const [enabled, setEnabled] = useState(Boolean(data?.integration?.enabled));

  const isDirty = useMemo(() => {
    if (!data?.integration) return false;
    return (
      websiteUrl !== (data.integration.website_url || "") ||
      apiKey !== (data.integration.api_key || "") ||
      enabled !== Boolean(data.integration.enabled)
    );
  }, [data, websiteUrl, apiKey, enabled]);

  const handleCancel = () => {
    setWebsiteUrl(data?.integration.website_url || "");
    setApiKey(data?.integration.api_key || "");
    setEnabled(Boolean(data?.integration.enabled));
  };

  const handleSave = () => {
    saveMutation
      .mutateAsync({
        website_url: websiteUrl,
        api_key: apiKey,
        enabled,
      })
      .then(() => toast.success(t("settings.integrations.saveSuccess")))
      .catch(() => toast.error(t("settings.integrations.saveError")));
  };

  return (
    <IntegrationSectionCard
      title="Jellyfin"
      description={t("settings.integrations.jellyfin.help")}
      enabled={enabled}
      onEnabledChange={setEnabled}
      onCancel={handleCancel}
      onSave={handleSave}
      loading={isLoading}
      saving={saveMutation.isPending}
      isDirty={isDirty}
      logoUrl="https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/png/jellyfin.png"
    >
      <IntegrationUrlInput
        label={t("settings.integrations.jellyfin.websiteUrl")}
        value={websiteUrl}
        onChange={setWebsiteUrl}
        placeholder="https://jellyfin.example.com"
      />

      <div>
        <label className="block text-sm font-medium text-neutral-300 mb-2">
          {t("settings.integrations.jellyfin.apiKey")}
        </label>
        <input
          type="password"
          value={apiKey}
          onChange={(event) => setApiKey(event.target.value)}
          placeholder={t("settings.integrations.jellyfin.apiKeyPlaceholder")}
          className="w-full px-4 py-2 border border-neutral-600 rounded-lg bg-neutral-900 text-white font-mono"
        />
      </div>
    </IntegrationSectionCard>
  );
}
