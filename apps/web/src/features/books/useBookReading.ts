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
 * Reset a position, or mark an edition finished.
 *
 * Both go through the same PUT the reader uses, on purpose. Deleting the row
 * would be the obvious move and the wrong one: the conflict rule is "newest
 * client clock wins", so a write still queued on a phone would recreate the
 * position the moment that phone came back online. A write stamped now beats
 * the queue instead.
 *
 * Reset clears the locator and zeroes the position, which is what puts the book
 * back at its first page. Finishing keeps the position and stamps `finished_at`,
 * because "I am done with this" is not "I never read it".
 */
export const useEndReading = (editionId: number) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: EndReadingInput) =>
      fetchApi<BookProgressResponse>(
        BOOKS_ENDPOINTS.EDITION_PROGRESS(editionId),
        {
          method: "PUT",
          // Every field is sent every time: the write replaces the row, so an
          // omitted one is stored as null. Finishing therefore has to carry the
          // position forward rather than leave it out.
          body: JSON.stringify(
            input.mode === "finish"
              ? {
                  locator: input.locator ?? null,
                  percent: 1,
                  position_secs: input.position_secs ?? null,
                  file_id: input.file_id ?? null,
                  finished: true,
                  client_updated_at: nowIso(),
                }
              : {
                  locator: null,
                  percent: 0,
                  position_secs: 0,
                  file_id: null,
                  client_updated_at: nowIso(),
                },
          ),
        },
      ),
    onSuccess: () => {
      // Every view of a position is now wrong: the book page, the list badges,
      // and the home widget.
      void queryClient.invalidateQueries({ queryKey: queryKeys.books.all });
    },
  });
};

const nowIso = () => new Date().toISOString();

/** Finishing keeps the position it is given; resetting needs nothing. */
export type EndReadingInput =
  | { mode: "reset" }
  | {
      mode: "finish";
      locator?: string | null;
      position_secs?: number | null;
      file_id?: number | null;
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
