import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useFetcher } from "@/lib/api/context";
import { HttpError } from "@/lib/api/httpClient";
import { queryKeys } from "@/lib/queryKeys";
import { AUTH_ENDPOINTS } from "@/lib/endpoints";
import { fetchAuthMeUser } from "@/lib/auth/fetchAuthMeUser";
import { resetUserCache } from "@/lib/auth";
import type {
  UserResponse,
  ValidateInvitationResponse,
  AcceptInvitationRequest,
} from "@rawkoon/shared/types";
type AuthResponse = UserResponse;

export function useCurrentUser() {
  const fetcher = useFetcher();

  return useQuery({
    queryKey: queryKeys.auth.me,
    queryFn: () => fetchAuthMeUser(fetcher),
    retry: (failureCount, error: unknown) => {
      // 401 is handled inside fetchAuthMeUser (double fetch); avoid stacking retries
      if (error instanceof HttpError && error.status === 401) return false;
      return failureCount < 1;
    },
    // Identity rarely changes without explicit invalidation (login/logout/passkey/profile mutations).
    staleTime: 30 * 60 * 1000,
    gcTime: Infinity,
    placeholderData: keepPreviousData,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    refetchOnReconnect: false,
  });
}

export function useLogin() {
  const fetcher = useFetcher();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: { email: string; password: string }) =>
      fetcher<{ user: unknown; session: unknown }>(AUTH_ENDPOINTS.LOGIN, {
        method: "POST",
        body: { email: data.email, password: data.password },
      }),
    onSuccess: () => {
      resetUserCache();
      queryClient.invalidateQueries({ queryKey: queryKeys.auth.all });
    },
  });
}

export function useSetupStatus() {
  const fetcher = useFetcher();

  return useQuery({
    queryKey: queryKeys.auth.setupStatus(),
    queryFn: () =>
      fetcher<{ needs_setup: boolean }>(AUTH_ENDPOINTS.SETUP_STATUS),
    staleTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
  });
}

export function useSignUp() {
  const fetcher = useFetcher();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: { email: string; password: string; name: string }) =>
      fetcher<{ user: unknown; token: unknown }>(AUTH_ENDPOINTS.SIGN_UP, {
        method: "POST",
        body: data,
      }),
    onSuccess: () => {
      resetUserCache();
      queryClient.invalidateQueries({ queryKey: queryKeys.auth.all });
    },
  });
}

export function useValidateInvitation(token: string) {
  const fetcher = useFetcher();

  return useQuery({
    queryKey: queryKeys.auth.validateInvitation(token),
    queryFn: () =>
      fetcher<ValidateInvitationResponse>(
        `${AUTH_ENDPOINTS.ACCEPT_INVITATION}?token=${encodeURIComponent(token)}`,
      ),
    enabled: !!token,
    retry: false,
  });
}

export function useAcceptInvitation() {
  const fetcher = useFetcher();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: AcceptInvitationRequest) =>
      fetcher<AuthResponse>(AUTH_ENDPOINTS.ACCEPT_INVITATION, {
        method: "POST",
        body: data,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.auth.all });
      queryClient.clear();
    },
  });
}

export function useLogout() {
  const fetcher = useFetcher();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (_subscriptionEndpoint?: string) =>
      fetcher<{ success: boolean }>(AUTH_ENDPOINTS.LOGOUT, { method: "POST" }),
    onSuccess: () => {
      queryClient.clear();
    },
  });
}

export function useForgotPassword() {
  const fetcher = useFetcher();

  return useMutation({
    mutationFn: (data: { email: string }) =>
      fetcher<{ status: boolean }>(AUTH_ENDPOINTS.FORGOT_PASSWORD, {
        method: "POST",
        body: {
          email: data.email,
          redirectTo: `${window.location.origin}/reset-password`,
        },
      }),
  });
}

export function useResetPassword() {
  const fetcher = useFetcher();

  return useMutation({
    mutationFn: (data: { token: string; password: string }) =>
      fetcher<{ status: boolean }>(AUTH_ENDPOINTS.RESET_PASSWORD, {
        method: "POST",
        body: {
          token: data.token,
          newPassword: data.password,
        },
      }),
  });
}

export function useAuth() {
  const { data: user, isLoading, error, refetch } = useCurrentUser();

  return {
    user: user ?? null,
    isLoading,
    isAuthenticated: user !== null && user !== undefined,
    error,
    refetch: async () => {
      const result = await refetch();
      return result.data;
    },
  };
}
export function useSSOProviders() {
  const fetcher = useFetcher();
  return useQuery({
    queryKey: queryKeys.auth.ssoProviders(),
    queryFn: () =>
      fetcher<{
        providers: { slug: string; name: string; icon_url: string | null }[];
      }>(AUTH_ENDPOINTS.SSO_PROVIDERS),
    staleTime: 60_000,
  });
}
