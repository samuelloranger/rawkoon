import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useFetcher } from "@/lib/api/context";
import { queryKeys } from "@/lib/queryKeys";
import { INTEGRATION_ENDPOINTS } from "@/lib/endpoints";
import type {
  NytBooksIntegrationResponse,
  NytBooksIntegrationUpdateResponse,
  NytBooksTestResponse,
} from "@rawkoon/shared/types";

export function useNytBooksIntegration() {
  const fetcher = useFetcher();
  return useQuery({
    queryKey: queryKeys.integrations.nytBooks(),
    queryFn: () =>
      fetcher<NytBooksIntegrationResponse>(INTEGRATION_ENDPOINTS.NYT_BOOKS),
    refetchOnMount: "always",
    staleTime: 0,
  });
}

export function useUpdateNytBooksIntegration() {
  const fetcher = useFetcher();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: { api_key: string; enabled: boolean }) =>
      fetcher<NytBooksIntegrationUpdateResponse>(
        INTEGRATION_ENDPOINTS.NYT_BOOKS,
        {
          method: "PUT",
          body: data,
        },
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.integrations.nytBooks(),
      });
      // The NYT discovery source appears/disappears with its key, so the shelf
      // source list is stale the moment the key changes.
      void queryClient.invalidateQueries({
        queryKey: queryKeys.books.discoverySources(),
      });
    },
  });
}

/**
 * Verify a key against the live API. Sending the typed value lets it be checked
 * before saving; sending nothing tests the stored key.
 */
export function useTestNytBooksIntegration() {
  const fetcher = useFetcher();
  return useMutation({
    mutationFn: (data: { api_key?: string }) =>
      fetcher<NytBooksTestResponse>(INTEGRATION_ENDPOINTS.NYT_BOOKS_TEST, {
        method: "POST",
        body: data,
      }),
  });
}
