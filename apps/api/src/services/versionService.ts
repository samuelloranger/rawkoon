/**
 * Version service for checking app version changes and notifying users
 */

import { prisma } from "@rawkoon/api/db";
import { logActivity } from "@rawkoon/api/utils/activityLogs";
import { getJsonCache, setJsonCache } from "./cache";
import { createAndQueueNotification } from "@rawkoon/api/workers/notificationService";

const APP_VERSION_KEY = "rawkoon:app_version";

// APP_VERSION is injected at Docker build time via --build-arg APP_VERSION=<git-tag>.
// When absent or left at the default "0.0.0-dev", we stamp the process boot time so
// each container restart bumps the version — that way client-side cache busting fires
// on every redeploy (otherwise iOS Safari sticks on a stale service worker forever).
const APP_VERSION_RUNTIME = (() => {
  const fromEnv = process.env.APP_VERSION;
  if (fromEnv && fromEnv !== "0.0.0-dev") return fromEnv;
  return `0.0.0-dev+${Date.now()}`;
})();

function getCurrentAppVersion(): string {
  return APP_VERSION_RUNTIME;
}

export function getAppVersion(): string {
  return getCurrentAppVersion();
}

// True only when APP_VERSION came from a real build-time tag.
// The boot-time fallback (`0.0.0-dev+<ts>`) is for client cache busting only —
// it changes every restart and would otherwise spam "App Updated" notifications.
function isReleaseVersion(version: string): boolean {
  return !version.startsWith("0.0.0-dev");
}

async function getStoredAppVersion(): Promise<string | null> {
  return await getJsonCache<string>(APP_VERSION_KEY);
}

async function storeAppVersion(version: string): Promise<void> {
  // Store with a very long TTL (e.g., 1 year) as this is semi-permanent state
  await setJsonCache(APP_VERSION_KEY, version, 365 * 24 * 60 * 60);
  console.log(`Stored app version in Redis: ${version}`);
}

async function sendAppUpdateNotifications(newVersion?: string): Promise<void> {
  try {
    const version = newVersion || getAppVersion();

    // Standard internal notifications (Web Push, Expo Push)
    // Get all users who have at least one delivery channel
    const userIds = await prisma.user.findMany({
      where: {
        OR: [{ userSubscriptions: { some: {} } }],
      },
      select: { id: true },
    });

    if (userIds.length === 0) {
      console.log(
        "No users with subscriptions found for app update notification",
      );
      return;
    }

    console.log(
      `[VersionService] Enqueuing app update notifications for version ${version} to ${userIds.length} users`,
    );

    for (const { id: userId } of userIds) {
      await createAndQueueNotification(
        userId,
        "App Updated",
        `Rawkoon has been updated to version ${version}`,
        "app-update",
        "/",
        { version, silent: true },
      );
    }

    console.log(
      `[VersionService] App update notifications enqueued for ${userIds.length} users`,
    );
  } catch (error) {
    console.error(
      "[VersionService] Error sending app update notifications:",
      error,
    );
  }
}

export async function checkAndNotifyVersionChange(): Promise<void> {
  try {
    const currentVersion = getAppVersion();

    // Dev builds (no APP_VERSION build-arg) get a fresh boot-time stamp every
    // restart. Comparing those against Redis would log activity and notify all
    // subscribers on every container restart — skip the whole path.
    if (!isReleaseVersion(currentVersion)) {
      console.log(`Dev build (${currentVersion}); skipping version notify`);
      return;
    }

    const storedVersion = await getStoredAppVersion();

    if (storedVersion === null) {
      console.log(
        `First startup or Redis empty. Storing current version and notifying: ${currentVersion}`,
      );
      await storeAppVersion(currentVersion);
      await sendAppUpdateNotifications(currentVersion);
      return;
    }

    if (currentVersion !== storedVersion) {
      console.log(
        `App version changed from ${storedVersion} to ${currentVersion}`,
      );
      await logActivity({
        type: "app_updated",
        payload: { from_version: storedVersion, to_version: currentVersion },
      });
      await sendAppUpdateNotifications(currentVersion);
      await storeAppVersion(currentVersion);
    } else {
      console.log(`App version unchanged: ${currentVersion}`);
    }
  } catch (error) {
    console.error("Error checking app version change:", error);
  }
}
