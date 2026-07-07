import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useFetcher } from "@/lib/api/context";
import { RELEASES_ENDPOINTS } from "@/lib/endpoints";
import { queryKeys } from "@/lib/queryKeys";
import type {
  GitHubReleasesResponse,
  RefreshGitHubReleasesResponse,
} from "@rawkoon/shared/types";

export function useGitHubReleases() {
  const fetcher = useFetcher();

  return useQuery({
    queryKey: queryKeys.releases.list(),
    queryFn: () => fetcher<GitHubReleasesResponse>(RELEASES_ENDPOINTS.LIST),
    refetchOnWindowFocus: true,
  });
}

export function useRefreshGitHubReleases() {
  const fetcher = useFetcher();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () =>
      fetcher<RefreshGitHubReleasesResponse>(RELEASES_ENDPOINTS.REFRESH, {
        method: "POST",
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.releases.all });
    },
  });
}
