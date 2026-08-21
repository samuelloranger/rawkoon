import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchApi } from "@/lib/api/client";
import { BOOKS_ENDPOINTS } from "@/lib/endpoints";
import { queryKeys } from "@/lib/queryKeys";
import type {
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
