import { useMemo, useState } from "react";
import type {
  DownloadClientIntegration,
  DownloadClientType,
} from "@rawkoon/shared/types";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useFetcher } from "@/lib/api/context";
import { INTEGRATION_ENDPOINTS } from "@/lib/endpoints";
import { useDownloadClientIntegration } from "@/pages/settings/useDownloadClientIntegration";
import { useUpdateDownloadClientIntegration } from "@/pages/settings/useUpdateDownloadClientIntegration";
import { IntegrationSectionCard } from "./IntegrationSectionCard";
import { IntegrationUrlInput } from "./IntegrationUrlInput";

export function DownloadClientIntegrationSection() {
  const query = useDownloadClientIntegration();
  return (
    <DownloadClientIntegrationSectionImpl
      key={`${query.data?.integration.type ?? "pending"}-${query.data?.integration.client_type ?? ""}`}
      integration={query.data?.integration}
      loading={query.isLoading}
    />
  );
}

function DownloadClientIntegrationSectionImpl({
  integration,
  loading,
}: {
  integration: DownloadClientIntegration | undefined;
  loading: boolean;
}) {
  const { t } = useTranslation("common");
  const fetcher = useFetcher();
  const save = useUpdateDownloadClientIntegration();
  const [clientType, setClientType] = useState<DownloadClientType>(
    integration?.client_type ?? "qbittorrent",
  );
  const [websiteUrl, setWebsiteUrl] = useState(integration?.website_url ?? "");
  const [username, setUsername] = useState(integration?.username ?? "");
  const [password, setPassword] = useState("");
  const [label, setLabel] = useState(integration?.label ?? "rawkoon");
  const [savePath, setSavePath] = useState(integration?.save_path ?? "");
  const [enabled, setEnabled] = useState(integration?.enabled ?? false);
  const [testing, setTesting] = useState(false);

  const isDirty = useMemo(
    () =>
      Boolean(integration) &&
      (clientType !== integration?.client_type ||
        websiteUrl !== (integration?.website_url ?? "") ||
        username !== (integration?.username ?? "") ||
        password !== "" ||
        label !== (integration?.label ?? "rawkoon") ||
        savePath !== (integration?.save_path ?? "") ||
        enabled !== Boolean(integration?.enabled)),
    [
      clientType,
      enabled,
      integration,
      label,
      password,
      savePath,
      username,
      websiteUrl,
    ],
  );

  const reset = () => {
    setClientType(integration?.client_type ?? "qbittorrent");
    setWebsiteUrl(integration?.website_url ?? "");
    setUsername(integration?.username ?? "");
    setPassword("");
    setLabel(integration?.label ?? "rawkoon");
    setSavePath(integration?.save_path ?? "");
    setEnabled(integration?.enabled ?? false);
  };

  const handleSave = () => {
    save
      .mutateAsync({
        client_type: clientType,
        website_url: websiteUrl,
        username: clientType === "deluge" ? "" : username,
        password: password.trim() || undefined,
        enabled,
        label,
        save_path: savePath.trim() || undefined,
      })
      .then(() => {
        setPassword("");
        toast.success(t("settings.integrations.saveSuccess"));
      })
      .catch(() => toast.error(t("settings.integrations.saveError")));
  };

  const handleTest = async () => {
    setTesting(true);
    try {
      const result = await fetcher<{ ok: boolean; error?: string }>(
        INTEGRATION_ENDPOINTS.DOWNLOAD_CLIENT_TEST,
        { method: "POST" },
      );
      if (result.ok)
        toast.success(t("settings.integrations.downloadClient.testSuccess"));
      else
        toast.error(
          result.error ?? t("settings.integrations.downloadClient.testError"),
        );
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("settings.integrations.downloadClient.testError"),
      );
    } finally {
      setTesting(false);
    }
  };

  const placeholder =
    clientType === "transmission"
      ? "http://transmission:9091"
      : clientType === "deluge"
        ? "http://deluge:8112"
        : "http://qbittorrent:8080";

  return (
    <IntegrationSectionCard
      title={t("settings.integrations.downloadClient.title")}
      description={t("settings.integrations.downloadClient.help")}
      enabled={enabled}
      onEnabledChange={setEnabled}
      onCancel={reset}
      onSave={handleSave}
      loading={loading}
      saving={save.isPending}
      isDirty={isDirty}
    >
      <LabeledField label={t("settings.integrations.downloadClient.client")}>
        <select
          value={clientType}
          onChange={(event) =>
            setClientType(event.target.value as DownloadClientType)
          }
          className="w-full rounded-lg border border-neutral-600 bg-neutral-900 px-4 py-2 text-white"
        >
          <option value="qbittorrent">qBittorrent</option>
          <option value="transmission">Transmission</option>
          <option value="deluge">Deluge</option>
        </select>
      </LabeledField>
      <IntegrationUrlInput
        label={t("settings.integrations.downloadClient.websiteUrl")}
        value={websiteUrl}
        onChange={setWebsiteUrl}
        placeholder={placeholder}
      />
      {clientType !== "deluge" && (
        <TextField
          label={t("settings.integrations.downloadClient.username")}
          value={username}
          onChange={setUsername}
        />
      )}
      <TextField
        type="password"
        label={t("settings.integrations.downloadClient.password")}
        value={password}
        onChange={setPassword}
        placeholder={t(
          "settings.integrations.downloadClient.passwordPlaceholder",
        )}
      />
      <TextField
        label={t("settings.integrations.downloadClient.label")}
        value={label}
        onChange={setLabel}
      />
      <TextField
        label={t("settings.integrations.downloadClient.savePath")}
        value={savePath}
        onChange={setSavePath}
        placeholder="/downloads"
      />
      <Button
        type="button"
        variant="outline"
        onClick={handleTest}
        disabled={testing || isDirty}
      >
        {testing
          ? t("settings.integrations.downloadClient.testing")
          : t("settings.integrations.downloadClient.test")}
      </Button>
    </IntegrationSectionCard>
  );
}

function LabeledField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block text-sm font-medium text-neutral-300">
      <span className="mb-2 block">{label}</span>
      {children}
    </label>
  );
}

function TextField({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  placeholder?: string;
}) {
  return (
    <LabeledField label={label}>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="w-full rounded-lg border border-neutral-600 bg-neutral-900 px-4 py-2 text-white"
      />
    </LabeledField>
  );
}
