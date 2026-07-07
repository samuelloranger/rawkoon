import { useNotificationPermission } from "@/lib/notifications/useNotificationPermission";
import { usePushSubscription } from "@/lib/notifications/usePushSubscription";
import type { PushSubscriptionData } from "@/lib/notifications/usePushSubscriptionUtils";

interface UseNotificationsReturn {
  permission: NotificationPermission;
  subscription: PushSubscriptionData | null;
  isSubscriptionLoading: boolean;
  keysRotated: boolean;
  requestPermission: () => Promise<boolean>;
  subscribe: () => Promise<PushSubscriptionData | null>;
  unsubscribe: () => Promise<boolean>;
  isSupported: boolean;
}

export function useNotifications(): UseNotificationsReturn {
  const { permission, isSupported, requestPermission } =
    useNotificationPermission();
  const { subscription, isLoading, keysRotated, subscribe, unsubscribe } =
    usePushSubscription(isSupported, permission);

  return {
    permission,
    subscription,
    isSubscriptionLoading: isLoading,
    keysRotated,
    requestPermission,
    subscribe,
    unsubscribe,
    isSupported,
  };
}
