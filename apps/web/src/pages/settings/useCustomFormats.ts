import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useFetcher } from "@/lib/api/context";
import { queryKeys } from "@/lib/queryKeys";
import { CUSTOM_FORMATS_ENDPOINTS } from "@/lib/endpoints";
import type {
  CustomFormat,
  CustomFormatCondition,
  CustomFormatsListResponse,
} from "@rawkoon/shared/types";

export type CustomFormatFormPayload = {
  name: string;
  conditions: CustomFormatCondition[];
};

export function useCustomFormatsList(options?: {
  staleTime?: number;
  gcTime?: number;
}) {
  const fetcher = useFetcher();
  return useQuery({
    queryKey: queryKeys.customFormats.list(),
    queryFn: () =>
      fetcher<CustomFormatsListResponse>(CUSTOM_FORMATS_ENDPOINTS.LIST),
    ...options,
  });
}

export function useCreateCustomFormat() {
  const fetcher = useFetcher();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CustomFormatFormPayload) =>
      fetcher<CustomFormat>(CUSTOM_FORMATS_ENDPOINTS.CREATE, {
        method: "POST",
        body,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.customFormats.all,
      });
    },
  });
}

export function useUpdateCustomFormat() {
  const fetcher = useFetcher();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: number; body: CustomFormatFormPayload }) =>
      fetcher<CustomFormat>(CUSTOM_FORMATS_ENDPOINTS.UPDATE(id), {
        method: "PUT",
        body,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.customFormats.all,
      });
    },
  });
}

export function useDeleteCustomFormat() {
  const fetcher = useFetcher();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) =>
      fetcher<{ success: boolean }>(CUSTOM_FORMATS_ENDPOINTS.DELETE(id), {
        method: "DELETE",
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.customFormats.all,
      });
    },
  });
}
