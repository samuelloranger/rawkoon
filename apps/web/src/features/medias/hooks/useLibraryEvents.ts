import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type {
  DownloadProgressItem,
  LibraryDownloadsResponse,
  SeedingResponse,
  SeedStateEvent,
  SeedStateItem,
} from "@rawkoon/shared/types";
import { mergeSeedState } from "@/features/seeding/lib/mergeSeedState";
import { queryKeys } from "@/lib/queryKeys";
import { mergeDownloadProgress } from "../lib/mergeDownloadProgress";

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
          kind?: "media" | "book" | "download-progress" | "seed-state";
          mediaId?: number;
          downloads?: DownloadProgressItem[];
          torrents?: SeedStateItem[];
          ts?: number;
        };
        if (payload.connected) {
          queryClient.invalidateQueries({ queryKey: queryKeys.library.all });
          queryClient.invalidateQueries({ queryKey: queryKeys.books.all });
          return;
        }

        // Live progress carries the numbers directly: patch the cache in place
        // rather than invalidate, so the bar moves without a refetch.
        if (
          payload.kind === "download-progress" &&
          typeof payload.mediaId === "number" &&
          payload.downloads
        ) {
          const downloads = payload.downloads;
          queryClient.setQueryData<LibraryDownloadsResponse>(
            queryKeys.library.downloads(payload.mediaId),
            (current) => mergeDownloadProgress(current, downloads),
          );
          return;
        }

        if (payload.kind === "seed-state" && payload.torrents) {
          const event: SeedStateEvent = {
            kind: "seed-state",
            ts: payload.ts ?? Date.now(),
            torrents: payload.torrents,
          };
          queryClient.setQueriesData<SeedingResponse>(
            { queryKey: [...queryKeys.downloads.all, "seeding"] },
            (current) => mergeSeedState(current, event),
          );
          if (payload.torrents.some((i) => i.released)) {
            queryClient.invalidateQueries({ queryKey: queryKeys.library.all });
          }
          return;
        }

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
