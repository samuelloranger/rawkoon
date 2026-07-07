import { useTranslation } from "react-i18next";
import { useInfiniteNotifications } from "@/lib/notifications/useInfiniteNotifications";
import { useMarkAllAsReadOptimistic } from "@/lib/notifications/useMarkAllAsReadOptimistic";
import { type Notification } from "@rawkoon/shared/types";
import { NotificationList } from "@/components/NotificationList";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/PageHeader";
import { clearBadge } from "@/lib/sw/registration";
import { Bell } from "lucide-react";

export function NotificationsPage() {
  const { t } = useTranslation("common");
  const limit = 25;

  const { data, isLoading, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useInfiniteNotifications(limit);
  const markAllAsReadMutation = useMarkAllAsReadOptimistic();

  const notifications: Notification[] =
    data?.pages?.flatMap((page) => page.notifications ?? []) ?? [];

  const handleLoadMore = () => {
    if (hasNextPage && !isFetchingNextPage) fetchNextPage();
  };

  const handleMarkAllAsRead = async () => {
    await markAllAsReadMutation.mutateAsync();
    clearBadge();
  };

  const hasUnreadNotifications = notifications.some((n) => !n.read);

  return (
    <div className="w-full max-w-4xl mx-auto px-4 py-8">
      <PageHeader
        icon={Bell}
        iconColor="text-blue-600"
        title={t("notifications.title")}
        subtitle={t("notifications.description")}
      />

      {notifications.length > 0 && (
        <div className="mb-4 flex justify-end">
          <Button
            onClick={handleMarkAllAsRead}
            disabled={!hasUnreadNotifications}
          >
            {t("notifications.markAllAsRead")}
          </Button>
        </div>
      )}

      <div className="w-full mb-4 flex flex-col items-center justify-between">
        {isLoading ? (
          <div className="text-center py-8 text-neutral-400">
            {t("common.loading")}
          </div>
        ) : (
          <NotificationList
            notifications={notifications}
            onLoadMore={hasNextPage ? handleLoadMore : undefined}
            hasMore={hasNextPage}
          />
        )}
        {isFetchingNextPage && (
          <div className="text-center py-4 text-neutral-400">
            {t("common.loading")}
          </div>
        )}
      </div>
    </div>
  );
}
