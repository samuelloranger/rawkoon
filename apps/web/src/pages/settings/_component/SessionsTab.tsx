import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Monitor, Trash2, LogOut, Key, Wifi, Shield } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAdminSessions } from "@/pages/settings/useAdminSessions";
import { useRevokeSession } from "@/pages/settings/useRevokeSession";
import { useRevokeUserSessions } from "@/pages/settings/useRevokeUserSessions";
import { useAdminWebPush } from "@/pages/settings/useAdminWebPush";
import { useDeleteWebPush } from "@/pages/settings/useDeleteWebPush";
import { useCurrentUser } from "@/lib/auth/useAuth";
import {
  useOidcProviders,
  oidcProviderIconUrl,
} from "@/lib/auth/useOidcProviders";
import { formatDateTime } from "@rawkoon/shared/utils";
import { LoadingState } from "@/components/LoadingState";
import { useConfirm } from "@/components/confirm/ConfirmContext";
import { SettingsPageHeader } from "@/pages/settings/_component/SettingsPageHeader";

function SectionCard({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-neutral-800 rounded-xl border border-neutral-700 p-6">
      <div className="mb-6">
        <SettingsPageHeader title={title} description={description} />
      </div>
      {children}
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="text-center py-8 text-neutral-400 text-sm">{message}</div>
  );
}

function getInitials(name: string | null, email: string): string {
  if (name) {
    const parts = name.trim().split(" ");
    return parts.length >= 2
      ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
      : parts[0].slice(0, 2).toUpperCase();
  }
  return email.slice(0, 2).toUpperCase();
}

export function SessionsTab() {
  const { t, i18n } = useTranslation("common");
  const { confirm } = useConfirm();
  const { data: currentUser } = useCurrentUser();

  const { data: sessionsData, isLoading: loadingSessions } = useAdminSessions();
  const { data: webPushData, isLoading: loadingWebPush } = useAdminWebPush();
  const { data: oidcData } = useOidcProviders();
  const providerIconMap = Object.fromEntries(
    (oidcData?.providers ?? []).map((p) => [
      p.slug,
      oidcProviderIconUrl(p.slug, p.icon_url),
    ]),
  );

  const revokeSession = useRevokeSession();
  const revokeUserSessions = useRevokeUserSessions();
  const deleteWebPush = useDeleteWebPush();

  if (!currentUser?.is_admin) return null;

  const handleRevokeSession = async (id: string) => {
    confirm({
      variant: "destructive",
      description: t("settings.sessions.revokeConfirm"),
      confirmLabel: t("settings.sessions.revoke"),
      onConfirm: async () => {
        try {
          await revokeSession.mutateAsync(id);
          toast.success(t("settings.sessions.revokeSuccess"));
        } catch {
          toast.error(t("settings.sessions.revokeError"));
        }
      },
    });
  };

  const handleRevokeUserSessions = async (
    userId: string,
    userEmail: string,
  ) => {
    confirm({
      variant: "destructive",
      description: t("settings.sessions.revokeAllConfirm", {
        email: userEmail,
      }),
      confirmLabel: t("settings.sessions.revokeAll"),
      onConfirm: async () => {
        try {
          await revokeUserSessions.mutateAsync(userId);
          toast.success(t("settings.sessions.revokeAllSuccess"));
        } catch {
          toast.error(t("settings.sessions.revokeError"));
        }
      },
    });
  };

  const handleDeleteWebPush = async (id: number) => {
    confirm({
      variant: "destructive",
      description: t("settings.sessions.deleteWebPushConfirm"),
      confirmLabel: t("common.delete"),
      onConfirm: async () => {
        try {
          await deleteWebPush.mutateAsync(id);
          toast.success(t("settings.sessions.deleteWebPushSuccess"));
        } catch {
          toast.error(t("settings.sessions.deleteWebPushError"));
        }
      },
    });
  };

  const sessionsByUser = (sessionsData?.sessions ?? []).reduce<
    Record<string, { email: string; count: number }>
  >((acc, s) => {
    if (!acc[s.user_id]) acc[s.user_id] = { email: s.user_email, count: 0 };
    acc[s.user_id].count++;
    return acc;
  }, {});

  return (
    <div
      className="animate-in fade-in slide-in-from-right-4 duration-300 space-y-6"
      key="sessions-tab"
    >
      <SettingsPageHeader
        icon={Shield}
        title={t("settings.sessions.sessionsTitle")}
        description={t("settings.sessions.sessionsDescription")}
      />
      {/* Active Sessions */}
      <SectionCard
        title={t("settings.sessions.sessionsTitle")}
        description={t("settings.sessions.sessionsDescription")}
      >
        {loadingSessions ? (
          <LoadingState />
        ) : !sessionsData?.sessions?.length ? (
          <EmptyState message={t("settings.sessions.noSessions")} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-neutral-700">
                  <th className="text-left py-3 px-4 font-medium text-neutral-300">
                    {t("settings.sessions.user")}
                  </th>
                  <th className="text-left py-3 px-4 font-medium text-neutral-300 whitespace-nowrap">
                    {t("settings.sessions.createdAt")}
                  </th>
                  <th className="text-left py-3 px-4 font-medium text-neutral-300 whitespace-nowrap">
                    {t("settings.sessions.expiresAt")}
                  </th>
                  <th className="text-right py-3 px-4 font-medium text-neutral-300">
                    {t("settings.sessions.actions")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {sessionsData.sessions.map((session) => {
                  const initials = getInitials(
                    session.user_name,
                    session.user_email,
                  );
                  const isCredential =
                    !session.provider_id ||
                    session.provider_id === "credential";
                  const providerIcon = !isCredential
                    ? (providerIconMap[session.provider_id!] ?? null)
                    : null;

                  return (
                    <tr
                      key={session.id}
                      className="border-b border-neutral-700 hover:bg-neutral-700/50 transition-colors"
                    >
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-2.5">
                          <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-primary-500/20 text-primary-400 text-xs font-semibold shrink-0">
                            {initials}
                          </span>
                          <div className="min-w-0">
                            <div className="font-medium text-neutral-100 truncate">
                              {session.user_name || session.user_email}
                            </div>
                            {session.user_name && (
                              <div className="text-xs text-neutral-400 truncate">
                                {session.user_email}
                              </div>
                            )}
                            <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-0.5">
                              {session.provider_id && (
                                <span className="inline-flex items-center gap-1 text-xs text-neutral-400">
                                  {isCredential ? (
                                    <Key className="size-3 shrink-0" />
                                  ) : providerIcon ? (
                                    <img
                                      src={providerIcon}
                                      alt=""
                                      className="size-3.5 rounded shrink-0"
                                      onError={(e) => {
                                        (
                                          e.target as HTMLImageElement
                                        ).style.display = "none";
                                      }}
                                    />
                                  ) : null}
                                  {isCredential
                                    ? t("settings.sessions.providerCredential")
                                    : session.provider_id}
                                </span>
                              )}
                              {session.device &&
                                (session.device.browser ||
                                  session.device.os) && (
                                  <span className="inline-flex items-center gap-1 text-xs text-neutral-500">
                                    <Monitor className="size-3 shrink-0" />
                                    {[session.device.browser, session.device.os]
                                      .filter(Boolean)
                                      .join(" · ")}
                                  </span>
                                )}
                              {session.ip_address && (
                                <span className="font-mono text-xs text-neutral-500">
                                  {session.ip_address}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="py-3 px-4 text-neutral-400 whitespace-nowrap">
                        {formatDateTime(session.created_at, i18n.language)}
                      </td>
                      <td className="py-3 px-4 text-neutral-400 whitespace-nowrap">
                        {formatDateTime(session.expires_at, i18n.language)}
                      </td>
                      <td className="py-3 px-4 text-right">
                        <div className="inline-flex flex-col items-end gap-1">
                          {sessionsByUser[session.user_id]?.count > 1 && (
                            <Button
                              size="sm"
                              onClick={() =>
                                handleRevokeUserSessions(
                                  session.user_id,
                                  session.user_email,
                                )
                              }
                              disabled={revokeUserSessions.isPending}
                              title={t("settings.sessions.revokeAll")}
                              variant="destructive"
                              className="gap-1"
                            >
                              <LogOut className="w-3 h-3" />
                              {t("settings.sessions.revokeAll")}
                            </Button>
                          )}
                          <Button
                            size="sm"
                            onClick={() => handleRevokeSession(session.id)}
                            disabled={revokeSession.isPending}
                            variant="destructive"
                            className="gap-1"
                          >
                            <Trash2 className="w-3 h-3" />
                            {t("settings.sessions.revoke")}
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      {/* Web Push Subscriptions */}
      <SectionCard
        title={t("settings.sessions.webPushTitle")}
        description={t("settings.sessions.webPushDescription")}
      >
        {loadingWebPush ? (
          <LoadingState />
        ) : !webPushData?.subscriptions?.length ? (
          <EmptyState message={t("settings.sessions.noWebPush")} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-neutral-700">
                  <th className="text-left py-3 px-4 font-medium text-neutral-300">
                    {t("settings.sessions.user")}
                  </th>
                  <th className="text-left py-3 px-4 font-medium text-neutral-300">
                    {t("settings.sessions.device")}
                  </th>
                  <th className="text-left py-3 px-4 font-medium text-neutral-300">
                    {t("settings.sessions.endpoint")}
                  </th>
                  <th className="text-left py-3 px-4 font-medium text-neutral-300 whitespace-nowrap">
                    {t("settings.sessions.createdAt")}
                  </th>
                  <th className="text-right py-3 px-4 font-medium text-neutral-300">
                    {t("settings.sessions.actions")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {webPushData.subscriptions.map((sub) => {
                  const deviceLabel =
                    [sub.browser_name, sub.os_name]
                      .filter(Boolean)
                      .join(" · ") ||
                    sub.device_name ||
                    t("settings.sessions.unknownDevice");
                  const initials = getInitials(
                    sub.user_name ?? null,
                    sub.user_email,
                  );
                  return (
                    <tr
                      key={sub.id}
                      className="border-b border-neutral-700 hover:bg-neutral-700/50 transition-colors"
                    >
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-2.5">
                          <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-primary-500/20 text-primary-400 text-xs font-semibold shrink-0">
                            {initials}
                          </span>
                          <div className="min-w-0">
                            <div className="font-medium text-neutral-100 truncate">
                              {sub.user_name || sub.user_email}
                            </div>
                            {sub.user_name && (
                              <div className="text-xs text-neutral-400 truncate">
                                {sub.user_email}
                              </div>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium bg-purple-900/30 text-purple-300">
                          <Wifi className="w-3 h-3" />
                          {deviceLabel}
                        </span>
                      </td>
                      <td className="py-3 px-4 font-mono text-xs text-neutral-400 max-w-[200px] truncate">
                        {sub.endpoint ?? "—"}
                      </td>
                      <td className="py-3 px-4 text-neutral-400 whitespace-nowrap">
                        {sub.created_at
                          ? formatDateTime(sub.created_at, i18n.language)
                          : "—"}
                      </td>
                      <td className="py-3 px-4 text-right">
                        <Button
                          size="sm"
                          onClick={() => handleDeleteWebPush(sub.id)}
                          disabled={deleteWebPush.isPending}
                          variant="destructive"
                          className="gap-1.5"
                        >
                          <Trash2 className="w-3 h-3" />
                          {t("settings.sessions.delete")}
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
    </div>
  );
}
