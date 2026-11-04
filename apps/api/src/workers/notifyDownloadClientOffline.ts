import type { DownloadClientType } from "@rawkoon/api/services/downloadClient/types";
import { notificationCopy } from "@rawkoon/api/services/notification/notificationCopy";
import { notifyAdmins } from "@rawkoon/api/workers/libraryNotificationHelpers";

const CLIENT_NAMES: Record<DownloadClientType, string> = {
  qbittorrent: "qBittorrent",
  transmission: "Transmission",
  deluge: "Deluge",
  rdtclient: "rdt-client",
};

export async function notifyAdminsDownloadClientOffline(
  client: DownloadClientType,
): Promise<void> {
  await notifyAdmins(
    (locale) => ({
      type: "download_client_offline",
      title: notificationCopy(locale, "downloadClientOfflineTitle"),
      body: notificationCopy(locale, "downloadClientOfflineBody", {
        client: CLIENT_NAMES[client],
      }),
      url: "/settings/connections",
    }),
    {
      notifyOptions: { preferenceKey: "download_client_offline" },
      logTag: "notifyAdminsDownloadClientOffline",
    },
  );
}
