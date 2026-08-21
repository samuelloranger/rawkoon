import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchApi } from "@/lib/api/client";
import { BOOKS_ENDPOINTS } from "@/lib/endpoints";
import { queryKeys } from "@/lib/queryKeys";
import { usePlayer } from "@/features/player/PlayerProvider";
import type {
  BookProgress,
  BookManifestResponse,
  BookProgressListResponse,
  BookProgressResponse,
  BookProgressWrite,
} from "@rawkoon/shared/types";
import { queueProgress } from "@/lib/offline/progressQueue";

export const useBookManifest = (editionId: number | null) =>
  useQuery({
    queryKey: queryKeys.books.manifest(editionId ?? 0),
    queryFn: () =>
      fetchApi<BookManifestResponse>(BOOKS_ENDPOINTS.MANIFEST(editionId!)),
    enabled: editionId != null,
    // The manifest changes only when files are imported, and the reader must
    // not refetch mid-read.
    staleTime: 5 * 60 * 1000,
  });

export const useBookProgress = (editionIds: number[]) =>
  useQuery({
    queryKey: queryKeys.books.progress(editionIds),
    queryFn: () =>
      fetchApi<BookProgressListResponse>(BOOKS_ENDPOINTS.PROGRESS(editionIds)),
    enabled: editionIds.length > 0,
  });

/**
 * Reset a position, or mark an edition finished.
 *
 * Both are server-side actions rather than a position write, because the
 * position must not travel. A client that fetched the row a minute ago holds a
 * snapshot, and resending it under a fresh timestamp would win the
 * newest-clock rule and rewind whatever another device advanced since —
 * "finished" promising to keep your place and then losing it. The endpoints
 * touch only the columns they mean to, stamped with the server's clock, which
 * is also what beats writes still queued on an offline device.
 *
 * The running player has to be let go of first. It saves every ten seconds with
 * `finished: false` and a clock of its own, so an edition left loaded would undo
 * either action within the next tick.
 */
export const useEndReading = (editionId: number) => {
  const queryClient = useQueryClient();
  const { releaseEdition } = usePlayer();

  return useMutation({
    mutationFn: (mode: "reset" | "finish") => {
      releaseEdition(editionId);
      return fetchApi<{ progress: BookProgress }>(
        mode === "finish"
          ? BOOKS_ENDPOINTS.EDITION_PROGRESS_FINISH(editionId)
          : BOOKS_ENDPOINTS.EDITION_PROGRESS_RESET(editionId),
        { method: "POST" },
      );
    },
    onSuccess: () => {
      // Every view of a position is now wrong: the book page, the list badges,
      // and the home widget.
      void queryClient.invalidateQueries({ queryKey: queryKeys.books.all });
    },
  });
};

/**
 * Save a position. A failed write is queued for the service worker rather than
 * surfaced: losing a scroll position is not worth a toast, and the queue is
 * what makes offline reading work.
 */
export const useSaveProgress = (editionId: number) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (body: BookProgressWrite) => {
      try {
        return await fetchApi<BookProgressResponse>(
          BOOKS_ENDPOINTS.EDITION_PROGRESS(editionId),
          { method: "PUT", body: JSON.stringify(body) },
        );
      } catch (err) {
        await queueProgress(editionId, body);
        throw err;
      }
    },
    onSuccess: (res) => {
      // Only a write that won. A rejected one comes back carrying the *stored*
      // position, and feeding that into the manifest dragged the reader back to
      // it a second after every page turn.
      if (!res.accepted) return;
      queryClient.setQueryData(
        queryKeys.books.manifest(editionId),
        (prev: BookManifestResponse | undefined) =>
          prev
            ? { manifest: { ...prev.manifest, progress: res.progress } }
            : prev,
      );
    },
    // A rejected write means another device is further along; there is nothing
    // for the reader to do about it.
    onError: () => {},
  });
};
