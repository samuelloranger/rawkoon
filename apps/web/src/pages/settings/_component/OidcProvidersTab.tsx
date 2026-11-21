import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import type { OidcProvider } from "@rawkoon/shared/types";
import {
  useOidcProviders,
  useCreateOidcProvider,
  useUpdateOidcProvider,
  useDeleteOidcProvider,
} from "@/lib/auth/useOidcProviders";
import {
  ProviderForm,
  emptyForm,
  type OidcProviderFormValues,
} from "@/pages/settings/_component/OidcProviderForm";
import { ProviderRow } from "@/pages/settings/_component/OidcProviderRow";

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
        toast.success(t("settings.integrations.sso.deleted"));
      })
      .catch(() => toast.error(t("settings.integrations.sso.deleteError")));
  };

  return (
    <div className="space-y-6">
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
