import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useFetcher } from "@/lib/api/context";
import { queryKeys } from "@/lib/queryKeys";
import { LIBRARY_ENDPOINTS } from "@/lib/endpoints";

export type ReindexLanguagesStatus = {
  job_id: string | null;
  state:
    | "unknown"
    | "active"
    | "waiting"
    | "completed"
    | "failed"
    | "delayed"
    | "paused";
  progress: {
    current: number;
    total: number;
    current_file: string | null;
    updated: number;
    skipped: number;
    errors: number;
  } | null;
  result: { updated: number; skipped: number; errors: number } | null;
  error: string | null;
  started_at: string | null;
  finished_at: string | null;
};

export function useReindexLanguages() {
  const fetcher = useFetcher();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      fetcher<{ job_id: string }>(LIBRARY_ENDPOINTS.REINDEX_LANGUAGES, {
        method: "POST",
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.library.reindexLanguagesStatus(),
      });
    },
  });
}
