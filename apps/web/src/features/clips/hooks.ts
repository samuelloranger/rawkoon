import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  ClipDeleteAllResponse,
  ClipProgress,
  ClipRecutRequest,
  ClipRetryResponse,
  ClipSettings,
  ClipSettingsPatch,
  ClipSummary,
} from "@rawkoon/shared/types";
import { useFetcher } from "@/lib/api/context";
import { CLIPS_ENDPOINTS } from "@/lib/endpoints";
import { queryKeys } from "@/lib/queryKeys";

export function useClipSettings(enabled = true) {
  const fetcher = useFetcher();
  return useQuery({
    queryKey: queryKeys.clips.settings(),
    queryFn: () => fetcher<ClipSettings>(CLIPS_ENDPOINTS.SETTINGS),
    enabled,
  });
}

export function useClipProgress() {
  const fetcher = useFetcher();
  return useQuery({
    queryKey: queryKeys.clips.progress(),
    queryFn: () => fetcher<ClipProgress>(CLIPS_ENDPOINTS.PROGRESS),
    refetchInterval: 3000,
  });
}

export function useUpdateClipSettings() {
  const fetcher = useFetcher();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: ClipSettingsPatch) =>
      fetcher<ClipSettings>(CLIPS_ENDPOINTS.SETTINGS, {
        method: "PUT",
        body: patch,
      }),
    onSettled: () => qc.invalidateQueries({ queryKey: queryKeys.clips.all }),
  });
}

export function useClipActions() {
  const fetcher = useFetcher();
  const qc = useQueryClient();
  const settle = () => qc.invalidateQueries({ queryKey: queryKeys.clips.all });
  const retry = useMutation({
    mutationFn: () =>
      fetcher<ClipRetryResponse>(CLIPS_ENDPOINTS.RETRY, {
        method: "POST",
        body: {},
      }),
    onSettled: settle,
  });
  const deleteAll = useMutation({
    mutationFn: () =>
      fetcher<ClipDeleteAllResponse>(CLIPS_ENDPOINTS.DELETE_ALL, {
        method: "POST",
        body: {},
      }),
    onSettled: settle,
  });
  return { retry, deleteAll };
}

/** The clips of one library title; polls while any is still being cut. */
export function useMediaClips(mediaId: number, enabled: boolean) {
  const fetcher = useFetcher();
  return useQuery({
    queryKey: queryKeys.clips.media(mediaId),
    queryFn: () => fetcher<ClipSummary[]>(CLIPS_ENDPOINTS.MEDIA(mediaId)),
    enabled,
    refetchInterval: (q) =>
      q.state.data?.some((c) => c.status === "queued" || c.status === "running")
        ? 2000
        : false,
  });
}

export function useRecutClip() {
  const fetcher = useFetcher();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, start_sec }: { id: number } & ClipRecutRequest) =>
      fetcher<{ queued: boolean }>(CLIPS_ENDPOINTS.RECUT(id), {
        method: "POST",
        body: { start_sec },
      }),
    onSettled: () => qc.invalidateQueries({ queryKey: queryKeys.clips.all }),
  });
}
