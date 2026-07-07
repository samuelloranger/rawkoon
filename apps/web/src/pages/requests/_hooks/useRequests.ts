import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useFetcher } from "@/lib/api/context";
import { queryKeys } from "@/lib/queryKeys";
import { REQUEST_ENDPOINTS } from "@/lib/endpoints";
import type {
  CreateMediaRequestBody,
  MediaRequestsResponse,
} from "@rawkoon/shared/types";

export function useRequests() {
  const fetcher = useFetcher();
  return useQuery({
    queryKey: queryKeys.requests.list(),
    queryFn: () => fetcher<MediaRequestsResponse>(REQUEST_ENDPOINTS.LIST),
  });
}

export function useCreateRequest() {
  const fetcher = useFetcher();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateMediaRequestBody) =>
      fetcher<{ id: number }>(REQUEST_ENDPOINTS.CREATE, {
        method: "POST",
        body,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.requests.all }),
  });
}

export function useApproveRequest() {
  const fetcher = useFetcher();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { id: number; quality_profile_id: number }) =>
      fetcher<{ ok: true }>(REQUEST_ENDPOINTS.APPROVE(vars.id), {
        method: "POST",
        body: { quality_profile_id: vars.quality_profile_id },
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.requests.all }),
  });
}

export function useDenyRequest() {
  const fetcher = useFetcher();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { id: number; deny_reason?: string }) =>
      fetcher<{ ok: true }>(REQUEST_ENDPOINTS.DENY(vars.id), {
        method: "POST",
        body: { deny_reason: vars.deny_reason },
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.requests.all }),
  });
}
