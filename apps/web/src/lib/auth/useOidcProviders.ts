import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useFetcher } from "@/lib/api/context";
import { queryKeys } from "@/lib/queryKeys";
import { INTEGRATION_ENDPOINTS } from "@/lib/endpoints";
import type { OidcProvider } from "@rawkoon/shared/types";

export function oidcProviderIconUrl(
  slug: string,
  iconUrl: string | null,
): string {
  return (
    iconUrl ??
    `https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/png/${slug}.png`
  );
}

export function useOidcProviders() {
  const fetcher = useFetcher();
  return useQuery({
    queryKey: queryKeys.auth.oidcProviders(),
    queryFn: () =>
      fetcher<{ providers: OidcProvider[] }>(INTEGRATION_ENDPOINTS.OIDC),
    refetchOnMount: "always",
    staleTime: 0,
  });
}

export function useCreateOidcProvider() {
  const fetcher = useFetcher();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: {
      slug: string;
      name: string;
      discovery_url: string;
      client_id: string;
      client_secret: string;
      enabled?: boolean;
      icon_url?: string | null;
    }) =>
      fetcher<{ provider: OidcProvider }>(INTEGRATION_ENDPOINTS.OIDC, {
        method: "POST",
        body: data,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.auth.oidcProviders(),
      });
    },
  });
}

export function useUpdateOidcProvider() {
  const fetcher = useFetcher();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      ...data
    }: {
      id: string;
      name?: string;
      discovery_url?: string;
      client_id?: string;
      client_secret?: string;
      enabled?: boolean;
      icon_url?: string | null;
    }) =>
      fetcher<{ provider: OidcProvider }>(
        `${INTEGRATION_ENDPOINTS.OIDC}/${id}`,
        { method: "PUT", body: data },
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.auth.oidcProviders(),
      });
    },
  });
}

export function useDeleteOidcProvider() {
  const fetcher = useFetcher();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      fetcher<{ success: boolean }>(`${INTEGRATION_ENDPOINTS.OIDC}/${id}`, {
        method: "DELETE",
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.auth.oidcProviders(),
      });
    },
  });
}
