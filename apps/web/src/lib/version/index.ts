/**
 * Version checking utility for cache clearing and app reload
 */

import { fetchApi } from "@/lib/api/client";
import { SYSTEM_ENDPOINTS } from "@/lib/endpoints";
const VERSION_STORAGE_KEY = "rawkoon_app_version";

/**
 * Clear all caches (CacheStorage, localStorage, sessionStorage)
 * Note: We do NOT unregister the service worker to preserve push notification subscriptions.
 * The service worker can clear its own caches without being unregistered.
 */
async function clearAllCaches(): Promise<void> {
  try {
    // Clear CacheStorage (Service Worker caches)
    // We send a message to the service worker to clear its caches
    // This preserves the service worker registration and push subscriptions
    if ("serviceWorker" in navigator && "caches" in window) {
      try {
        const registration = await navigator.serviceWorker.ready;
        if (registration.active) {
          // Request the service worker to clear its caches
          registration.active.postMessage({ type: "clearCache" });
        }
      } catch (error) {
        console.warn(
          "Could not send clearCache message to service worker:",
          error,
        );
      }

      // Also clear caches directly (in case service worker is not active)
      const cacheNames = await caches.keys();
      await Promise.all(cacheNames.map((name) => caches.delete(name)));
    }

    // Clear localStorage (except version which we'll set next)
    const versionToKeep = localStorage.getItem(VERSION_STORAGE_KEY);
    localStorage.clear();
    if (versionToKeep) {
      localStorage.setItem(VERSION_STORAGE_KEY, versionToKeep);
    }

    // Clear sessionStorage
    sessionStorage.clear();
  } catch (error) {
    console.error("Error clearing caches:", error);
  }
}

/**
 * Get version from the API
 */
async function getServerVersion(): Promise<string | null> {
  try {
    const data = await fetchApi<{ version: string }>(SYSTEM_ENDPOINTS.VERSION);
    return data.version;
  } catch (error) {
    console.error("Failed to get server version:", error);
    return null;
  }
}

/**
 * Check version and reload if needed
 * This should be called on app initialization
 * @returns true if reload was triggered, false otherwise
 */
export async function checkVersionAndReload(): Promise<boolean> {
  try {
    const serverVersion = await getServerVersion();
    if (!serverVersion || serverVersion === "unknown") {
      // If we can't get version, don't reload
      console.warn("Could not get server version, skipping version check");
      return false;
    }

    const storedVersion = localStorage.getItem(VERSION_STORAGE_KEY);
    if (!storedVersion || storedVersion !== serverVersion) {
      console.log(
        `Version mismatch detected: stored=${storedVersion}, server=${serverVersion}. Clearing cache and reloading.`,
      );
      await clearAllCaches();
      localStorage.setItem(VERSION_STORAGE_KEY, serverVersion);
      window.location.reload();
      return true;
    }

    // Versions match, no action needed
    console.log(`Version check passed: ${serverVersion}`);
    return false;
  } catch (error) {
    console.error("Error during version check:", error);
    // Don't reload on error, let the app continue
    return false;
  }
}
