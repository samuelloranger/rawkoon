import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  SeedRulesResponse,
  UpsertSeedRuleRequest,
} from "@rawkoon/shared/types";
import { useFetcher } from "@/lib/api/context";
import { DOWNLOADS_ENDPOINTS } from "@/lib/endpoints";
import { queryKeys } from "@/lib/queryKeys";

export function useSeedRules() {
  const fetcher = useFetcher();
  return useQuery({
    queryKey: queryKeys.downloads.seedRules(),
    queryFn: () => fetcher<SeedRulesResponse>(DOWNLOADS_ENDPOINTS.SEED_RULES),
  });
}

function useInvalidateSeeding() {
  const queryClient = useQueryClient();
  return () =>
    queryClient.invalidateQueries({ queryKey: queryKeys.downloads.all });
}

export function useUpsertSeedRule() {
  const fetcher = useFetcher();
  const invalidate = useInvalidateSeeding();
  return useMutation({
    mutationFn: ({
      indexer,
      rule,
    }: {
      indexer: string;
      rule: UpsertSeedRuleRequest;
    }) =>
      fetcher(DOWNLOADS_ENDPOINTS.SEED_RULE(indexer), {
        method: "PUT",
        body: rule,
      }),
    onSuccess: invalidate,
  });
}

export function useDeleteSeedRule() {
  const fetcher = useFetcher();
  const invalidate = useInvalidateSeeding();
  return useMutation({
    mutationFn: (indexer: string) =>
      fetcher(DOWNLOADS_ENDPOINTS.SEED_RULE(indexer), { method: "DELETE" }),
    onSuccess: invalidate,
  });
}
