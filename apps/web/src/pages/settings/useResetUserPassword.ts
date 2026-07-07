import { useMutation } from "@tanstack/react-query";
import { useFetcher } from "@/lib/api/context";
import { ADMIN_ENDPOINTS } from "@/lib/endpoints";

export function useResetUserPassword() {
  const fetcher = useFetcher();

  return useMutation({
    mutationFn: ({ userId, password }: { userId: string; password: string }) =>
      fetcher<{ success: boolean; message: string }>(
        ADMIN_ENDPOINTS.RESET_USER_PASSWORD(userId),
        {
          method: "POST",
          body: { password },
        },
      ),
  });
}
