import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useFetcher } from "@/lib/api/context";
import { queryKeys } from "@/lib/queryKeys";
import { USERS_ENDPOINTS } from "@/lib/endpoints";
import { useCurrentUser } from "@/lib/auth/useAuth";
import type { NavPosition, User, UserResponse } from "@rawkoon/shared/types";

export function useNavPosition() {
  const queryClient = useQueryClient();
  const fetcher = useFetcher();
  const { data: user } = useCurrentUser();

  const position: NavPosition = (user?.nav_position as NavPosition) ?? "left";

  const mutation = useMutation({
    mutationFn: (next: NavPosition) =>
      fetcher<UserResponse>(USERS_ENDPOINTS.ME, {
        method: "PUT",
        body: { nav_position: next },
      }),
    onMutate: async (next) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.auth.me });
      const previous = queryClient.getQueryData<User | null>(queryKeys.auth.me);
      queryClient.setQueryData<User | null>(queryKeys.auth.me, (prev) =>
        prev ? { ...prev, nav_position: next } : prev,
      );
      return { previous };
    },
    onSuccess: (data) => {
      if (data.user) {
        queryClient.setQueryData<User | null>(queryKeys.auth.me, data.user);
      }
    },
    onError: (_err, _next, context) => {
      if (context?.previous !== undefined) {
        queryClient.setQueryData(queryKeys.auth.me, context.previous);
      }
    },
  });

  return { position, setPosition: mutation.mutate };
}
