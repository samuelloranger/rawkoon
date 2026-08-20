import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useFetcher } from "@/lib/api/context";
import { queryKeys } from "@/lib/queryKeys";
import { INTEGRATION_ENDPOINTS } from "@/lib/endpoints";
import type {
  GoogleBooksIntegrationResponse,
  GoogleBooksIntegrationUpdateResponse,
  GoogleBooksTestResponse,
} from "@rawkoon/shared/types";

export function useGoogleBooksIntegration() {
  const fetcher = useFetcher();
  return useQuery({
    queryKey: queryKeys.integrations.googleBooks(),
    queryFn: () =>
      fetcher<GoogleBooksIntegrationResponse>(
        INTEGRATION_ENDPOINTS.GOOGLE_BOOKS,
      ),
    refetchOnMount: "always",
    staleTime: 0,
  });
}

export function useUpdateGoogleBooksIntegration() {
  const fetcher = useFetcher();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: { api_key: string; enabled: boolean }) =>
      fetcher<GoogleBooksIntegrationUpdateResponse>(
        INTEGRATION_ENDPOINTS.GOOGLE_BOOKS,
        { method: "PUT", body: data },
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.integrations.googleBooks(),
      });
      // The books pages refuse to search without a provider, so their queries
      // are stale the moment the key changes.
      void queryClient.invalidateQueries({ queryKey: queryKeys.books.all });
    },
  });
}

/**
 * Verify a key against the live API. Sending the typed value lets it be checked
 * before saving; sending nothing tests the stored key.
 */
export function useTestGoogleBooksIntegration() {
  const fetcher = useFetcher();
  return useMutation({
    mutationFn: (data: { api_key?: string }) =>
      fetcher<GoogleBooksTestResponse>(
        INTEGRATION_ENDPOINTS.GOOGLE_BOOKS_TEST,
        {
          method: "POST",
          body: data,
        },
      ),
  });
}
