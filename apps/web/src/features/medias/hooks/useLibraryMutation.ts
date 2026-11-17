import {
  useMutation,
  useQueryClient,
  type QueryKey,
} from "@tanstack/react-query";
import { useFetcher, type FetcherOptions } from "@/lib/api/context";
import { queryKeys } from "@/lib/queryKeys";

/** Every library.* key nests under library.all, so only keys outside it go in `invalidate`. */
export function useLibraryMutation<TVars = void, TRes = unknown>(
  build: (vars: TVars) => [endpoint: string, init?: FetcherOptions],
  options?: { invalidate?: (vars: TVars) => QueryKey[] },
) {
  const fetcher = useFetcher();
  const queryClient = useQueryClient();

  return useMutation<TRes, Error, TVars>({
    mutationFn: (vars) => fetcher<TRes>(...build(vars)),
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.library.all });
      for (const queryKey of options?.invalidate?.(vars) ?? []) {
        queryClient.invalidateQueries({ queryKey });
      }
    },
  });
}
