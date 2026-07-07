import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/queryKeys";

/**
 * Opens an SSE connection to /api/library/events and invalidates all library
 * queries whenever the server pushes a library update event.
 * Mount once at the library page level.
 */
export function useLibraryEvents() {
  const queryClient = useQueryClient();

  useEffect(() => {
    const es = new EventSource("/api/library/events", {
      withCredentials: true,
    });

    es.onmessage = (e) => {
      try {
        const payload = JSON.parse(e.data as string) as { connected?: boolean };
        if (payload.connected) return; // initial handshake, ignore
        queryClient.invalidateQueries({ queryKey: queryKeys.library.all });
      } catch {
        // malformed event — ignore
      }
    };

    return () => es.close();
  }, [queryClient]);
}
