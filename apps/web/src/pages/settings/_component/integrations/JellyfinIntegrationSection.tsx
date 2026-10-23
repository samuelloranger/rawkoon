import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useJellyfinIntegration } from "@/pages/settings/useJellyfinIntegration";
import { useUpdateJellyfinIntegration } from "@/pages/settings/useUpdateJellyfinIntegration";
import { toast } from "sonner";
import { IntegrationSectionCard } from "@/pages/settings/_component/integrations/IntegrationSectionCard";
import { Switch } from "@/components/ui/switch";
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
  const [signInEnabled, setSignInEnabled] = useState(
    Boolean(data?.integration?.sign_in_enabled),
  );
  const [openSignIn, setOpenSignIn] = useState(
    Boolean(data?.integration?.open_sign_in),
  );

  const isDirty = useMemo(() => {
    if (!data?.integration) return false;
    return (
      websiteUrl !== (data.integration.website_url || "") ||
      apiKey !== (data.integration.api_key || "") ||
      enabled !== Boolean(data.integration.enabled) ||
      signInEnabled !== Boolean(data.integration.sign_in_enabled) ||
      openSignIn !== Boolean(data.integration.open_sign_in)
    );
  }, [data, websiteUrl, apiKey, enabled, signInEnabled, openSignIn]);

  const handleCancel = () => {
    setWebsiteUrl(data?.integration.website_url || "");
    setApiKey(data?.integration.api_key || "");
    setEnabled(Boolean(data?.integration.enabled));
    setSignInEnabled(Boolean(data?.integration.sign_in_enabled));
    setOpenSignIn(Boolean(data?.integration.open_sign_in));
  };

  const handleSave = () => {
    saveMutation
      .mutateAsync({
        website_url: websiteUrl,
        api_key: apiKey,
        enabled,
        sign_in_enabled: signInEnabled,
        open_sign_in: openSignIn,
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
        <label
          htmlFor="jellyfin-integration-section-api-key"
          className="block text-sm font-medium text-neutral-300 mb-2"
        >
          {t("settings.integrations.jellyfin.apiKey")}
        </label>
        <input
          id="jellyfin-integration-section-api-key"
          type="password"
          value={apiKey}
          onChange={(event) => setApiKey(event.target.value)}
          placeholder={t("settings.integrations.jellyfin.apiKeyPlaceholder")}
          className="focus-ring w-full px-4 py-2 border border-neutral-600 rounded-lg bg-neutral-900 text-white font-mono"
        />
      </div>

      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm text-neutral-200">
            {t("settings.integrations.jellyfin.signIn")}
          </p>
          <p className="text-xs text-neutral-500">
            {t("settings.integrations.jellyfin.signInHelp")}
          </p>
        </div>
        <Switch
          checked={signInEnabled}
          onCheckedChange={setSignInEnabled}
          aria-label={t("settings.integrations.jellyfin.signIn")}
        />
      </div>

      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm text-neutral-200">
            {t("settings.integrations.jellyfin.openSignIn")}
          </p>
          <p className="text-xs text-neutral-500">
            {t("settings.integrations.jellyfin.openSignInHelp")}
          </p>
        </div>
        <Switch
          checked={openSignIn}
          onCheckedChange={setOpenSignIn}
          disabled={!signInEnabled}
          aria-label={t("settings.integrations.jellyfin.openSignIn")}
        />
      </div>
    </IntegrationSectionCard>
  );
}
