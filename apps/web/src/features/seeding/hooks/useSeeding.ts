import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SeedingResponse } from "@rawkoon/shared/types";
import { useFetcher } from "@/lib/api/context";
import { DOWNLOADS_ENDPOINTS } from "@/lib/endpoints";
import { queryKeys } from "@/lib/queryKeys";

export function useSeeding(
  opts: { preview?: boolean; enabled?: boolean } = {},
) {
  const fetcher = useFetcher();
  const preview = opts.preview ?? false;
  return useQuery({
    queryKey: queryKeys.downloads.seeding(preview),
    queryFn: () =>
      fetcher<SeedingResponse>(
        `${DOWNLOADS_ENDPOINTS.SEEDING}${preview ? "?preview=1" : ""}`,
      ),
    enabled: opts.enabled ?? true,
    // Seed-state pushes patch this cache; the slow poll only catches drift between sweeps.
    refetchInterval: 60_000,
  });
}

export function useReleaseTorrent() {
  const fetcher = useFetcher();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (hash: string) =>
      fetcher<{ released: true; freed_bytes: number | null }>(
        DOWNLOADS_ENDPOINTS.RELEASE(hash),
        { method: "POST" },
      ),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.downloads.all }),
  });
}
