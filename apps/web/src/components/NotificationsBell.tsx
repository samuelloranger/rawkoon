import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "@tanstack/react-router";
import { Bell, ArrowRight, CheckCheck, BellOff } from "lucide-react";
import * as Popover from "@radix-ui/react-popover";
import { useMarkAllAsReadOptimistic } from "@/lib/notifications/useMarkAllAsReadOptimistic";
import { useMarkAsReadOptimistic } from "@/lib/notifications/useMarkAsReadOptimistic";
import { useNotifications } from "@/lib/notifications/useNotificationsQuery";
import { useUnreadCount } from "@/lib/notifications/useUnreadCount";
import { queryKeys } from "@/lib/queryKeys";
import { formatRelativeTime } from "@/lib/utils/relativeTime";
import { syncBadge } from "@/lib/sw/registration";
import { useQueryClient } from "@tanstack/react-query";
import { usePrefetchRoute } from "@/lib/routing/usePrefetchRoute";
import { openNotificationTarget } from "@/lib/notifications/navigation";
import { NotificationMenuRow } from "@/components/NotificationMenuRow";

function getRelativeTime(dateStr: string, lang: string): string {
  try {
    return formatRelativeTime(dateStr, lang) ?? "";
  } catch {
    return "";
  }
}

export function NotificationsMenu() {
  const { t, i18n } = useTranslation("common");
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const prefetchRoute = usePrefetchRoute();
  const [isOpen, setIsOpen] = useState(false);

  const { data: unreadData } = useUnreadCount();
  const { data: notificationsData } = useNotifications(1, 10);
  const markAsReadMutation = useMarkAsReadOptimistic();
  const markAllAsReadMutation = useMarkAllAsReadOptimistic();

  useEffect(() => {
    if (!isOpen) return;
    queryClient.invalidateQueries({
      queryKey: queryKeys.notifications.list(1, 10),
    });
  }, [isOpen, queryClient]);

  const unreadCount = unreadData?.unread_count || 0;
  const recentNotifications = notificationsData?.notifications || [];

  const handleNotificationClick = async (notification: {
    id: number;
    read: boolean;
    url: string | null;
  }) => {
    if (!notification.read) {
      await markAsReadMutation.mutateAsync(notification.id);
    }
    setIsOpen(false);
    openNotificationTarget(notification.url);
  };

  const handleMarkAllAsRead = async () => {
    await markAllAsReadMutation.mutateAsync();
    syncBadge();
  };

  return (
    <Popover.Root open={isOpen} onOpenChange={setIsOpen}>
      <Popover.Trigger asChild>
        <button
          className="flex h-9 w-9 items-center justify-center relative rounded-xl text-neutral-400 hover:bg-white/[0.06] hover:text-neutral-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-1 transition-colors"
          aria-label={t("notifications.bell")}
          onMouseEnter={() => prefetchRoute("/notifications")}
        >
          <Bell className="h-[18px] w-[18px]" />
          {unreadCount > 0 && (
            <span className="absolute top-1 right-1 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white ring-2 ring-neutral-900">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </button>
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Content
          className="w-[calc(100vw-2rem)] sm:w-[400px] bg-neutral-800 rounded-xl shadow-lg border border-neutral-700/60 z-50 max-h-[32rem] overflow-hidden data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2"
          align="end"
          sideOffset={8}
          collisionPadding={16}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-700/60">
            <div className="flex items-center gap-2.5">
              <h3 className="text-sm font-semibold text-white">
                {t("notifications.title")}
              </h3>
              {unreadCount > 0 && (
                <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-primary-900/40 px-1.5 text-[11px] font-semibold text-primary-300">
                  {unreadCount}
                </span>
              )}
            </div>
            {unreadCount > 0 && (
              <button
                onClick={handleMarkAllAsRead}
                disabled={markAllAsReadMutation.isPending}
                className="flex items-center gap-1.5 text-xs font-medium text-neutral-400 hover:text-neutral-200 disabled:opacity-50 transition-colors"
              >
                <CheckCheck className="h-3.5 w-3.5" />
                {t("notifications.markAllAsRead")}
              </button>
            )}
          </div>

          {/* Notification list */}
          <div className="max-h-80 overflow-y-auto">
            {recentNotifications.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 px-4">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-neutral-700/60 mb-3">
                  <BellOff className="h-5 w-5 text-neutral-500" />
                </div>
                <p className="text-sm font-medium text-neutral-400">
                  {t("notifications.noNotifications")}
                </p>
              </div>
            ) : (
              <div className="py-1">
                {recentNotifications.map((notification) => (
                  <NotificationMenuRow
                    key={notification.id}
                    type={notification.type}
                    title={notification.title}
                    body={notification.body}
                    metadata={notification.metadata}
                    imageUrl={notification.image_url}
                    isUnread={!notification.read}
                    relativeTime={getRelativeTime(
                      notification.created_at,
                      i18n.language || "en",
                    )}
                    onClick={() => handleNotificationClick(notification)}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="border-t border-neutral-700/60">
            <button
              onClick={() => {
                setIsOpen(false);
                navigate({ to: "/notifications" });
              }}
              className="flex items-center justify-center gap-1.5 w-full py-2.5 text-[13px] font-medium text-neutral-400 hover:text-neutral-200 hover:bg-white/[0.03] transition-colors"
            >
              {t("notifications.viewAll")}
              <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
