import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Bell } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useNotifications } from "@/lib/notifications/useNotifications";
import { useDeleteNotificationDevice } from "@/lib/notifications/useDeleteNotificationDevice";
import { useNotificationDevices } from "@/lib/notifications/useNotificationDevices";
import { useSubscribeToPushNotifications } from "@/lib/notifications/useSubscribeToPushNotifications";
import { useTestPushNotification } from "@/lib/notifications/useTestPushNotification";
import { queryKeys } from "@/lib/queryKeys";
import { getDeviceInfo } from "@/lib/device";
import { useAuth } from "@/lib/auth/useAuth";
import { NotificationChannelsSection } from "@/pages/settings/_component/NotificationChannelsSection";
import { SettingsPageHeader } from "@/pages/settings/_component/SettingsPageHeader";
import { useConfirm } from "@/components/confirm/ConfirmContext";

export function NotificationsTab() {
  const { t } = useTranslation("common");
  const { confirm } = useConfirm();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const {
    permission,
    subscription,
    requestPermission,
    subscribe,
    unsubscribe,
    isSupported,
  } = useNotifications();
  const [loading, setLoading] = useState(false);

  const { data: devicesData, isLoading: devicesLoading } =
    useNotificationDevices();
  const devices = devicesData?.devices || [];
  const deleteDeviceMutation = useDeleteNotificationDevice();
  const subscribeMutation = useSubscribeToPushNotifications();
  const testNotificationMutation = useTestPushNotification();

  const handleRequestPermission = async () => {
    setLoading(true);
    try {
      const granted = await requestPermission();
      if (!granted) {
        toast.error(t("settings.notifications.permissionDenied"));
      }
    } catch {
      toast.error(t("settings.notifications.error"));
    } finally {
      setLoading(false);
    }
  };

  const handleSubscribe = async () => {
    if (permission !== "granted") {
      toast.error(t("settings.notifications.permissionDenied"));
      return;
    }

    setLoading(true);
    try {
      const sub = await subscribe();
      if (sub) {
        // Get device information
        const deviceInfo = getDeviceInfo();

        // Send subscription to backend with device info
        await subscribeMutation.mutateAsync({
          subscription: sub as unknown as Record<string, unknown>,
          deviceInfo: deviceInfo as unknown as Record<string, unknown>,
        });
        toast.success(t("settings.notifications.subscribeSuccess"));
        // Invalidate devices query to refetch
        queryClient.invalidateQueries({
          queryKey: queryKeys.notifications.devices(),
        });
      } else {
        toast.error(t("settings.notifications.error"));
      }
    } catch (error) {
      console.error("Error subscribing:", error);
      toast.error(t("settings.notifications.error"));
    } finally {
      setLoading(false);
    }
  };

  const handleUnsubscribe = async () => {
    setLoading(true);
    try {
      const success = await unsubscribe();
      if (success) {
        toast.success(t("settings.notifications.unsubscribeSuccess"));
        // Invalidate devices query to refetch
        queryClient.invalidateQueries({
          queryKey: queryKeys.notifications.devices(),
        });
      } else {
        toast.error(t("settings.notifications.error"));
      }
    } catch (error) {
      console.error("Error unsubscribing:", error);
      toast.error(t("settings.notifications.error"));
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteDevice = async (deviceId: number) => {
    confirm({
      variant: "destructive",
      description: t("settings.notifications.deleteDeviceConfirm"),
      confirmLabel: t("common.delete"),
      onConfirm: async () => {
        setLoading(true);
        try {
          await deleteDeviceMutation.mutateAsync(deviceId);
          toast.success(t("settings.notifications.deviceDeleted"));
        } catch (error) {
          console.error("Error deleting device:", error);
          toast.error(t("settings.notifications.deleteDeviceError"));
        } finally {
          setLoading(false);
        }
      },
    });
  };

  const formatDate = (input: string | Date | null) => {
    if (!input) return t("settings.notifications.unknownDate");
    try {
      const date = input instanceof Date ? input : new Date(input);
      return new Intl.DateTimeFormat(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      }).format(date);
    } catch {
      return t("settings.notifications.unknownDate");
    }
  };

  const getDeviceDisplayName = (device: (typeof devices)[0]) => {
    // Use device name if available
    if (device.device_name) {
      return device.device_name;
    }

    // Build name from browser and OS info
    const parts: string[] = [];

    if (device.browser_name) {
      const browserVersion = device.browser_version
        ? ` ${device.browser_version}`
        : "";
      parts.push(`${device.browser_name}${browserVersion}`);
    }

    if (device.os_name) {
      const osVersion = device.os_version ? ` ${device.os_version}` : "";
      parts.push(`on ${device.os_name}${osVersion}`);
    }

    if (parts.length > 0) {
      return parts.join(" ");
    }

    // Fallback to platform if available
    if (device.platform) {
      return device.platform;
    }

    // Last resort: try to guess from endpoint
    if (device.endpoint) {
      if (device.endpoint.includes("chrome"))
        return t("settings.notifications.chromeDevice");
      if (device.endpoint.includes("firefox"))
        return t("settings.notifications.firefoxDevice");
      if (device.endpoint.includes("safari"))
        return t("settings.notifications.safariDevice");
    }

    return t("settings.notifications.unknownDevice");
  };

  const handleTestNotification = async () => {
    setLoading(true);
    try {
      await testNotificationMutation.mutateAsync();
      toast.success(t("settings.notifications.testNotificationSuccess"));
    } catch (error) {
      console.error("Error sending test notification:", error);
      toast.error(t("settings.notifications.testNotificationError"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="animate-in fade-in slide-in-from-right-4 duration-300"
      key="notifications-tab"
    >
      <SettingsPageHeader
        icon={Bell}
        title={t("settings.notifications.title")}
        description={t("settings.notifications.description")}
      />
      <div className="bg-neutral-800 rounded-xl border border-neutral-700 p-6">
        {!isSupported ? (
          <div className="p-4 bg-yellow-900/20 text-yellow-200 rounded-lg">
            {t("settings.notifications.notSupported")}
          </div>
        ) : (
          <div className="space-y-6">
            {/* Test Notification Button */}
            {user?.is_admin && (
              <div>
                <h3 className="text-sm font-medium text-neutral-300 mb-2">
                  {t("settings.notifications.testNotificationTitle")}
                </h3>
                <Button
                  onClick={handleTestNotification}
                  disabled={loading}
                  className="w-full"
                >
                  {t("settings.notifications.sendTestNotification")}
                </Button>
                <p className="mt-2 text-sm text-neutral-400">
                  {t("settings.notifications.testNotificationDescription")}
                </p>
              </div>
            )}

            {/* Permission Status */}
            <div>
              <h3 className="text-sm font-medium text-neutral-300 mb-2">
                {t("settings.notifications.permission")}
              </h3>
              <div className="flex items-center justify-between p-4 bg-neutral-700/50 rounded-lg">
                <span className="text-neutral-100">
                  {t(`settings.notifications.status.${permission}`)}
                </span>
                {permission !== "granted" && (
                  <Button
                    onClick={handleRequestPermission}
                    disabled={loading || permission === "denied"}
                  >
                    {t("settings.notifications.requestPermission")}
                  </Button>
                )}
              </div>
              {permission === "denied" && (
                <p className="mt-2 text-sm text-neutral-400">
                  {t("settings.notifications.permissionDenied")}
                </p>
              )}
            </div>

            {/* Subscription Status */}
            {permission === "granted" && (
              <>
                <div>
                  <h3 className="text-sm font-medium text-neutral-300 mb-2">
                    {t("settings.notifications.subscription")}
                  </h3>
                  <div className="flex items-center justify-between p-4 bg-neutral-700/50 rounded-lg">
                    <span className="text-neutral-100">
                      {subscription
                        ? t("settings.notifications.subscribed")
                        : t("settings.notifications.notSubscribed")}
                    </span>
                    {subscription ? (
                      <Button
                        variant="destructive"
                        onClick={handleUnsubscribe}
                        disabled={loading}
                      >
                        {t("settings.notifications.unsubscribe")}
                      </Button>
                    ) : (
                      <Button
                        onClick={handleSubscribe}
                        disabled={loading || !isSupported}
                      >
                        {t("settings.notifications.subscribe")}
                      </Button>
                    )}
                  </div>
                </div>

                {/* Devices List */}
                <div>
                  <h3 className="text-sm font-medium text-neutral-300 mb-2">
                    {t("settings.notifications.devices")}
                  </h3>
                  {devicesLoading ? (
                    <div className="p-4 text-center text-neutral-400">
                      {t("settings.notifications.loadingDevices")}
                    </div>
                  ) : devices.length === 0 ? (
                    <div className="p-4 bg-neutral-700/50 rounded-lg text-neutral-400 text-sm">
                      {t("settings.notifications.noDevices")}
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {devices.map((device) => (
                        <div
                          key={device.id}
                          className="flex items-center justify-between p-4 bg-neutral-700/50 rounded-lg"
                        >
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-medium text-neutral-100">
                                {getDeviceDisplayName(device)}
                              </span>
                              {subscription &&
                                (
                                  subscription as unknown as {
                                    endpoint: string;
                                  }
                                ).endpoint === device.endpoint && (
                                  <span className="text-xs font-semibold px-1.5 py-0.5 rounded-full bg-primary-500/20 text-primary-400 uppercase tracking-wide flex-shrink-0">
                                    {t("settings.notifications.thisDevice")}
                                  </span>
                                )}
                            </div>
                            <div className="text-xs text-neutral-400 mt-1">
                              {t("settings.notifications.addedOn")}{" "}
                              {formatDate(device.created_at)}
                            </div>
                            {(device.browser_name || device.os_name) && (
                              <div className="text-xs text-neutral-500 mt-1">
                                {device.browser_name &&
                                  device.browser_version && (
                                    <span>
                                      {device.browser_name}{" "}
                                      {device.browser_version}
                                    </span>
                                  )}
                                {device.browser_name && device.os_name && " • "}
                                {device.os_name && (
                                  <span>
                                    {device.os_name}
                                    {device.os_version &&
                                      ` ${device.os_version}`}
                                  </span>
                                )}
                              </div>
                            )}
                          </div>
                          <Button
                            variant="destructive"
                            size="sm"
                            onClick={() => handleDeleteDevice(device.id)}
                            disabled={loading}
                            className="ml-4"
                            title={t("settings.notifications.deleteDevice")}
                          >
                            {t("settings.notifications.delete")}
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        )}
      </div>
      <div className="mt-6">
        <NotificationChannelsSection />
      </div>
    </div>
  );
}
