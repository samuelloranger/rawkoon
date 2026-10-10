import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CalendarSubscription } from "@rawkoon/shared/types";
import { useFetcher } from "@/lib/api/context";
import { CALENDAR_ENDPOINTS } from "@/lib/endpoints";
import { queryKeys } from "@/lib/queryKeys";

export function useCalendarSubscription() {
  const fetcher = useFetcher();

  return useQuery({
    queryKey: queryKeys.calendar.subscription,
    queryFn: () =>
      fetcher<CalendarSubscription>(CALENDAR_ENDPOINTS.SUBSCRIPTION),
    staleTime: Number.POSITIVE_INFINITY,
  });
}

export function useRegenerateCalendarSubscription() {
  const fetcher = useFetcher();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () =>
      fetcher<CalendarSubscription>(CALENDAR_ENDPOINTS.REGENERATE, {
        method: "POST",
      }),
    onSuccess: (subscription) => {
      queryClient.setQueryData(queryKeys.calendar.subscription, subscription);
    },
  });
}
