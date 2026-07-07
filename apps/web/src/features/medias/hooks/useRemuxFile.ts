import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useFetcher } from "@/lib/api/context";
import { queryKeys } from "@/lib/queryKeys";
import { LIBRARY_ENDPOINTS } from "@/lib/endpoints";

type JobState =
  | "unknown"
  | "active"
  | "waiting"
  | "completed"
  | "failed"
  | "delayed"
  | "paused";

export type RemuxFileStatus = {
  job_id: string | null;
  state: JobState;
  result: { status: "remuxed" | "skipped" | "error"; message?: string } | null;
  error: string | null;
};

export function useRemuxFile(fileId: number) {
  const fetcher = useFetcher();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      keep_audio_track_indices: number[];
      keep_subtitle_track_indices: number[];
    }) =>
      fetcher<{ job_id: string }>(LIBRARY_ENDPOINTS.FILE_REMUX(fileId), {
        method: "POST",
        body,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.library.remuxFileStatus(fileId),
      });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.library.all });
    },
  });
}
