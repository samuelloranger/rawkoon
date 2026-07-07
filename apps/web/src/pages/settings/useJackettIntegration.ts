import { useQuery } from "@tanstack/react-query";
import { useFetcher } from "@/lib/api/context";
import { queryKeys } from "@/lib/queryKeys";
import { INTEGRATION_ENDPOINTS } from "@/lib/endpoints";
import type { JackettIntegration } from "@rawkoon/shared/types";

export function useJackettIntegration() {
  const fetcher = useFetcher();
  return useQuery({
    queryKey: queryKeys.integrations.jackett(),
    queryFn: () =>
      fetcher<{ integration: JackettIntegration }>(
        INTEGRATION_ENDPOINTS.JACKETT,
      ),
    refetchOnMount: "always",
    staleTime: 0,
  });
}
