import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useFetcher } from "@/lib/api/context";
import { queryKeys } from "@/lib/queryKeys";
import { INTEGRATION_ENDPOINTS } from "@/lib/endpoints";
import type {
  AudnexusIntegrationResponse,
  AudnexusIntegrationUpdateResponse,
  AudnexusTestResponse,
} from "@rawkoon/shared/types";

/**
 * Mirrors useGoogleBooksIntegration. Audnexus has no secret, so the whole
 * config round-trips rather than being write-only.
 */

export function useAudnexusIntegration() {
  const fetcher = useFetcher();
  return useQuery({
    queryKey: queryKeys.integrations.audnexus(),
    queryFn: () =>
      fetcher<AudnexusIntegrationResponse>(INTEGRATION_ENDPOINTS.AUDNEXUS),
    refetchOnMount: "always",
    staleTime: 0,
  });
}

export function useUpdateAudnexusIntegration() {
  const fetcher = useFetcher();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: {
      base_url: string;
      region: string;
      enabled: boolean;
    }) =>
      fetcher<AudnexusIntegrationUpdateResponse>(
        INTEGRATION_ENDPOINTS.AUDNEXUS,
        { method: "PUT", body: data },
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.integrations.audnexus(),
      });
      // Every book's merged metadata is stale the moment a source changes.
      void queryClient.invalidateQueries({ queryKey: queryKeys.books.all });
    },
  });
}

export function useTestAudnexusIntegration() {
  const fetcher = useFetcher();
  return useMutation({
    mutationFn: (data: { base_url: string; region: string }) =>
      fetcher<AudnexusTestResponse>(INTEGRATION_ENDPOINTS.AUDNEXUS_TEST, {
        method: "POST",
        body: data,
      }),
  });
}
