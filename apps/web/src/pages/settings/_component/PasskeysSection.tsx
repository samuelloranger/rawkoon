import { useState } from "react";
import { KeyRound, Plus, ShieldCheck, Trash2, X, Check } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useTranslation } from "react-i18next";
import { formatDateTime } from "@rawkoon/shared/utils";
import {
  browserSupportsWebAuthn,
  useDeletePasskey,
  usePasskeyCredentials,
  usePasskeyRegister,
} from "@/lib/auth/usePasskey";

export function PasskeysSection() {
  const { t, i18n } = useTranslation("common");
  const [registerName, setRegisterName] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const { data, isLoading } = usePasskeyCredentials();
  const register = usePasskeyRegister();
  const deletePasskey = useDeletePasskey();

  if (!browserSupportsWebAuthn()) {
    return (
      <div className="bg-neutral-800 rounded-xl border border-neutral-700 p-6">
        <h2 className="text-base font-semibold mb-1.5 text-neutral-100 flex items-center gap-2">
          <KeyRound className="w-5 h-5 text-neutral-400" />
          {t("settings.passkeys.title")}
        </h2>
        <p className="text-sm text-neutral-400">
          {t("settings.passkeys.notSupported")}
        </p>
      </div>
    );
  }

  const handleRegister = async () => {
    try {
      await register.mutateAsync(registerName || undefined);
      toast.success(t("settings.passkeys.registerSuccess"));
      setRegisterName("");
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : null;
      toast.error(message || t("settings.passkeys.registerError"));
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deletePasskey.mutateAsync(id);
      toast.success(t("settings.passkeys.deleteSuccess"));
      setConfirmDeleteId(null);
    } catch {
      toast.error(t("settings.passkeys.deleteError"));
    }
  };

  return (
    <div className="bg-neutral-800 rounded-xl border border-neutral-700 p-6">
      <h2 className="text-base font-semibold mb-1.5 text-neutral-100 flex items-center gap-2">
        <KeyRound className="w-5 h-5 text-neutral-400" />
        {t("settings.passkeys.title")}
      </h2>
      <p className="text-neutral-400 mb-6 text-sm">
        {t("settings.passkeys.description")}
      </p>

      <div className="flex items-center gap-3 mb-6">
        <input
          type="text"
          value={registerName}
          onChange={(e) => setRegisterName(e.target.value)}
          placeholder={t("settings.passkeys.namePlaceholder")}
          className="flex-1 px-3 py-2 text-sm rounded-lg border border-neutral-600 bg-neutral-900 text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
        />
        <Button
          onClick={handleRegister}
          disabled={register.isPending}
          className="gap-2"
        >
          <Plus className="w-4 h-4" />
          {register.isPending
            ? t("settings.passkeys.registering")
            : t("settings.passkeys.addPasskey")}
        </Button>
      </div>

      {isLoading ? (
        <p className="text-sm text-neutral-400">{t("common.loading")}</p>
      ) : !data?.credentials?.length ? (
        <div className="text-center py-8 text-neutral-400">
          <ShieldCheck className="w-8 h-8 mx-auto mb-2 opacity-40" />
          <p className="text-sm">{t("settings.passkeys.noPasskeys")}</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {data.credentials.map((credential) => (
            <li
              key={credential.id}
              className="flex items-center justify-between p-3 rounded-lg bg-neutral-700/50 border border-neutral-600"
            >
              <div>
                <p className="text-sm font-medium text-neutral-100">
                  {credential.name || t("settings.passkeys.unnamedPasskey")}
                </p>
                <p className="text-xs text-neutral-400">
                  {credential.device_type === "multiDevice"
                    ? t("settings.passkeys.multiDevice")
                    : t("settings.passkeys.singleDevice")}
                  {credential.backed_up &&
                    ` · ${t("settings.passkeys.backedUp")}`}
                  {" · "}
                  {t("settings.passkeys.addedOn", {
                    date: formatDateTime(credential.created_at, i18n.language),
                  })}
                </p>
              </div>
              {confirmDeleteId === credential.id ? (
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => handleDelete(credential.id)}
                    disabled={deletePasskey.isPending}
                    className="p-1.5 text-red-500 hover:text-red-400 disabled:opacity-50 transition-colors"
                  >
                    <Check className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => setConfirmDeleteId(null)}
                    className="p-1.5 text-neutral-400 hover:text-neutral-300 transition-colors"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setConfirmDeleteId(credential.id)}
                  disabled={deletePasskey.isPending}
                  className="p-1.5 text-red-500 hover:text-red-400 disabled:opacity-50 transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
