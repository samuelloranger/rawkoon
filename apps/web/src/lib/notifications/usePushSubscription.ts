import { useState, useEffect, useCallback } from "react";
import { useUnsubscribeFromPushNotifications } from "@/lib/notifications/useUnsubscribeFromPushNotifications";
import { useVapidPublicKey } from "@/lib/notifications/useVapidPublicKey";
import {
  type PushSubscriptionData,
  saveEndpoint,
  removeEndpoint,
  saveSubscription,
  loadSubscription,
  removeSubscription,
  isPushStoreError,
  hardResetServiceWorkerForPush,
  urlBase64ToUint8Array,
  serializeSubscription,
} from "@/lib/notifications/usePushSubscriptionUtils";

interface UsePushSubscriptionReturn {
  subscription: PushSubscriptionData | null;
  isLoading: boolean;
  keysRotated: boolean;
  subscribe: () => Promise<PushSubscriptionData | null>;
  unsubscribe: () => Promise<boolean>;
}

export function usePushSubscription(
  isSupported: boolean,
  permission: NotificationPermission,
): UsePushSubscriptionReturn {
  const [subscription, setSubscription] = useState<PushSubscriptionData | null>(
    null,
  );
  // Only "loading" while we can actually resolve a subscription state —
  // unsupported browsers resolve immediately.
  const [isLoading, setIsLoading] = useState(isSupported);
  const [keysRotated, setKeysRotated] = useState(false);
  const { data: vapidData } = useVapidPublicKey();
  const vapidPublicKey = vapidData?.publicKey;
  const unsubscribeMutation = useUnsubscribeFromPushNotifications();

  const getSubscriptionSafe = useCallback(
    async (
      registration: ServiceWorkerRegistration,
      options?: { allowReset?: boolean },
    ) => {
      const allowReset = options?.allowReset ?? false;

      const readSubscription = async (
        swRegistration: ServiceWorkerRegistration,
      ) => {
        return await swRegistration.pushManager.getSubscription();
      };

      try {
        return await readSubscription(registration);
      } catch (err) {
        console.warn(
          "Error retrieving push subscription, refreshing service worker registration:",
          err,
        );
      }

      try {
        await registration.update();
        const refreshedRegistration =
          (await navigator.serviceWorker.getRegistration("/sw.js")) ||
          registration;
        return await readSubscription(refreshedRegistration);
      } catch (err) {
        console.warn(
          "Push subscription still unavailable after registration refresh:",
          err,
        );
      }

      if (!allowReset) {
        return null;
      }

      try {
        console.warn(
          "Resetting service worker registration to recover push subscription state",
        );
        await registration.unregister();
        await navigator.serviceWorker.register("/sw.js");
        const readyRegistration = await navigator.serviceWorker.ready;
        return await readSubscription(readyRegistration);
      } catch (err) {
        console.error(
          "Error retrieving push subscription after service worker reset:",
          err,
        );
        return null;
      }
    },
    [],
  );

  // Check and sync subscription state
  const checkSubscriptionState = useCallback(async () => {
    if (!("serviceWorker" in navigator)) return;

    try {
      const registration = await navigator.serviceWorker.ready;
      const sub = await getSubscriptionSafe(registration);

      if (sub) {
        const subData = serializeSubscription(sub);
        const stored = loadSubscription();
        const rotated =
          stored !== null &&
          stored.endpoint === subData.endpoint &&
          (stored.keys.p256dh !== subData.keys.p256dh ||
            stored.keys.auth !== subData.keys.auth);
        setSubscription(subData);
        setKeysRotated(rotated);
        saveEndpoint(sub.endpoint);
        saveSubscription(subData);
      } else {
        setSubscription(null);
        setKeysRotated(false);
        removeEndpoint();
        removeSubscription();
      }
    } catch (err) {
      console.error("Error getting subscription:", err);
    } finally {
      setIsLoading(false);
    }
  }, [getSubscriptionSafe]);

  useEffect(() => {
    if (!isSupported) return;

    // checkSubscriptionState only calls setState after awaiting the service
    // worker (external-system sync); the rule can't see the async boundary.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    checkSubscriptionState();

    const handleVisibilityChange = () => {
      if (
        document.visibilityState === "visible" &&
        Notification.permission === "granted"
      ) {
        checkSubscriptionState();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [isSupported, checkSubscriptionState]);

  const subscribe =
    useCallback(async (): Promise<PushSubscriptionData | null> => {
      if (!isSupported || permission !== "granted") {
        console.warn("Notifications not supported or permission not granted");
        return null;
      }

      try {
        const registration = await navigator.serviceWorker.ready;
        const existingSubscription = await getSubscriptionSafe(registration, {
          allowReset: true,
        });

        if (existingSubscription) {
          const sub = serializeSubscription(existingSubscription);
          setSubscription(sub);
          return sub;
        }

        // Get VAPID public key from backend
        if (!vapidPublicKey) {
          console.warn("Could not get VAPID public key from backend");
          return null;
        }

        // Convert VAPID key to Uint8Array
        const vapidKey: Uint8Array = urlBase64ToUint8Array(vapidPublicKey);
        const applicationServerKey = vapidKey as unknown as BufferSource;

        let newSubscription: globalThis.PushSubscription;
        try {
          newSubscription = await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey,
          });
        } catch (error) {
          if (!isPushStoreError(error)) {
            throw error;
          }

          console.warn(
            "Push store appears corrupted, resetting service worker registration:",
            error,
          );
          const resetRegistration = await hardResetServiceWorkerForPush();
          const recoveredSubscription = await getSubscriptionSafe(
            resetRegistration,
            { allowReset: false },
          );

          if (recoveredSubscription) {
            newSubscription = recoveredSubscription;
          } else {
            newSubscription = await resetRegistration.pushManager.subscribe({
              userVisibleOnly: true,
              applicationServerKey,
            });
          }
        }

        if (!newSubscription) {
          return null;
        }

        if (
          !newSubscription.getKey("p256dh") ||
          !newSubscription.getKey("auth")
        ) {
          console.warn(
            "Push subscription keys are missing; subscription will be ignored",
          );
          return null;
        }

        const sub = serializeSubscription(newSubscription);
        setSubscription(sub);
        setKeysRotated(false);
        saveEndpoint(newSubscription.endpoint);
        saveSubscription(sub);
        return sub;
      } catch (error) {
        console.error("Error subscribing to push notifications:", error);
        return null;
      }
    }, [isSupported, permission, vapidPublicKey, getSubscriptionSafe]);

  const unsubscribe = useCallback(async (): Promise<boolean> => {
    if (!isSupported) {
      console.warn("Notifications not supported");
      return false;
    }

    try {
      const registration = await navigator.serviceWorker.ready;
      const existingSubscription = await getSubscriptionSafe(registration);

      let endpoint: string | null = null;
      if (existingSubscription) {
        endpoint = existingSubscription.endpoint;
        await existingSubscription.unsubscribe();
        setSubscription(null);
        removeEndpoint();
      }

      // Also notify backend with the endpoint to unsubscribe the specific device
      try {
        await unsubscribeMutation.mutateAsync(
          endpoint
            ? ({ endpoint } as unknown as Record<string, unknown>)
            : undefined,
        );
      } catch (error) {
        console.warn("Failed to notify backend of unsubscribe:", error);
        // Continue anyway, the client-side unsubscribe succeeded
      }

      return true;
    } catch (error) {
      console.error("Error unsubscribing from push notifications:", error);
      return false;
    }
  }, [isSupported, unsubscribeMutation, getSubscriptionSafe]);

  return {
    subscription,
    isLoading,
    keysRotated,
    subscribe,
    unsubscribe,
  };
}
