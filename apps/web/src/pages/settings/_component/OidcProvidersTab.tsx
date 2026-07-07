import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useTranslation } from "react-i18next";
import { Copy, KeyRound, Pencil, Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import type { OidcProvider } from "@rawkoon/shared/types";
import { Switch } from "@/components/ui/switch";
import {
  useOidcProviders,
  useCreateOidcProvider,
  useUpdateOidcProvider,
  useDeleteOidcProvider,
  oidcProviderIconUrl,
} from "@/lib/auth/useOidcProviders";
import { SettingsPageHeader } from "@/pages/settings/_component/SettingsPageHeader";

const INPUT_CLASS =
  "w-full px-4 py-2 border border-neutral-600 rounded-lg bg-neutral-900 text-white font-mono text-sm";
const LABEL_CLASS = "block text-sm font-medium text-neutral-300 mb-2";

const oidcProviderSchema = z.object({
  name: z.string(),
  slug: z.string(),
  discovery_url: z.string(),
  icon_url: z.string(),
  client_id: z.string(),
  client_secret: z.string(),
  enabled: z.boolean(),
});

type OidcProviderFormValues = z.infer<typeof oidcProviderSchema>;

const emptyForm = (): OidcProviderFormValues => ({
  name: "",
  slug: "",
  discovery_url: "",
  icon_url: "",
  client_id: "",
  client_secret: "",
  enabled: true,
});

function ProviderForm({
  initial,
  isEdit,
  secretIsSet,
  onSave,
  onCancel,
  saving,
}: {
  initial: OidcProviderFormValues;
  isEdit: boolean;
  secretIsSet: boolean;
  onSave: (data: OidcProviderFormValues) => void;
  onCancel: () => void;
  saving: boolean;
}) {
  const { t } = useTranslation("common");
  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<OidcProviderFormValues>({
    resolver: zodResolver(oidcProviderSchema),
    defaultValues: initial,
  });

  // react-hook-form's watch() opts this component out of React Compiler.
  // eslint-disable-next-line react-hooks/incompatible-library
  const slug = watch("slug");
  const iconUrl = watch("icon_url");
  const enabled = watch("enabled");
  const apiBase = import.meta.env.VITE_API_URL || window.location.origin;
  const redirectUri = slug ? `${apiBase}/api/auth/oauth2/callback/${slug}` : "";

  const onSubmit = (data: OidcProviderFormValues) => {
    onSave(data);
  };

  return (
    <form className="space-y-4" onSubmit={handleSubmit(onSubmit)}>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className={LABEL_CLASS}>
            {t("settings.integrations.sso.providerName")}
          </label>
          <input
            type="text"
            {...register("name")}
            placeholder={t("settings.integrations.sso.providerNamePlaceholder")}
            className={INPUT_CLASS}
          />
          {errors.name && (
            <p className="mt-1 text-sm text-red-400">{errors.name.message}</p>
          )}
        </div>
        <div>
          <label className={LABEL_CLASS}>
            {t("settings.integrations.sso.providerSlug")}
          </label>
          <input
            type="text"
            {...register("slug")}
            placeholder={t("settings.integrations.sso.providerSlugPlaceholder")}
            className={INPUT_CLASS}
            readOnly={isEdit}
            disabled={isEdit}
          />
          {errors.slug && (
            <p className="mt-1 text-sm text-red-400">{errors.slug.message}</p>
          )}
          <p className="mt-1 text-xs text-neutral-400">
            {t("settings.integrations.sso.providerSlugHelp")}
          </p>
        </div>
      </div>

      {redirectUri && (
        <div>
          <label className={LABEL_CLASS}>
            {t("settings.integrations.sso.redirectUri")}
          </label>
          <div className="flex items-center gap-2">
            <input
              type="text"
              readOnly
              value={redirectUri}
              className="flex-1 px-4 py-2 border border-neutral-600 rounded-lg bg-neutral-800 text-neutral-300 font-mono text-sm cursor-default"
            />
            <button
              type="button"
              onClick={() => {
                navigator.clipboard.writeText(redirectUri);
                toast.success(t("common.copied"));
              }}
              className="p-2 rounded-lg border border-neutral-600 hover:bg-neutral-700 text-neutral-400 transition-colors"
            >
              <Copy className="size-4" />
            </button>
          </div>
          <p className="mt-1 text-xs text-neutral-400">
            {t("settings.integrations.sso.redirectUriHelp")}
          </p>
        </div>
      )}

      <div>
        <label className={LABEL_CLASS}>
          {t("settings.integrations.sso.discoveryUrl")}
        </label>
        <input
          type="url"
          {...register("discovery_url")}
          placeholder={t("settings.integrations.sso.discoveryUrlPlaceholder")}
          className={INPUT_CLASS}
        />
        {errors.discovery_url && (
          <p className="mt-1 text-sm text-red-400">
            {errors.discovery_url.message}
          </p>
        )}
      </div>

      <div>
        <label className={LABEL_CLASS}>
          {t("settings.integrations.sso.iconUrl")}
        </label>
        <div className="flex items-center gap-3">
          <input
            type="url"
            {...register("icon_url")}
            placeholder={t("settings.integrations.sso.iconUrlPlaceholder")}
            className="flex-1 px-4 py-2 border border-neutral-600 rounded-lg bg-neutral-900 text-white font-mono text-sm"
          />
          {iconUrl && (
            <img
              src={iconUrl}
              alt=""
              className="size-8 rounded object-contain bg-neutral-800 p-0.5"
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = "none";
              }}
            />
          )}
        </div>
        {errors.icon_url && (
          <p className="mt-1 text-sm text-red-400">{errors.icon_url.message}</p>
        )}
        <p className="mt-1 text-xs text-neutral-400">
          {t("settings.integrations.sso.iconUrlHelp")}
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className={LABEL_CLASS}>
            {t("settings.integrations.sso.clientId")}
          </label>
          <input
            type="text"
            {...register("client_id")}
            placeholder={t("settings.integrations.sso.clientIdPlaceholder")}
            className={INPUT_CLASS}
          />
          {errors.client_id && (
            <p className="mt-1 text-sm text-red-400">
              {errors.client_id.message}
            </p>
          )}
        </div>
        <div>
          <label className={LABEL_CLASS}>
            {t("settings.integrations.sso.clientSecret")}
          </label>
          <input
            type="password"
            {...register("client_secret")}
            placeholder={
              secretIsSet
                ? t("settings.integrations.sso.clientSecretPlaceholderSet")
                : t("settings.integrations.sso.clientSecretPlaceholder")
            }
            className={INPUT_CLASS}
          />
          {errors.client_secret && (
            <p className="mt-1 text-sm text-red-400">
              {errors.client_secret.message}
            </p>
          )}
        </div>
      </div>

      <div className="flex items-center gap-3">
        <Switch
          checked={enabled}
          onCheckedChange={(checked) => setValue("enabled", checked)}
        />
        <span className="text-sm text-neutral-300">
          {t("settings.integrations.sso.enabled")}
        </span>
      </div>

      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="outline" onClick={onCancel}>
          {t("settings.integrations.sso.cancel")}
        </Button>
        <Button type="submit" disabled={saving}>
          {t("settings.integrations.sso.saveProvider")}
        </Button>
      </div>
    </form>
  );
}

function ProviderRow({
  provider,
  onEdit,
  onDelete,
}: {
  provider: OidcProvider;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation("common");
  return (
    <div className="flex items-center justify-between px-4 py-3 rounded-lg border border-neutral-700 bg-neutral-800">
      <div className="flex items-center gap-3 min-w-0">
        <img
          src={oidcProviderIconUrl(provider.slug, provider.icon_url)}
          alt=""
          className="size-6 rounded object-contain shrink-0"
          onError={(e) => {
            (e.target as HTMLImageElement).style.display = "none";
          }}
        />
        <div className="min-w-0">
          <p className="text-sm font-medium text-white truncate">
            {provider.name}
          </p>
          <p className="text-xs text-neutral-400 font-mono">{provider.slug}</p>
        </div>
        <span
          className={`shrink-0 text-xs font-medium px-2 py-0.5 rounded-full ${
            provider.enabled
              ? "bg-green-900/30 text-green-400"
              : "bg-neutral-700 text-neutral-400"
          }`}
        >
          {provider.enabled
            ? t("settings.integrations.sso.enabled")
            : t("settings.integrations.sso.disabled")}
        </span>
      </div>
      <div className="flex items-center gap-1 ml-4">
        <button
          type="button"
          onClick={onEdit}
          className="p-2 rounded-lg hover:bg-neutral-700 text-neutral-400 transition-colors"
        >
          <Pencil className="size-4" />
        </button>
        <button
          type="button"
          onClick={onDelete}
          className="p-2 rounded-lg hover:bg-red-900/20 text-neutral-400 hover:text-red-400 transition-colors"
        >
          <Trash2 className="size-4" />
        </button>
      </div>
    </div>
  );
}

export function OidcProvidersTab() {
  const { t } = useTranslation("common");
  const { data, isLoading } = useOidcProviders();
  const createMutation = useCreateOidcProvider();
  const updateMutation = useUpdateOidcProvider();
  const deleteMutation = useDeleteOidcProvider();

  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const providers = data?.providers ?? [];

  const handleCreate = (form: OidcProviderFormValues) => {
    createMutation
      .mutateAsync({
        slug: form.slug,
        name: form.name,
        discovery_url: form.discovery_url,
        client_id: form.client_id,
        client_secret: form.client_secret,
        enabled: form.enabled,
        icon_url: form.icon_url.trim() || null,
      })
      .then(() => {
        setAdding(false);
        toast.success(t("settings.integrations.saveSuccess"));
      })
      .catch(() => toast.error(t("settings.integrations.saveError")));
  };

  const handleUpdate = (
    provider: OidcProvider,
    form: OidcProviderFormValues,
  ) => {
    updateMutation
      .mutateAsync({
        id: provider.id,
        name: form.name,
        discovery_url: form.discovery_url,
        client_id: form.client_id,
        ...(form.client_secret ? { client_secret: form.client_secret } : {}),
        enabled: form.enabled,
        icon_url: form.icon_url.trim() || null,
      })
      .then(() => {
        setEditingId(null);
        toast.success(t("settings.integrations.saveSuccess"));
      })
      .catch(() => toast.error(t("settings.integrations.saveError")));
  };

  const handleDelete = (provider: OidcProvider) => {
    deleteMutation
      .mutateAsync(provider.id)
      .then(() => {
        setDeletingId(null);
        toast.success(t("settings.integrations.saveSuccess"));
      })
      .catch(() => toast.error(t("settings.integrations.saveError")));
  };

  return (
    <div className="space-y-6">
      <SettingsPageHeader
        icon={KeyRound}
        title={t("settings.integrations.sso.title")}
        description={t("settings.integrations.sso.help")}
      />

      {isLoading ? (
        <div className="space-y-2">
          {[1, 2].map((i) => (
            <div
              key={i}
              className="h-14 rounded-lg bg-neutral-800 animate-pulse"
            />
          ))}
        </div>
      ) : (
        <div className="space-y-2">
          {providers.length === 0 && !adding && (
            <p className="text-sm text-neutral-400 py-4 text-center">
              {t("settings.integrations.sso.noProviders")}
            </p>
          )}

          {providers.map((provider) =>
            editingId === provider.id ? (
              <div
                key={provider.id}
                className="p-4 rounded-lg border border-primary-700 bg-neutral-800"
              >
                <div className="flex items-center justify-between mb-4">
                  <p className="text-sm font-medium text-white">
                    {t("settings.integrations.sso.editProvider")}
                  </p>
                  <button
                    type="button"
                    onClick={() => setEditingId(null)}
                    className="p-1 rounded hover:bg-neutral-700 text-neutral-400"
                  >
                    <X className="size-4" />
                  </button>
                </div>
                <ProviderForm
                  initial={{
                    name: provider.name,
                    slug: provider.slug,
                    discovery_url: provider.discovery_url,
                    icon_url: provider.icon_url ?? "",
                    client_id: provider.client_id,
                    client_secret: "",
                    enabled: provider.enabled,
                  }}
                  isEdit
                  secretIsSet={provider.client_secret_set}
                  onSave={(form) => handleUpdate(provider, form)}
                  onCancel={() => setEditingId(null)}
                  saving={updateMutation.isPending}
                />
              </div>
            ) : deletingId === provider.id ? (
              <div
                key={provider.id}
                className="p-4 rounded-lg border border-red-800 bg-red-900/10"
              >
                <p className="text-sm font-medium text-white">
                  {t("settings.integrations.sso.deleteConfirm", {
                    name: provider.name,
                  })}
                </p>
                <p className="mt-1 text-xs text-neutral-400">
                  {t("settings.integrations.sso.deleteConfirmHelp")}
                </p>
                <div className="flex gap-2 mt-3">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setDeletingId(null)}
                  >
                    {t("settings.integrations.sso.cancel")}
                  </Button>
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    onClick={() => handleDelete(provider)}
                    disabled={deleteMutation.isPending}
                  >
                    {t("settings.integrations.sso.delete")}
                  </Button>
                </div>
              </div>
            ) : (
              <ProviderRow
                key={provider.id}
                provider={provider}
                onEdit={() => setEditingId(provider.id)}
                onDelete={() => setDeletingId(provider.id)}
              />
            ),
          )}

          {adding && (
            <div className="p-4 rounded-lg border border-primary-700 bg-neutral-800">
              <div className="flex items-center justify-between mb-4">
                <p className="text-sm font-medium text-white">
                  {t("settings.integrations.sso.addProvider")}
                </p>
                <button
                  type="button"
                  onClick={() => setAdding(false)}
                  className="p-1 rounded hover:bg-neutral-700 text-neutral-400"
                >
                  <X className="size-4" />
                </button>
              </div>
              <ProviderForm
                initial={emptyForm()}
                isEdit={false}
                secretIsSet={false}
                onSave={handleCreate}
                onCancel={() => setAdding(false)}
                saving={createMutation.isPending}
              />
            </div>
          )}
        </div>
      )}

      {!adding && (
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            setEditingId(null);
            setAdding(true);
          }}
          className="gap-2 border-dashed border-neutral-600 text-neutral-400 hover:border-primary-500 hover:text-primary-400"
        >
          <Plus className="size-4" />
          {t("settings.integrations.sso.addProvider")}
        </Button>
      )}
    </div>
  );
}
