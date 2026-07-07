import { useQuery } from "@tanstack/react-query";
import { useFetcher } from "@/lib/api/context";
import { queryKeys } from "@/lib/queryKeys";
import { MEDIAS_ENDPOINTS } from "@/lib/endpoints";
import type { QueryKey } from "@tanstack/react-query";
import type {
  DiscoverMediasParams,
  DiscoverMediasResponse,
} from "@rawkoon/shared/types";

/** Keep discover placeholder only when paginating so filter changes still show a fresh skeleton. */
function discoverKeysMatchExceptPage(
  prevKey: QueryKey,
  nextKey: QueryKey,
): boolean {
  if (prevKey.length !== nextKey.length) return false;
  const pIdx = prevKey.indexOf("discover");
  const nIdx = nextKey.indexOf("discover");
  if (pIdx !== nIdx || pIdx < 0) return false;
  const pageIdx = pIdx + 5;
  if (pageIdx >= prevKey.length) return false;
  for (let i = pIdx; i < prevKey.length; i++) {
    if (i === pageIdx) continue;
    if (prevKey[i] !== nextKey[i]) return false;
  }
  return true;
}

export function useDiscoverMedias(params: DiscoverMediasParams) {
  const fetcher = useFetcher();
  const nextKey = queryKeys.medias.discover(params);

  return useQuery({
    queryKey: nextKey,
    queryFn: () =>
      fetcher<DiscoverMediasResponse>(MEDIAS_ENDPOINTS.DISCOVER(params)),
    placeholderData: (previousData, previousQuery) => {
      if (!previousData || !previousQuery?.queryKey) return undefined;
      return discoverKeysMatchExceptPage(previousQuery.queryKey, nextKey)
        ? previousData
        : undefined;
    },
  });
}
