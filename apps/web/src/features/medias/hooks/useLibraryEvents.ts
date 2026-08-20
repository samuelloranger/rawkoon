import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/queryKeys";

/**
 * Opens an SSE connection to /api/library/events and invalidates the affected
 * queries whenever the server pushes an update. One connection serves both
 * media and books; the payload's `kind` says which.
 *
 * Mount once per page that shows library or book state. Invalidating an
 * unmounted query only marks it stale, which is enough: it refetches when the
 * page mounts again (see QUERY_DEFAULTS.refetchOnMount).
 */
export function useLibraryEvents() {
  const queryClient = useQueryClient();

  useEffect(() => {
    const es = new EventSource("/api/library/events", {
      withCredentials: true,
    });

    es.onmessage = (e) => {
      try {
        const payload = JSON.parse(e.data as string) as {
          connected?: boolean;
          kind?: "media" | "book";
        };
        if (payload.connected) return; // initial handshake, ignore

        if (payload.kind === "book") {
          queryClient.invalidateQueries({ queryKey: queryKeys.books.all });
          return;
        }
        // Untagged events are media events from an older server.
        queryClient.invalidateQueries({ queryKey: queryKeys.library.all });
      } catch {
        // malformed event — ignore
      }
    };

    return () => es.close();
  }, [queryClient]);
}
