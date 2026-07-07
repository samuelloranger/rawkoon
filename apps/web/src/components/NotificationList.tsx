import type { MouseEvent } from "react";
import { useTranslation } from "react-i18next";
import { Trash2 } from "lucide-react";
import { useDeleteNotification } from "@/lib/notifications/useDeleteNotification";
import { useMarkAsReadOptimistic } from "@/lib/notifications/useMarkAsReadOptimistic";
import type { Notification } from "@rawkoon/shared/types";
import { formatDate, formatTime } from "@rawkoon/shared/utils";
import { cn } from "@/lib/utils";
import { NotificationLeadingVisual } from "@/components/NotificationLeadingVisual";
import { openNotificationTarget } from "@/lib/notifications/navigation";
import { useConfirm } from "@/components/confirm/ConfirmContext";

interface NotificationListProps {
  notifications: Notification[];
  onLoadMore?: () => void;
  hasMore?: boolean;
}

export function NotificationList({
  notifications,
  onLoadMore,
  hasMore,
}: NotificationListProps) {
  const { t, i18n } = useTranslation("common");
  const { confirm } = useConfirm();
  const markAsReadMutation = useMarkAsReadOptimistic();
  const deleteMutation = useDeleteNotification();

  const handleNotificationClick = async (notification: Notification) => {
    if (!notification.read) {
      await markAsReadMutation.mutateAsync(notification.id);
    }
    openNotificationTarget(notification.url);
  };

  const handleDelete = async (
    e: MouseEvent<HTMLButtonElement>,
    notificationId: number,
  ) => {
    e.stopPropagation();
    confirm({
      variant: "destructive",
      description: t("notifications.deleteConfirm"),
      confirmLabel: t("common.delete"),
      onConfirm: async () => {
        await deleteMutation.mutateAsync(notificationId);
      },
    });
  };

  if (!notifications || notifications.length === 0) {
    return (
      <div className="text-center py-8 text-neutral-400">
        {t("notifications.noNotifications")}
      </div>
    );
  }

  return (
    <div className="w-full space-y-2">
      {notifications.map((notification) => (
        <div
          key={notification.id}
          onClick={() => handleNotificationClick(notification)}
          className={cn(
            "relative p-4 rounded-lg border cursor-pointer transition-colors",
            notification.read
              ? "bg-neutral-800 border-neutral-700 hover:bg-neutral-700/80"
              : "bg-primary-500/10 border-primary-800 hover:bg-primary-500/20",
          )}
        >
          <div className="flex items-start gap-4">
            {/* Poster thumbnail when present, else type icon */}
            <div className="mt-1">
              <NotificationLeadingVisual
                type={notification.type}
                metadata={notification.metadata}
                imageUrl={notification.image_url}
                size="md"
              />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-start gap-2">
                <div className="flex-1">
                  <h4
                    className={cn(
                      "text-sm font-medium",
                      notification.read
                        ? "text-neutral-100"
                        : "text-neutral-100 font-semibold",
                    )}
                  >
                    {notification.title}
                  </h4>
                  <p
                    className={cn(
                      "text-sm mt-1",
                      !notification.read
                        ? "text-neutral-300"
                        : "text-neutral-400",
                    )}
                  >
                    {notification.body}
                  </p>
                  <p
                    className={cn(
                      "text-xs mt-2",
                      !notification.read
                        ? "text-neutral-400"
                        : "text-neutral-500",
                    )}
                  >
                    {formatDate(notification.created_at, i18n.language || "en")}{" "}
                    {formatTime(notification.created_at, i18n.language || "en")}
                  </p>
                </div>
                {!notification.read && (
                  <div className="absolute top-[10px] right-[10px]">
                    <div className="h-2 w-2 rounded-full bg-blue-500"></div>
                  </div>
                )}
              </div>
            </div>
            <button
              onClick={(e) => handleDelete(e, notification.id)}
              className="flex justify-center items-center ml-2 p-1 text-neutral-400 hover:text-red-400 transition-colors"
              aria-label={t("notifications.delete")}
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        </div>
      ))}
      {hasMore && onLoadMore && (
        <div className="text-center pt-4">
          <button
            onClick={onLoadMore}
            className="text-sm text-primary-400 hover:underline"
          >
            {t("notifications.loadMore")}
          </button>
        </div>
      )}
    </div>
  );
}
