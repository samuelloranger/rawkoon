import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchApi } from "@/lib/api/client";
import { BOOKS_ENDPOINTS } from "@/lib/endpoints";
import { queryKeys } from "@/lib/queryKeys";
import type {
  AddBookRequest,
  AuthorListResponse,
  AuthorResponse,
  BookEditionKind,
  BookFilesResponse,
  BookFormat,
  BookItemResponse,
  BookListResponse,
  BookQualityProfile,
  BookQualityProfileListResponse,
  BookReleaseSearchResponse,
  BookSearchResponse,
} from "@rawkoon/shared/types";

export type BookListParams = {
  q?: string;
  kind?: BookEditionKind;
  status?: string;
  page?: number;
  limit?: number;
  sortBy?: string;
  sortDir?: "asc" | "desc";
};

const listQuery = (params: BookListParams): string => {
  const sp = new URLSearchParams();
  if (params.q) sp.set("q", params.q);
  if (params.kind) sp.set("kind", params.kind);
  if (params.status) sp.set("status", params.status);
  if (params.page) sp.set("page", String(params.page));
  if (params.limit) sp.set("limit", String(params.limit));
  if (params.sortBy) sp.set("sort_by", params.sortBy);
  if (params.sortDir) sp.set("sort_dir", params.sortDir);
  const qs = sp.toString();
  return qs ? `${BOOKS_ENDPOINTS.LIST}?${qs}` : BOOKS_ENDPOINTS.LIST;
};

export function useBooks(params: BookListParams = {}) {
  return useQuery({
    queryKey: queryKeys.books.list(params),
    queryFn: () => fetchApi<BookListResponse>(listQuery(params)),
  });
}

export function useBook(id: number) {
  return useQuery({
    queryKey: queryKeys.books.detail(id),
    queryFn: () => fetchApi<BookItemResponse>(BOOKS_ENDPOINTS.DETAIL(id)),
    enabled: Number.isFinite(id) && id > 0,
  });
}

/**
 * Provider search for the add flow. Only fires on an explicit submit, never
 * per keystroke: Google Books is rate-limited and returns 503 under load.
 */
export function useBookProviderSearch(term: string, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.books.providerSearch(term),
    queryFn: () =>
      fetchApi<BookSearchResponse>(
        `${BOOKS_ENDPOINTS.SEARCH}?q=${encodeURIComponent(term)}`,
      ),
    enabled: enabled && term.trim().length > 1,
    retry: false,
    staleTime: 5 * 60 * 1000,
  });
}

export function useAddBook() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: AddBookRequest) =>
      fetchApi<BookItemResponse>(BOOKS_ENDPOINTS.ADD, {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.books.all });
    },
  });
}

export function useDeleteBook() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) =>
      fetchApi<{ deleted: boolean }>(BOOKS_ENDPOINTS.DELETE(id), {
        method: "DELETE",
      }),
    onSuccess: (_data, id) => {
      // Drop the detail entry rather than invalidating it: invalidating would
      // refetch a book that no longer exists and paint the "not in the library"
      // state for a frame on the way out.
      qc.removeQueries({ queryKey: queryKeys.books.detail(id) });
      void qc.invalidateQueries({ queryKey: queryKeys.books.all });
    },
  });
}

export function useUpdateEdition(bookId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      kind,
      ...body
    }: {
      kind: BookEditionKind;
      monitored?: boolean;
      status?: string;
      book_quality_profile_id?: number | null;
    }) =>
      fetchApi(BOOKS_ENDPOINTS.EDITION(bookId, kind), {
        method: "PATCH",
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.books.detail(bookId) });
      void qc.invalidateQueries({ queryKey: queryKeys.books.all });
    },
  });
}

export function useAddEdition(bookId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { kind: BookEditionKind; monitored?: boolean }) =>
      fetchApi(BOOKS_ENDPOINTS.ADD_EDITION(bookId), {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.books.detail(bookId) });
    },
  });
}

/**
 * Adopt files already sitting in the library for this edition. Removing a book
 * keeps its files on disk, so a re-added book reads "wanted" with the file
 * right there until this runs.
 */
export function useRescanEdition(bookId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (kind: BookEditionKind) =>
      fetchApi<{
        registered: number;
        refreshed: number;
        removed: number;
        directory: string | null;
      }>(BOOKS_ENDPOINTS.RESCAN(bookId, kind), { method: "POST" }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.books.all });
    },
  });
}

export function useEditionFiles(
  bookId: number,
  kind: BookEditionKind,
  enabled: boolean,
) {
  return useQuery({
    queryKey: queryKeys.books.editionFiles(bookId, kind),
    queryFn: () =>
      fetchApi<BookFilesResponse>(BOOKS_ENDPOINTS.EDITION_FILES(bookId, kind)),
    enabled,
  });
}

/** Indexer search. Manual trigger only — it hits every configured tracker. */
export function useReleaseSearch(
  bookId: number,
  kind: BookEditionKind,
  enabled: boolean,
) {
  return useQuery({
    queryKey: queryKeys.books.releaseSearch(bookId, kind),
    queryFn: () =>
      fetchApi<BookReleaseSearchResponse>(
        BOOKS_ENDPOINTS.RELEASE_SEARCH(bookId, kind),
      ),
    enabled,
    retry: false,
    staleTime: 60 * 1000,
  });
}

/**
 * Drop a cached release search.
 *
 * removeQueries rather than invalidateQueries: invalidating would refetch and
 * put the same list straight back. The results are meant to be gone until the
 * user asks for them again.
 */
export function useClearReleaseSearch(bookId: number, kind: BookEditionKind) {
  const qc = useQueryClient();
  return () => {
    qc.removeQueries({
      queryKey: queryKeys.books.releaseSearch(bookId, kind),
    });
  };
}

export function useGrabRelease(bookId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      kind,
      ...body
    }: {
      kind: BookEditionKind;
      release_title: string;
      download_url?: string;
      magnet_url?: string;
      indexer?: string | null;
    }) =>
      fetchApi<{ grabbed: boolean; release_title?: string; reason?: string }>(
        BOOKS_ENDPOINTS.GRAB(bookId, kind),
        { method: "POST", body: JSON.stringify(body) },
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.books.detail(bookId) });
      // The list shows edition status too, so it has to see the grab as well —
      // otherwise the list stays on "wanted" while the detail says
      // "downloading", and the list never starts polling.
      void qc.invalidateQueries({ queryKey: queryKeys.books.all });
    },
  });
}

export function useBookQualityProfiles() {
  return useQuery({
    queryKey: queryKeys.books.qualityProfiles(),
    queryFn: () =>
      fetchApi<BookQualityProfileListResponse>(
        BOOKS_ENDPOINTS.QUALITY_PROFILES,
      ),
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Book quality profile writes. Editions read their profile at search time, so
 * only the profile list needs invalidating — nothing about a book's stored
 * state changes when a profile does.
 */
export type BookQualityProfileBody = {
  name: string;
  kind: BookQualityProfile["kind"];
  allowed_formats: BookFormat[];
  cutoff_format: BookFormat | null;
  prefer_retail: boolean;
  max_size_mb: number | null;
  min_seeders: number;
  min_audio_bitrate: number | null;
  preferred_languages: string[];
  prioritized_trackers: string[];
  prefer_tracker_over_quality: boolean;
};

export function useCreateBookQualityProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: BookQualityProfileBody) =>
      fetchApi<{ profile: BookQualityProfile }>(
        BOOKS_ENDPOINTS.QUALITY_PROFILES,
        { method: "POST", body: JSON.stringify(body) },
      ),
    onSuccess: () => {
      void qc.invalidateQueries({
        queryKey: queryKeys.books.qualityProfiles(),
      });
    },
  });
}

export function useUpdateBookQualityProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: BookQualityProfileBody & { id: number }) =>
      fetchApi<{ profile: BookQualityProfile }>(
        BOOKS_ENDPOINTS.QUALITY_PROFILE(id),
        { method: "PATCH", body: JSON.stringify(body) },
      ),
    onSuccess: () => {
      void qc.invalidateQueries({
        queryKey: queryKeys.books.qualityProfiles(),
      });
    },
  });
}

export function useDeleteBookQualityProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) =>
      fetchApi<{ deleted: boolean }>(BOOKS_ENDPOINTS.QUALITY_PROFILE(id), {
        method: "DELETE",
      }),
    onSuccess: () => {
      void qc.invalidateQueries({
        queryKey: queryKeys.books.qualityProfiles(),
      });
      // An edition pointing at the deleted profile is set to null server side,
      // so its detail payload is now stale.
      void qc.invalidateQueries({ queryKey: queryKeys.books.all });
    },
  });
}

export function useAuthors() {
  return useQuery({
    queryKey: queryKeys.books.authors(),
    queryFn: () => fetchApi<AuthorListResponse>(BOOKS_ENDPOINTS.AUTHORS),
  });
}

/**
 * Author monitoring. Invalidates the author list only — monitoring changes
 * nothing about the books already in the library; new titles arrive through the
 * scheduled author check.
 */
export function useUpdateAuthor() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      ...body
    }: {
      id: number;
      monitored?: boolean;
      monitor_from?: string | null;
      monitor_edition_kinds?: BookEditionKind[];
      monitor_languages?: string[];
      book_quality_profile_id?: number | null;
    }) =>
      fetchApi<AuthorResponse>(BOOKS_ENDPOINTS.AUTHOR(id), {
        method: "PATCH",
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.books.authors() });
    },
  });
}
