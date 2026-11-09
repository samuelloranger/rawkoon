import { useId } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useTranslation } from "react-i18next";
import { Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { copyToClipboard } from "@/lib/utils/clipboard";
import { Switch } from "@/components/ui/switch";

const INPUT_CLASS =
  "focus-ring w-full px-4 py-2 border border-neutral-600 rounded-lg bg-neutral-900 text-white font-mono text-sm";
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

export type OidcProviderFormValues = z.infer<typeof oidcProviderSchema>;

export const emptyForm = (): OidcProviderFormValues => ({
  name: "",
  slug: "",
  discovery_url: "",
  icon_url: "",
  client_id: "",
  client_secret: "",
  enabled: true,
});

export function ProviderForm({
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
  // The add form and an edit form can be open at once, so ids must be scoped
  // per instance — otherwise the add form's labels target the edit form's inputs.
  const fieldId = useId();
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
  const redirectUri = slug ? `${apiBase}/api/auth/callback/${slug}` : "";

  const onSubmit = (data: OidcProviderFormValues) => {
    onSave(data);
  };

  return (
    <form className="space-y-4" onSubmit={handleSubmit(onSubmit)}>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label htmlFor={`${fieldId}-name`} className={LABEL_CLASS}>
            {t("settings.integrations.sso.providerName")}
          </label>
          <input
            id={`${fieldId}-name`}
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
          <label htmlFor={`${fieldId}-slug`} className={LABEL_CLASS}>
            {t("settings.integrations.sso.providerSlug")}
          </label>
          <input
            id={`${fieldId}-slug`}
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
          <label htmlFor={`${fieldId}-redirect-uri`} className={LABEL_CLASS}>
            {t("settings.integrations.sso.redirectUri")}
          </label>
          <div className="flex items-center gap-2">
            <input
              id={`${fieldId}-redirect-uri`}
              type="text"
              readOnly
              value={redirectUri}
              className="focus-ring flex-1 px-4 py-2 border border-neutral-600 rounded-lg bg-neutral-800 text-neutral-300 font-mono text-sm cursor-default"
            />
            <button
              type="button"
              onClick={async () => {
                if (await copyToClipboard(redirectUri)) {
                  toast.success(t("common.copied"));
                } else {
                  toast.error(t("common.copyFailed"));
                }
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
        <label htmlFor={`${fieldId}-discovery-url`} className={LABEL_CLASS}>
          {t("settings.integrations.sso.discoveryUrl")}
        </label>
        <input
          id={`${fieldId}-discovery-url`}
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
        <label htmlFor={`${fieldId}-icon-url`} className={LABEL_CLASS}>
          {t("settings.integrations.sso.iconUrl")}
        </label>
        <div className="flex items-center gap-3">
          <input
            id={`${fieldId}-icon-url`}
            type="url"
            {...register("icon_url")}
            placeholder={t("settings.integrations.sso.iconUrlPlaceholder")}
            className="focus-ring flex-1 px-4 py-2 border border-neutral-600 rounded-lg bg-neutral-900 text-white font-mono text-sm"
          />
          {iconUrl && (
            <img
              loading="lazy"
              decoding="async"
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
          <label htmlFor={`${fieldId}-client-id`} className={LABEL_CLASS}>
            {t("settings.integrations.sso.clientId")}
          </label>
          <input
            id={`${fieldId}-client-id`}
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
          <label htmlFor={`${fieldId}-client-secret`} className={LABEL_CLASS}>
            {t("settings.integrations.sso.clientSecret")}
          </label>
          <input
            id={`${fieldId}-client-secret`}
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
