import {
  type QueryClient,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { toast } from "sonner";
import i18n from "@/lib/i18n";
import { useFetcher } from "@/lib/api/context";
import { HttpError } from "@/lib/api/httpClient";
import { queryKeys } from "@/lib/queryKeys";
import { REQUEST_ENDPOINTS } from "@/lib/endpoints";
import type {
  ApproveRequestResponse,
  CreateMediaRequestBody,
  MediaRequest,
  MediaRequestsResponse,
  SeasonMode,
} from "@rawkoon/shared/types";

/** A 404 on a listed request means its requester withdrew it meanwhile. */
function onModerationError(qc: QueryClient) {
  return (error: Error) => {
    if (error instanceof HttpError && error.status === 404) {
      toast(i18n.t("requests.withdrawn"));
      void qc.invalidateQueries({ queryKey: queryKeys.requests.all });
      return;
    }
    const api = error instanceof HttpError ? error.apiError() : undefined;
    toast.error(api ?? i18n.t("common.requestFailed"));
  };
}

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
    onSuccess: (_data, body) => {
      void qc.invalidateQueries({ queryKey: queryKeys.requests.all });
      // Book search and discovery carry each volume's request status.
      if (body.type === "book") {
        void qc.invalidateQueries({ queryKey: queryKeys.books.all });
      }
    },
  });
}

export function useApproveRequest() {
  const fetcher = useFetcher();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      ...body
    }: {
      id: number;
      quality_profile_id: number;
      /** Absent = what the requester chose. */
      season_mode?: SeasonMode;
      seasons?: number[];
      monitor_new_seasons?: boolean;
    }) =>
      fetcher<ApproveRequestResponse>(REQUEST_ENDPOINTS.APPROVE(id), {
        method: "POST",
        body,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.requests.all }),
    onError: onModerationError(qc),
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
    onError: onModerationError(qc),
  });
}

export function useDeleteRequest() {
  const fetcher = useFetcher();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (request: MediaRequest) =>
      fetcher<{ ok: true }>(REQUEST_ENDPOINTS.DELETE(request.id), {
        method: "DELETE",
      }),
    onSuccess: (_data, request) => {
      void qc.invalidateQueries({ queryKey: queryKeys.requests.all });
      // Book search and discovery carry each volume's request status.
      if (request.type === "book") {
        void qc.invalidateQueries({ queryKey: queryKeys.books.all });
      }
    },
    onError: onModerationError(qc),
  });
}
