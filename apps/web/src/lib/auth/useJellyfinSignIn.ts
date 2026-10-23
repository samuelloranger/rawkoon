import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useFetcher } from "@/lib/api/context";
import { HttpError } from "@/lib/api/httpClient";
import { queryKeys } from "@/lib/queryKeys";
import { AUTH_ENDPOINTS } from "@/lib/endpoints";
import { resetUserCache } from "@/lib/auth";
import type { JellyfinProfileLink } from "@rawkoon/shared/types";

interface Credentials {
  username: string;
  password: string;
}

/** The server doesn't promise error text reaches the client, so the status picks the message. */
export function jellyfinErrorKey(error: unknown): string {
  if (error instanceof HttpError) {
    switch (error.status) {
      case 401:
        return "login.jellyfin.invalidCredentials";
      case 403:
        return "login.jellyfin.noAccess";
      case 404:
        return "login.jellyfin.disabled";
      case 409:
        return "login.jellyfin.alreadyLinked";
      case 502:
        return "login.jellyfin.unreachable";
    }
  }
  return "login.authFailed";
}

export function useJellyfinLogin() {
  const fetcher = useFetcher();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: Credentials) =>
      fetcher<{ user: unknown }>(AUTH_ENDPOINTS.JELLYFIN_LOGIN, {
        method: "POST",
        body: data,
      }),
    onSuccess: () => {
      resetUserCache();
      queryClient.invalidateQueries({ queryKey: queryKeys.auth.all });
    },
  });
}

export function useJellyfinProfile(enabled: boolean) {
  const fetcher = useFetcher();
  return useQuery({
    queryKey: queryKeys.auth.jellyfinProfile(),
    queryFn: () =>
      fetcher<JellyfinProfileLink>(AUTH_ENDPOINTS.JELLYFIN_PROFILE),
    enabled,
  });
}

export function useLinkJellyfin() {
  const fetcher = useFetcher();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: Credentials) =>
      fetcher<{ jellyfin_name: string }>(AUTH_ENDPOINTS.JELLYFIN_PROFILE, {
        method: "POST",
        body: data,
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: queryKeys.auth.jellyfinProfile(),
      }),
  });
}

export function useUnlinkJellyfin() {
  const fetcher = useFetcher();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      fetcher<{ success: boolean }>(AUTH_ENDPOINTS.JELLYFIN_PROFILE, {
        method: "DELETE",
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: queryKeys.auth.jellyfinProfile(),
      }),
  });
}
