import { sw } from "./sw";

// Handle app update - clear caches and reload all clients
export async function handleAppUpdate(): Promise<void> {
  console.log("Handling app update: clearing caches and reloading clients");

  try {
    // Clear all caches
    const cacheNames = await caches.keys();
    await Promise.all(
      cacheNames.map((cacheName) => {
        console.log(`Deleting cache: ${cacheName}`);
        return caches.delete(cacheName);
      }),
    );

    // Reload all open clients (tabs/windows)
    const clients = await sw.clients.matchAll({
      type: "window",
      includeUncontrolled: true,
    });
    clients.forEach((client) => {
      if (client.url) {
        console.log(`Reloading client: ${client.url}`);
        client.navigate(client.url);
      }
    });

    console.log("App update handled successfully");
  } catch (error) {
    console.error("Error handling app update:", error);
  }
}
