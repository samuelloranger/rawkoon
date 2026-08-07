import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  DownloadClientHookConfig,
  DownloadClientHookStatus,
  DownloadClientIntegration,
  DownloadClientType,
} from "@rawkoon/shared/types";
import { Check, ChevronDown, Copy } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useConfirm } from "@/components/confirm/ConfirmContext";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useFetcher } from "@/lib/api/context";
import { INTEGRATION_ENDPOINTS } from "@/lib/endpoints";
import { queryKeys } from "@/lib/queryKeys";
import { cn } from "@/lib/utils";
import { useDownloadClientIntegration } from "@/pages/settings/useDownloadClientIntegration";
import { useUpdateDownloadClientIntegration } from "@/pages/settings/useUpdateDownloadClientIntegration";
import { IntegrationSectionCard } from "./IntegrationSectionCard";
import { IntegrationUrlInput } from "./IntegrationUrlInput";

const HOOK_I18N = "settings.integrations.downloadClient.hook";

export function DownloadClientIntegrationSection() {
  const query = useDownloadClientIntegration();
  return (
    <>
      <DownloadClientIntegrationSectionImpl
        key={`${query.data?.integration.type ?? "pending"}-${query.data?.integration.client_type ?? ""}`}
        integration={query.data?.integration}
        loading={query.isLoading}
      />
      <DownloadClientHookSection />
    </>
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

function DownloadClientHookSection() {
  const query = useDownloadClientHook();
  return (
    <DownloadClientHookSectionImpl
      key={query.dataUpdatedAt || "pending"}
      config={query.data}
      loading={query.isLoading}
    />
  );
}

function useDownloadClientHook() {
  const fetcher = useFetcher();
  return useQuery({
    queryKey: queryKeys.integrations.downloadClientHook(),
    queryFn: () =>
      fetcher<DownloadClientHookConfig>(
        INTEGRATION_ENDPOINTS.DOWNLOAD_CLIENT_HOOK,
      ),
    refetchOnMount: "always",
    staleTime: 0,
  });
}

function DownloadClientHookSectionImpl({
  config,
  loading,
}: {
  config: DownloadClientHookConfig | undefined;
  loading: boolean;
}) {
  const { t } = useTranslation("common");
  const fetcher = useFetcher();
  const queryClient = useQueryClient();
  const { confirm } = useConfirm();

  const [callbackUrl, setCallbackUrl] = useState(config?.callbackUrl ?? "");
  const [autoConfigure, setAutoConfigure] = useState(
    config?.autoConfigure ?? true,
  );
  const [activeHookedSecs, setActiveHookedSecs] = useState(
    String(config?.activeHookedSecs ?? 120),
  );
  const [delugeOpen, setDelugeOpen] = useState(false);
  const [transmissionOpen, setTransmissionOpen] = useState(false);

  const notConfigured = config?.status === "not-configured";
  const status = config?.status;

  const isDirty = useMemo(() => {
    if (!config) return false;
    const secs = Number(activeHookedSecs);
    return (
      callbackUrl !== (config.callbackUrl ?? "") ||
      autoConfigure !== config.autoConfigure ||
      (Number.isFinite(secs) ? secs : -1) !== config.activeHookedSecs
    );
  }, [activeHookedSecs, autoConfigure, callbackUrl, config]);

  const save = useMutation({
    mutationFn: (body: {
      callbackUrl: string | null;
      autoConfigure: boolean;
      activeHookedSecs: number;
    }) =>
      fetcher<DownloadClientHookConfig>(
        INTEGRATION_ENDPOINTS.DOWNLOAD_CLIENT_HOOK,
        { method: "PUT", body },
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.integrations.downloadClientHook(),
      });
      toast.success(t(`${HOOK_I18N}.saveSuccess`));
    },
    onError: () => toast.error(t(`${HOOK_I18N}.saveError`)),
  });

  const rotate = useMutation({
    mutationFn: () =>
      fetcher<DownloadClientHookConfig>(
        INTEGRATION_ENDPOINTS.DOWNLOAD_CLIENT_HOOK_ROTATE,
        { method: "POST" },
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.integrations.downloadClientHook(),
      });
      toast.success(t(`${HOOK_I18N}.rotateSuccess`));
    },
    onError: () => toast.error(t(`${HOOK_I18N}.rotateError`)),
  });

  const handleSave = () => {
    const secs = Number(activeHookedSecs);
    if (!Number.isFinite(secs) || secs < 1) {
      toast.error(t(`${HOOK_I18N}.saveError`));
      return;
    }
    const trimmed = callbackUrl.trim();
    save.mutate({
      callbackUrl: trimmed === "" ? null : trimmed,
      autoConfigure,
      activeHookedSecs: Math.trunc(secs),
    });
  };

  const handleReset = () => {
    setCallbackUrl(config?.callbackUrl ?? "");
    setAutoConfigure(config?.autoConfigure ?? true);
    setActiveHookedSecs(String(config?.activeHookedSecs ?? 120));
  };

  const handleRotate = () => {
    confirm({
      variant: "destructive",
      description: t(`${HOOK_I18N}.rotateConfirm`),
      confirmLabel: t(`${HOOK_I18N}.rotate`),
      onConfirm: async () => {
        await rotate.mutateAsync();
      },
    });
  };

  const toggleDeluge = () => {
    if (notConfigured) return;
    setDelugeOpen((open) => !open);
  };

  const toggleTransmission = () => {
    if (notConfigured) return;
    setTransmissionOpen((open) => !open);
  };

  const delugeExpanded = !notConfigured && delugeOpen;
  const transmissionExpanded = !notConfigured && transmissionOpen;

  return (
    <div className="bg-neutral-800 rounded-xl border border-neutral-700 p-6 space-y-4">
      <div>
        <h3 className="text-base font-semibold text-neutral-100">
          {t(`${HOOK_I18N}.title`)}
        </h3>
        <p className="text-sm text-neutral-400 mt-0.5">
          {t(`${HOOK_I18N}.help`)}
        </p>
      </div>

      {loading && !config ? (
        <p className="text-sm text-neutral-400">{t("common.loading")}</p>
      ) : (
        <>
          {status && <HookStatusBanner status={status} config={config} />}

          <IntegrationUrlInput
            label={t(`${HOOK_I18N}.callbackUrl`)}
            value={callbackUrl}
            onChange={setCallbackUrl}
            placeholder={t(`${HOOK_I18N}.callbackUrlPlaceholder`)}
          />
          <p className="text-xs text-neutral-500 -mt-2">
            {t(`${HOOK_I18N}.callbackUrlHelp`)}
          </p>

          <div className="flex items-center justify-between gap-3 rounded-lg border border-neutral-700 bg-neutral-900/50 px-4 py-3">
            <div className="min-w-0">
              <p className="text-sm font-medium text-neutral-200">
                {t(`${HOOK_I18N}.autoConfigure`)}
              </p>
              <p className="text-xs text-neutral-500 mt-0.5">
                {t(`${HOOK_I18N}.autoConfigureHelp`)}
              </p>
            </div>
            <Switch
              checked={autoConfigure}
              onCheckedChange={setAutoConfigure}
            />
          </div>

          <LabeledField label={t(`${HOOK_I18N}.activeHookedSecs`)}>
            <input
              type="number"
              min={1}
              step={1}
              value={activeHookedSecs}
              onChange={(event) => setActiveHookedSecs(event.target.value)}
              className="w-full rounded-lg border border-neutral-600 bg-neutral-900 px-4 py-2 text-white"
            />
          </LabeledField>
          <p className="text-xs text-neutral-500 -mt-2">
            {t(`${HOOK_I18N}.activeHookedSecsHelp`)}
          </p>

          <div className="flex flex-wrap items-center gap-3">
            {isDirty && (
              <span className="text-xs text-amber-400 font-medium mr-auto">
                {t("settings.integrations.unsavedChanges")}
              </span>
            )}
            <div className="flex items-center gap-3 ml-auto">
              <Button
                type="button"
                variant="outline"
                onClick={handleReset}
                disabled={save.isPending || !isDirty}
              >
                {t("common.cancel")}
              </Button>
              <Button
                type="button"
                onClick={handleSave}
                disabled={save.isPending || !isDirty}
              >
                {save.isPending
                  ? t("common.loading")
                  : t("settings.integrations.save")}
              </Button>
            </div>
          </div>

          <div className="border-t border-neutral-700 pt-4 space-y-3">
            <Button
              type="button"
              variant="outline"
              onClick={handleRotate}
              disabled={rotate.isPending || !config}
            >
              {t(`${HOOK_I18N}.rotate`)}
            </Button>

            {notConfigured && (
              <p className="text-sm text-amber-300">
                {t(`${HOOK_I18N}.promptCallbackUrl`)}
              </p>
            )}

            <ScriptCollapse
              title={t(`${HOOK_I18N}.deluge.title`)}
              open={delugeExpanded}
              onToggle={toggleDeluge}
              disabled={notConfigured}
              script={config?.delugeScript ?? ""}
              step1={t(`${HOOK_I18N}.deluge.step1`)}
              step2={t(`${HOOK_I18N}.deluge.step2`)}
            />
            <ScriptCollapse
              title={t(`${HOOK_I18N}.transmission.title`)}
              open={transmissionExpanded}
              onToggle={toggleTransmission}
              disabled={notConfigured}
              script={config?.transmissionScript ?? ""}
              step1={t(`${HOOK_I18N}.transmission.step1`)}
              step2={t(`${HOOK_I18N}.transmission.step2`)}
            />
          </div>
        </>
      )}
    </div>
  );
}

function HookStatusBanner({
  status,
  config,
}: {
  status: DownloadClientHookStatus;
  config: DownloadClientHookConfig | undefined;
}) {
  const { t } = useTranslation("common");
  const isWarning = status === "foreign-program" || status === "stale";

  return (
    <div
      className={cn(
        "rounded-lg border p-3 space-y-3 text-sm",
        statusClass(status),
      )}
    >
      <p>{t(`${HOOK_I18N}.status.${status}`)}</p>
      {status === "foreign-program" && config?.qbittorrentCommand && (
        <CopyableBlock
          label={t(`${HOOK_I18N}.qbittorrentCommand`)}
          value={config.qbittorrentCommand}
          copyLabel={t(`${HOOK_I18N}.copyCommand`)}
          warning={isWarning}
        />
      )}
    </div>
  );
}

function statusClass(status: DownloadClientHookStatus): string {
  switch (status) {
    case "active":
      return "bg-green-900/20 border-green-800 text-green-200";
    case "foreign-program":
      return "bg-amber-900/20 border-amber-700 text-amber-200";
    case "stale":
    case "awaiting-first":
      return "bg-amber-900/20 border-amber-800 text-amber-200";
    default:
      return "bg-neutral-900/60 border-neutral-700 text-neutral-300";
  }
}

function ScriptCollapse({
  title,
  open,
  onToggle,
  disabled,
  script,
  step1,
  step2,
}: {
  title: string;
  open: boolean;
  onToggle: () => void;
  disabled: boolean;
  script: string;
  step1: string;
  step2: string;
}) {
  const { t } = useTranslation("common");

  return (
    <div
      className={cn(
        "rounded-lg border border-neutral-700 overflow-hidden",
        disabled && "opacity-60",
      )}
    >
      <button
        type="button"
        onClick={onToggle}
        disabled={disabled}
        className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left text-sm font-medium text-neutral-200 hover:bg-neutral-700/40 disabled:cursor-not-allowed"
      >
        <span>{title}</span>
        <ChevronDown
          className={cn(
            "h-4 w-4 text-neutral-400 transition-transform duration-200",
            open && "rotate-180",
          )}
        />
      </button>
      {open && (
        <div className="border-t border-neutral-700 px-4 py-3 space-y-3">
          <ol className="list-decimal list-inside space-y-1 text-xs text-neutral-400">
            <li>{step1}</li>
            <li>{step2}</li>
          </ol>
          <CopyableBlock
            label={t(`${HOOK_I18N}.copyScript`)}
            value={script}
            copyLabel={t(`${HOOK_I18N}.copyScript`)}
          />
        </div>
      )}
    </div>
  );
}

function CopyableBlock({
  label,
  value,
  copyLabel,
  warning,
}: {
  label: string;
  value: string;
  copyLabel: string;
  warning?: boolean;
}) {
  const { t } = useTranslation("common");
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    toast.success(t("common.copied"));
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="space-y-2">
      <p
        className={cn(
          "text-xs font-medium",
          warning ? "text-amber-200" : "text-neutral-400",
        )}
      >
        {label}
      </p>
      <div className="flex items-start gap-2">
        <pre className="flex-1 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 font-mono text-xs text-neutral-100">
          {value}
        </pre>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={() => void handleCopy()}
          className="gap-1.5 shrink-0"
        >
          {copied ? (
            <Check className="w-3.5 h-3.5" />
          ) : (
            <Copy className="w-3.5 h-3.5" />
          )}
          {copied ? t("common.copied") : copyLabel}
        </Button>
      </div>
    </div>
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
