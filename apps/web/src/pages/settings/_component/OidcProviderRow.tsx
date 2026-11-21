import { useTranslation } from "react-i18next";
import { Pencil, Trash2 } from "lucide-react";
import type { OidcProvider } from "@rawkoon/shared/types";
import { oidcProviderIconUrl } from "@/lib/auth/useOidcProviders";

export function ProviderRow({
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
          loading="lazy"
          decoding="async"
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
          aria-label={t("settings.integrations.sso.editProvider")}
          className="p-2 rounded-lg hover:bg-neutral-700 text-neutral-400 transition-colors"
        >
          <Pencil className="size-4" />
        </button>
        <button
          type="button"
          onClick={onDelete}
          aria-label={t("settings.integrations.sso.delete")}
          className="p-2 rounded-lg hover:bg-red-900/20 text-neutral-400 hover:text-red-400 transition-colors"
        >
          <Trash2 className="size-4" />
        </button>
      </div>
    </div>
  );
}
