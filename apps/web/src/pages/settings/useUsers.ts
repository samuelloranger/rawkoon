import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useFetcher } from "@/lib/api/context";
import { queryKeys } from "@/lib/queryKeys";
import { USERS_ENDPOINTS } from "@/lib/endpoints";
import type {
  ChangePasswordRequest,
  UpdateProfileRequest,
  UserResponse,
} from "@rawkoon/shared/types";

export function useUpdateProfile() {
  const fetcher = useFetcher();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: UpdateProfileRequest) =>
      fetcher<UserResponse>(USERS_ENDPOINTS.ME, {
        method: "PUT",
        body: data,
      }),
    onSuccess: (response) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.auth.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.medias.all });
      queryClient.setQueryData(queryKeys.auth.me, response.user);
    },
  });
}

export function useChangePassword() {
  const fetcher = useFetcher();

  return useMutation({
    mutationFn: (data: ChangePasswordRequest) =>
      fetcher<{ message: string }>(USERS_ENDPOINTS.CHANGE_PASSWORD, {
        method: "POST",
        body: data,
      }),
  });
}

export function useUploadAvatar() {
  const fetcher = useFetcher();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (formData: FormData) =>
      fetcher<{ message: string; avatar_url: string; url?: string }>(
        USERS_ENDPOINTS.AVATAR,
        {
          method: "POST",
          body: formData,
        },
      ),
    onSuccess: (response) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.auth.all });
      queryClient.setQueryData(
        queryKeys.auth.me,
        (old: { avatar_url?: string | null } | null | undefined) => {
          if (!old) return old;
          return {
            ...old,
            avatar_url: response.avatar_url || response.url,
          };
        },
      );
    },
  });
}
