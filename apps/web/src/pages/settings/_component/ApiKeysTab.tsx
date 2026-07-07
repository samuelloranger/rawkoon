import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { KeyRound, Plus, Trash2, Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog } from "@/components/dialog";
import { LoadingState } from "@/components/LoadingState";
import { useConfirm } from "@/components/confirm/ConfirmContext";
import { useCurrentUser } from "@/lib/auth/useAuth";
import { formatDateTime } from "@rawkoon/shared/utils";
import { SettingsPageHeader } from "@/pages/settings/_component/SettingsPageHeader";
import { useApiKeys } from "@/pages/settings/useApiKeys";
import { useCreateApiKey } from "@/pages/settings/useCreateApiKey";
import { useDeleteApiKey } from "@/pages/settings/useDeleteApiKey";

function EmptyState({ message }: { message: string }) {
  return (
    <div className="text-center py-8 text-neutral-400 text-sm">{message}</div>
  );
}

function CreateApiKeyModal({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation("common");
  const createKey = useCreateApiKey();
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

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
      });
      setCreatedKey(res.key);
      toast.success(t("settings.apiKeys.createSuccess"));
    } catch {
      toast.error(t("settings.apiKeys.createError"));
    }
  };

  const handleCopy = async () => {
    if (!createdKey) return;
    await navigator.clipboard.writeText(createdKey);
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

export function ApiKeysTab() {
  const { t, i18n } = useTranslation("common");
  const { confirm } = useConfirm();
  const { data: currentUser } = useCurrentUser();
  const { data, isLoading } = useApiKeys();
  const deleteKey = useDeleteApiKey();
  const [showCreate, setShowCreate] = useState(false);

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
      <SettingsPageHeader
        icon={KeyRound}
        title={t("settings.apiKeys.title")}
        description={t("settings.apiKeys.description")}
      />

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
                    <td className="py-3 px-4 text-right">
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
    </div>
  );
}
