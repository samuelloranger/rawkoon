import { sw } from "./sw";
import { BOOK_CACHE } from "./book-cache";

// Handle app update - clear caches and reload all clients
export async function handleAppUpdate(): Promise<void> {
  console.log("Handling app update: clearing caches and reloading clients");

  try {
    // Clear every cache except the books someone explicitly downloaded. An app
    // update must not take away what a user chose to keep offline.
    const cacheNames = await caches.keys();
    await Promise.all(
      cacheNames
        .filter((cacheName) => cacheName !== BOOK_CACHE)
        .map((cacheName) => {
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
