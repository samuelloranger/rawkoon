import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useFetcher } from "@/lib/api/context";
import { queryKeys } from "@/lib/queryKeys";
import { ADMIN_ENDPOINTS } from "@/lib/endpoints";
import type {
  LibraryHealthIgnoresResponse,
  LibraryHealthResponse,
} from "@rawkoon/shared/types";

export function useLibraryHealth() {
  const fetcher = useFetcher();

  return useQuery({
    queryKey: queryKeys.admin.libraryHealth(),
    queryFn: () =>
      fetcher<LibraryHealthResponse>(ADMIN_ENDPOINTS.LIBRARY_HEALTH),
    refetchInterval: 45_000,
    refetchOnWindowFocus: true,
  });
}

export function useLibraryHealthIgnores(enabled: boolean) {
  const fetcher = useFetcher();

  return useQuery({
    queryKey: queryKeys.admin.libraryHealthIgnores(),
    queryFn: () =>
      fetcher<LibraryHealthIgnoresResponse>(
        ADMIN_ENDPOINTS.LIBRARY_HEALTH_IGNORES,
      ),
    enabled,
  });
}

export function useIgnoreLibraryHealthIssue() {
  const fetcher = useFetcher();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (issueKey: string) =>
      fetcher(ADMIN_ENDPOINTS.LIBRARY_HEALTH_IGNORES, {
        method: "POST",
        body: { issue_key: issueKey },
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: queryKeys.admin.libraryHealth(),
      }),
  });
}

export function useRestoreLibraryHealthIssue() {
  const fetcher = useFetcher();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: number) =>
      fetcher(ADMIN_ENDPOINTS.LIBRARY_HEALTH_IGNORE(id), { method: "DELETE" }),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: queryKeys.admin.libraryHealth(),
      }),
  });
}
