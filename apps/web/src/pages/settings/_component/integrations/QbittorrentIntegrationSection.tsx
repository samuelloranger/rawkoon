import { useTranslation } from "react-i18next";
import { useQbittorrentIntegration } from "@/pages/settings/useQbittorrentIntegration";
import { useUpdateQbittorrentIntegration } from "@/pages/settings/useUpdateQbittorrentIntegration";
import { useSetupQbittorrentAutorun } from "@/pages/settings/useSetupQbittorrentAutorun";
import { toast } from "sonner";
import { IntegrationSectionCard } from "@/pages/settings/_component/integrations/IntegrationSectionCard";
import { CredentialIntegrationFields } from "@/pages/settings/_component/integrations/CredentialIntegrationFields";
import { useCredentialIntegrationForm } from "@/pages/settings/_component/integrations/useCredentialIntegrationForm";

export function QbittorrentIntegrationSection() {
  const { data, isLoading } = useQbittorrentIntegration();
  return (
    <QbittorrentIntegrationSectionImpl
      key={data?.integration?.type ?? "pending"}
      data={data}
      isLoading={isLoading}
    />
  );
}

function QbittorrentIntegrationSectionImpl({
  data,
  isLoading,
}: {
  data: ReturnType<typeof useQbittorrentIntegration>["data"];
  isLoading: boolean;
}) {
  const { t } = useTranslation("common");
  const saveMutation = useUpdateQbittorrentIntegration();
  const autorunMutation = useSetupQbittorrentAutorun();
  const form = useCredentialIntegrationForm({
    integration: data?.integration,
    save: saveMutation.mutateAsync,
  });

  const canConfigureWebhooks =
    Boolean(data?.integration?.enabled) &&
    Boolean(data?.integration?.webhook_secret_configured) &&
    !form.isDirty;

  const handleConfigureWebhooks = () => {
    autorunMutation
      .mutateAsync({})
      .then((result) => {
        toast.success(
          t("settings.integrations.qbittorrent.configureWebhooksSuccess", {
            url: result.rawkoon_url,
          }),
        );
      })
      .catch((err: unknown) => {
        const message =
          err instanceof Error && err.message
            ? err.message
            : t("settings.integrations.qbittorrent.configureWebhooksError");
        toast.error(message);
      });
  };

  return (
    <IntegrationSectionCard
      title="qBittorrent"
      description={t("settings.integrations.qbittorrent.help")}
      enabled={form.enabled}
      onEnabledChange={form.setEnabled}
      onCancel={form.handleCancel}
      onSave={form.handleSave}
      loading={isLoading}
      saving={saveMutation.isPending}
      isDirty={form.isDirty}
      logoUrl="https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/png/qbittorrent.png"
    >
      <CredentialIntegrationFields
        websiteUrlLabel={t("settings.integrations.qbittorrent.websiteUrl")}
        websiteUrl={form.websiteUrl}
        onWebsiteUrlChange={form.setWebsiteUrl}
        websiteUrlPlaceholder="http://qbittorrent:8080"
        usernameLabel={t("settings.integrations.qbittorrent.username")}
        username={form.username}
        onUsernameChange={form.setUsername}
        passwordLabel={t("settings.integrations.qbittorrent.password")}
        password={form.password}
        onPasswordChange={form.setPassword}
        passwordPlaceholder={t(
          "settings.integrations.qbittorrent.passwordPlaceholder",
        )}
      />

      <div className="rounded-lg bg-neutral-900 border border-neutral-700 px-4 py-3 text-sm text-neutral-400 space-y-3">
        <p>{t("settings.integrations.qbittorrent.setupNote")}</p>
        {canConfigureWebhooks && (
          <button
            type="button"
            onClick={handleConfigureWebhooks}
            disabled={autorunMutation.isPending}
            className="inline-flex items-center rounded-lg border border-neutral-600 bg-neutral-900 px-3 py-1.5 text-sm font-medium text-neutral-100 hover:bg-neutral-800 disabled:opacity-50"
          >
            {autorunMutation.isPending
              ? t("settings.integrations.qbittorrent.configureWebhooksPending")
              : t("settings.integrations.qbittorrent.configureWebhooks")}
          </button>
        )}
      </div>
    </IntegrationSectionCard>
  );
}
