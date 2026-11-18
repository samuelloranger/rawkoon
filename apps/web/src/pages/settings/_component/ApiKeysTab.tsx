import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Plug, Plus, Trash2, Copy, Check } from "lucide-react";
import type { ApiKey, McpScope } from "@rawkoon/shared/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog } from "@/components/dialog";
import { LoadingState } from "@/components/LoadingState";
import { useConfirm } from "@/components/confirm/ConfirmContext";
import { useCurrentUser } from "@/lib/auth/useAuth";
import { copyToClipboard } from "@/lib/utils/clipboard";
import { buildMcpSetupCommands } from "@/lib/mcpSetupCommands";
import { formatDateTime } from "@rawkoon/shared/utils";
import { SettingsPageHeader } from "@/pages/settings/_component/SettingsPageHeader";
import { useApiKeys } from "@/pages/settings/useApiKeys";
import { useCreateApiKey } from "@/pages/settings/useCreateApiKey";
import { useDeleteApiKey } from "@/pages/settings/useDeleteApiKey";
import { useUpdateApiKeyScopes } from "@/pages/settings/useUpdateApiKeyScopes";

function EmptyState({ message }: { message: string }) {
  return (
    <div className="text-center py-8 text-neutral-400 text-sm">{message}</div>
  );
}

const SCOPE_KEYS: { scope: McpScope; labelKey: string }[] = [
  { scope: "read", labelKey: "settings.apiKeys.mcpScopeRead" },
  { scope: "request", labelKey: "settings.apiKeys.mcpScopeRequest" },
  { scope: "approve", labelKey: "settings.apiKeys.mcpScopeApprove" },
  { scope: "admin", labelKey: "settings.apiKeys.mcpScopeAdmin" },
];

/** The four MCP permission checkboxes, shared by the create and edit dialogs. */
function McpScopePicker({
  scopes,
  onToggle,
}: {
  scopes: McpScope[];
  onToggle: (scope: McpScope) => void;
}) {
  const { t } = useTranslation("common");
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
      {SCOPE_KEYS.map(({ scope, labelKey }) => (
        <label
          key={scope}
          className="flex items-center gap-2 cursor-pointer hover:bg-neutral-700/50 p-2 rounded-md border border-transparent hover:border-neutral-700"
        >
          <Checkbox
            checked={scopes.includes(scope)}
            onChange={() => onToggle(scope)}
          />
          <span className="text-sm text-neutral-300">{t(labelKey)}</span>
        </label>
      ))}
    </div>
  );
}

/** One command line with its own copy button, as in the rest of the app. */
function CopyableCommand({
  label,
  command,
  hint,
}: {
  label: string;
  command: string;
  hint?: string;
}) {
  const { t } = useTranslation("common");
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    if (!(await copyToClipboard(command))) {
      toast.error(t("common.copyFailed"));
      return;
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium text-neutral-400">{label}</span>
      <div className="flex items-center gap-2">
        <code className="flex-1 break-all rounded-md bg-neutral-900 border border-neutral-700 px-3 py-2 font-mono text-xs text-neutral-100 whitespace-pre-wrap">
          {command}
        </code>
        <Button
          size="sm"
          variant="secondary"
          onClick={handleCopy}
          className="gap-1.5 shrink-0"
        >
          {copied ? (
            <Check className="w-3.5 h-3.5" />
          ) : (
            <Copy className="w-3.5 h-3.5" />
          )}
          {copied ? t("settings.apiKeys.copied") : t("settings.apiKeys.copy")}
        </Button>
      </div>
      {hint && <span className="text-xs text-neutral-500">{hint}</span>}
    </div>
  );
}

function mcpEndpointUrl(): string {
  return `${window.location.origin}/api/mcp`;
}

/** The per-client setup commands for one key; the key is only shown right after creation. */
function McpSetupCommands({
  url,
  apiKey,
  freshKey,
}: {
  url: string;
  apiKey: string;
  freshKey: boolean;
}) {
  const { t } = useTranslation("common");
  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-neutral-500">
        {freshKey
          ? t("settings.apiKeys.mcpFreshHint")
          : t("settings.apiKeys.mcpPlaceholderHint")}
      </p>
      <CopyableCommand
        label={t("settings.apiKeys.mcpEndpoint")}
        command={url}
      />
      {buildMcpSetupCommands(url, apiKey).map((c) => (
        <CopyableCommand
          key={c.client}
          label={c.client}
          command={c.command}
          hint={c.hint}
        />
      ))}
    </div>
  );
}

const CREATE_KEY_PLACEHOLDER = "<your key>";

function CreateApiKeyModal({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation("common");
  const createKey = useCreateApiKey();
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [createdScopes, setCreatedScopes] = useState<McpScope[]>([]);
  const [copied, setCopied] = useState(false);
  const [scopes, setScopes] = useState<McpScope[]>([]);

  const createApiKeySchema = useMemo(
    () =>
      z.object({
        name: z.string().trim().min(1),
        expiryDays: z
          .string()
          .optional()
          .refine(
            (val) => {
              const trimmed = val?.trim() ?? "";
              if (trimmed === "") return true;
              const days = Number(trimmed);
              return Number.isInteger(days) && days >= 1 && days <= 365;
            },
            { message: t("settings.apiKeys.expiryRange") },
          ),
      }),
    [t],
  );

  type CreateApiKeyFormValues = z.infer<typeof createApiKeySchema>;

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<CreateApiKeyFormValues>({
    resolver: zodResolver(createApiKeySchema),
    defaultValues: {
      name: "",
      expiryDays: "",
    },
  });

  // react-hook-form's watch() opts this component out of React Compiler.
  // eslint-disable-next-line react-hooks/incompatible-library
  const nameValue = watch("name");

  const onSubmit = async (data: CreateApiKeyFormValues) => {
    const days = data.expiryDays?.trim()
      ? Number(data.expiryDays.trim())
      : undefined;
    try {
      const res = await createKey.mutateAsync({
        name: data.name,
        ...(days !== undefined ? { expires_in_days: days } : {}),
        ...(scopes.length > 0 ? { mcp_scopes: scopes } : {}),
      });
      setCreatedScopes(res.api_key.mcp_scopes);
      setCreatedKey(res.key);
      toast.success(t("settings.apiKeys.createSuccess"));
    } catch {
      toast.error(t("settings.apiKeys.createError"));
    }
  };

  const handleCopy = async () => {
    if (!createdKey) return;
    if (!(await copyToClipboard(createdKey))) {
      toast.error(t("common.copyFailed"));
      return;
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <Dialog
      isOpen
      onClose={onClose}
      title={
        createdKey
          ? t("settings.apiKeys.createdKeyTitle")
          : t("settings.apiKeys.createTitle")
      }
      panelClassName="max-w-lg"
    >
      {createdKey ? (
        <div className="flex flex-col gap-4 pt-2">
          <p className="text-sm text-amber-300">
            {t("settings.apiKeys.createdKeyWarning")}
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 break-all rounded-md bg-neutral-900 border border-neutral-700 px-3 py-2 font-mono text-xs text-neutral-100">
              {createdKey}
            </code>
            <Button
              size="sm"
              variant="secondary"
              onClick={handleCopy}
              className="gap-1.5 shrink-0"
            >
              {copied ? (
                <Check className="w-3.5 h-3.5" />
              ) : (
                <Copy className="w-3.5 h-3.5" />
              )}
              {copied
                ? t("settings.apiKeys.copied")
                : t("settings.apiKeys.copy")}
            </Button>
          </div>
          {createdScopes.length > 0 && (
            <McpSetupCommands
              url={mcpEndpointUrl()}
              apiKey={createdKey}
              freshKey
            />
          )}
          <div className="flex justify-end">
            <Button onClick={onClose}>{t("settings.apiKeys.done")}</Button>
          </div>
        </div>
      ) : (
        <form
          className="flex flex-col gap-4 pt-2"
          onSubmit={handleSubmit(onSubmit)}
        >
          <p className="text-sm text-neutral-400">
            {t("settings.apiKeys.createDescription")}
          </p>
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-neutral-300">
              {t("settings.apiKeys.name")}
            </span>
            <Input
              autoFocus
              {...register("name")}
              placeholder={t("settings.apiKeys.namePlaceholder")}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-neutral-300">
              {t("settings.apiKeys.expiryDaysLabel")}
            </span>
            <Input
              type="number"
              min={1}
              max={365}
              {...register("expiryDays")}
              placeholder={t("settings.apiKeys.expiryDaysPlaceholder")}
            />
            {errors.expiryDays && (
              <p className="mt-1 text-sm text-red-400">
                {errors.expiryDays.message}
              </p>
            )}
          </label>
          <fieldset className="flex flex-col gap-2">
            <legend className="text-sm font-medium text-neutral-300">
              {t("settings.apiKeys.mcpSection")}
            </legend>
            <p className="text-xs text-neutral-500">
              {t("settings.apiKeys.mcpHint")}
            </p>
            <McpScopePicker
              scopes={scopes}
              onToggle={(scope) =>
                setScopes((current) =>
                  current.includes(scope)
                    ? current.filter((s) => s !== scope)
                    : [...current, scope],
                )
              }
            />
          </fieldset>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              {t("common.cancel")}
            </Button>
            <Button
              type="submit"
              disabled={!nameValue?.trim() || createKey.isPending}
            >
              {t("settings.apiKeys.createSubmit")}
            </Button>
          </div>
        </form>
      )}
    </Dialog>
  );
}

/** Edit an existing key's MCP scopes; commands use a placeholder key. */
function EditMcpScopesModal({
  apiKey,
  onClose,
}: {
  apiKey: ApiKey;
  onClose: () => void;
}) {
  const { t } = useTranslation("common");
  const updateScopes = useUpdateApiKeyScopes();
  const [scopes, setScopes] = useState<McpScope[]>(apiKey.mcp_scopes);

  const handleSave = async () => {
    try {
      await updateScopes.mutateAsync({ id: apiKey.id, scopes });
      toast.success(t("settings.apiKeys.mcpSaveSuccess"));
      onClose();
    } catch {
      toast.error(t("settings.apiKeys.mcpSaveError"));
    }
  };

  return (
    <Dialog
      isOpen
      onClose={onClose}
      title={t("settings.apiKeys.mcpEditTitle")}
      panelClassName="max-w-lg"
    >
      <div className="flex flex-col gap-4 pt-2">
        <p className="text-sm text-neutral-400">
          {t("settings.apiKeys.mcpEditDescription", {
            name: apiKey.name || apiKey.start || "",
          })}
        </p>
        <McpScopePicker
          scopes={scopes}
          onToggle={(scope) =>
            setScopes((current) =>
              current.includes(scope)
                ? current.filter((s) => s !== scope)
                : [...current, scope],
            )
          }
        />
        {scopes.length > 0 && (
          <McpSetupCommands
            url={mcpEndpointUrl()}
            apiKey={CREATE_KEY_PLACEHOLDER}
            freshKey={false}
          />
        )}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button onClick={handleSave} disabled={updateScopes.isPending}>
            {t("settings.apiKeys.mcpSave")}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

export function ApiKeysTab() {
  const { t, i18n } = useTranslation("common");
  const { confirm } = useConfirm();
  const { data: currentUser } = useCurrentUser();
  const { data, isLoading } = useApiKeys();
  const deleteKey = useDeleteApiKey();
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState<ApiKey | null>(null);

  if (!currentUser?.is_admin) return null;

  const handleRevoke = (id: string) => {
    confirm({
      variant: "destructive",
      description: t("settings.apiKeys.revokeConfirm"),
      confirmLabel: t("settings.apiKeys.revoke"),
      onConfirm: async () => {
        try {
          await deleteKey.mutateAsync(id);
          toast.success(t("settings.apiKeys.revokeSuccess"));
        } catch {
          toast.error(t("settings.apiKeys.revokeError"));
        }
      },
    });
  };

  const keys = data?.api_keys ?? [];

  return (
    <div
      className="animate-in fade-in slide-in-from-right-4 duration-300 space-y-6"
      key="api-keys-tab"
    >
      <div className="bg-neutral-800 rounded-xl border border-neutral-700 p-6">
        <div className="mb-6 flex items-start justify-between gap-4">
          <SettingsPageHeader
            title={t("settings.apiKeys.title")}
            description={t("settings.apiKeys.description")}
          />
          <Button
            onClick={() => setShowCreate(true)}
            className="gap-1.5 shrink-0"
          >
            <Plus className="w-4 h-4" />
            {t("settings.apiKeys.create")}
          </Button>
        </div>

        {isLoading ? (
          <LoadingState />
        ) : keys.length === 0 ? (
          <EmptyState message={t("settings.apiKeys.noKeys")} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-neutral-700">
                  <th className="text-left py-3 px-4 font-medium text-neutral-300">
                    {t("settings.apiKeys.name")}
                  </th>
                  <th className="text-left py-3 px-4 font-medium text-neutral-300">
                    {t("settings.apiKeys.key")}
                  </th>
                  <th className="text-left py-3 px-4 font-medium text-neutral-300">
                    {t("settings.apiKeys.mcpColumn")}
                  </th>
                  <th className="text-left py-3 px-4 font-medium text-neutral-300 whitespace-nowrap">
                    {t("settings.apiKeys.lastUsed")}
                  </th>
                  <th className="text-left py-3 px-4 font-medium text-neutral-300 whitespace-nowrap">
                    {t("settings.apiKeys.expiresAt")}
                  </th>
                  <th className="text-left py-3 px-4 font-medium text-neutral-300 whitespace-nowrap">
                    {t("settings.apiKeys.createdAt")}
                  </th>
                  <th className="text-right py-3 px-4 font-medium text-neutral-300">
                    {t("settings.apiKeys.actions")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {keys.map((key) => (
                  <tr
                    key={key.id}
                    className="border-b border-neutral-700 hover:bg-neutral-700/50 transition-colors"
                  >
                    <td className="py-3 px-4 font-medium text-neutral-100">
                      {key.name || "—"}
                    </td>
                    <td className="py-3 px-4 font-mono text-xs text-neutral-400">
                      {key.start ? `${key.start}…` : "—"}
                    </td>
                    <td className="py-3 px-4">
                      {key.mcp_scopes.length === 0 ? (
                        <span className="text-neutral-600">—</span>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {key.mcp_scopes.map((scope) => (
                            <span
                              key={scope}
                              className="px-2 py-0.5 rounded-full border border-primary-700 text-primary-300 text-xs whitespace-nowrap"
                            >
                              {scope}
                            </span>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="py-3 px-4 text-neutral-400 whitespace-nowrap">
                      {key.last_used_at
                        ? formatDateTime(key.last_used_at, i18n.language)
                        : "—"}
                    </td>
                    <td className="py-3 px-4 text-neutral-400 whitespace-nowrap">
                      {key.expires_at
                        ? formatDateTime(key.expires_at, i18n.language)
                        : t("settings.apiKeys.never")}
                    </td>
                    <td className="py-3 px-4 text-neutral-400 whitespace-nowrap">
                      {formatDateTime(key.created_at, i18n.language)}
                    </td>
                    <td className="py-3 px-4 text-right whitespace-nowrap">
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => setEditing(key)}
                        className="gap-1.5"
                      >
                        <Plug className="w-3 h-3" />
                        {t("settings.apiKeys.mcpOpen")}
                      </Button>{" "}
                      <Button
                        size="sm"
                        onClick={() => handleRevoke(key.id)}
                        disabled={deleteKey.isPending}
                        variant="destructive"
                        className="gap-1.5"
                      >
                        <Trash2 className="w-3 h-3" />
                        {t("settings.apiKeys.revoke")}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showCreate && <CreateApiKeyModal onClose={() => setShowCreate(false)} />}
      {editing && (
        <EditMcpScopesModal apiKey={editing} onClose={() => setEditing(null)} />
      )}
    </div>
  );
}
