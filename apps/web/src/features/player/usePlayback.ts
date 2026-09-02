import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchApi } from "@/lib/api/client";
import { BOOKS_ENDPOINTS } from "@/lib/endpoints";
import { queryKeys } from "@/lib/queryKeys";
import type {
  BookItemResponse,
  BookListeningProgressRequest,
  BookListeningProgressResponse,
  BookManifest,
  BookReadingProgressRequest,
  BookReadingProgressResponse,
} from "@rawkoon/shared/types";

export function useListeningProgress() {
  return useQuery({
    queryKey: queryKeys.books.progress(),
    queryFn: () =>
      fetchApi<BookListeningProgressResponse>(BOOKS_ENDPOINTS.PROGRESS),
  });
}

export function useReadingProgress() {
  return useQuery({
    queryKey: queryKeys.books.readingProgress(),
    queryFn: () =>
      fetchApi<BookReadingProgressResponse>(BOOKS_ENDPOINTS.READING_PROGRESS),
  });
}

export function useManifest(editionId: number | null) {
  return useQuery({
    queryKey: queryKeys.books.manifest(editionId ?? 0),
    queryFn: () => fetchApi<BookManifest>(BOOKS_ENDPOINTS.MANIFEST(editionId!)),
    enabled: editionId != null && editionId > 0,
  });
}

export async function fetchManifest(editionId: number): Promise<BookManifest> {
  return fetchApi<BookManifest>(BOOKS_ENDPOINTS.MANIFEST(editionId));
}

export async function fetchListeningProgress(): Promise<BookListeningProgressResponse> {
  return fetchApi<BookListeningProgressResponse>(BOOKS_ENDPOINTS.PROGRESS);
}

export async function fetchBookCover(bookId: number): Promise<string | null> {
  const res = await fetchApi<BookItemResponse>(BOOKS_ENDPOINTS.DETAIL(bookId));
  return res.item.cover_url;
}

export async function putListeningProgress(
  editionId: number,
  body: BookListeningProgressRequest,
): Promise<{ applied: boolean }> {
  return fetchApi<{ applied: boolean }>(
    BOOKS_ENDPOINTS.PUT_PROGRESS(editionId),
    {
      method: "PUT",
      body: JSON.stringify(body),
    },
  );
}

export async function putReadingProgress(
  editionId: number,
  body: BookReadingProgressRequest,
): Promise<{ applied: boolean }> {
  return fetchApi<{ applied: boolean }>(
    BOOKS_ENDPOINTS.PUT_READING_PROGRESS(editionId),
    {
      method: "PUT",
      body: JSON.stringify(body),
    },
  );
}

export function usePutReadingProgress() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      editionId,
      body,
    }: {
      editionId: number;
      body: BookReadingProgressRequest;
    }) =>
      fetchApi<{ applied: boolean }>(
        BOOKS_ENDPOINTS.PUT_READING_PROGRESS(editionId),
        {
          method: "PUT",
          body: JSON.stringify(body),
        },
      ),
    onSuccess: () => {
      void qc.invalidateQueries({
        queryKey: queryKeys.books.readingProgress(),
      });
    },
  });
}
