import { useState, useEffect, useCallback } from "react";

interface UseNotificationPermissionReturn {
  permission: NotificationPermission;
  isSupported: boolean;
  requestPermission: () => Promise<boolean>;
}

export function useNotificationPermission(): UseNotificationPermissionReturn {
  const [isSupported] = useState(
    () =>
      "Notification" in window &&
      "serviceWorker" in navigator &&
      "PushManager" in window,
  );
  const [permission, setPermission] = useState<NotificationPermission>(() =>
    "Notification" in window &&
    "serviceWorker" in navigator &&
    "PushManager" in window
      ? Notification.permission
      : "default",
  );

  useEffect(() => {
    if (!isSupported) return;

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        setPermission(Notification.permission);
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [isSupported]);

  const requestPermission = useCallback(async (): Promise<boolean> => {
    if (!isSupported) {
      console.warn("Notifications not supported");
      return false;
    }

    try {
      const result = await Notification.requestPermission();
      setPermission(result);
      return result === "granted";
    } catch (error) {
      console.error("Error requesting notification permission:", error);
      return false;
    }
  }, [isSupported]);

  return {
    permission,
    isSupported,
    requestPermission,
  };
}
