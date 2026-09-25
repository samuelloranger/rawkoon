import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type {
  TranscodeCapabilities,
  TranscodeEstimate,
  TranscodeJobSettings,
  TranscodeJobsResponse,
  TranscodeQueueSettings,
  TranscodeSelection,
  TranscodeSummary,
} from "@rawkoon/shared/types";
import { useFetcher } from "@/lib/api/context";
import { TRANSCODE_ENDPOINTS } from "@/lib/endpoints";
import { queryKeys } from "@/lib/queryKeys";
import { settingsKey } from "@/features/transcode/format";

export function useTranscodeCapabilities(enabled = true) {
  const fetcher = useFetcher();
  return useQuery({
    queryKey: queryKeys.transcode.capabilities(),
    queryFn: () =>
      fetcher<TranscodeCapabilities>(TRANSCODE_ENDPOINTS.CAPABILITIES),
    enabled,
    staleTime: 5 * 60_000,
  });
}

export function useTranscodeEstimate(
  selection: TranscodeSelection,
  settings: TranscodeJobSettings,
  enabled: boolean,
) {
  const fetcher = useFetcher();
  return useQuery({
    queryKey: queryKeys.transcode.estimate(selection, settingsKey(settings)),
    queryFn: () =>
      fetcher<TranscodeEstimate>(TRANSCODE_ENDPOINTS.ESTIMATE, {
        method: "POST",
        body: { selection, settings, refine: false },
      }),
    enabled,
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  });
}

export function useRefineTranscodeEstimate() {
  const fetcher = useFetcher();
  return useMutation({
    mutationFn: (b: {
      selection: TranscodeSelection;
      settings: TranscodeJobSettings;
    }) =>
      fetcher<TranscodeEstimate>(TRANSCODE_ENDPOINTS.ESTIMATE, {
        method: "POST",
        body: { ...b, refine: true },
      }),
  });
}

export function useEnqueueTranscode() {
  const fetcher = useFetcher();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (b: {
      selection: TranscodeSelection;
      settings: TranscodeJobSettings;
    }) =>
      fetcher<{ batch_id: string; count: number }>(TRANSCODE_ENDPOINTS.JOBS, {
        method: "POST",
        body: b,
      }),
    onSettled: () =>
      qc.invalidateQueries({ queryKey: queryKeys.transcode.all }),
  });
}

export function useTranscodeJobs(status: "active" | "history") {
  const fetcher = useFetcher();
  const qs =
    status === "active"
      ? "queued,running"
      : `done,failed,cancelled&since=${new Date(Date.now() - 30 * 86_400_000).toISOString()}`;
  return useQuery({
    queryKey: queryKeys.transcode.jobs(status),
    queryFn: () =>
      fetcher<TranscodeJobsResponse>(
        `${TRANSCODE_ENDPOINTS.JOBS}?status=${qs}`,
      ),
    refetchInterval: (q) =>
      status === "active" &&
      q.state.data?.jobs.some((j) => j.status === "running")
        ? 2000
        : 10_000,
  });
}

export function useTranscodeSummary(enabled: boolean) {
  const fetcher = useFetcher();
  return useQuery({
    queryKey: queryKeys.transcode.summary(),
    queryFn: () => fetcher<TranscodeSummary>(TRANSCODE_ENDPOINTS.SUMMARY),
    enabled,
    refetchInterval: 5000,
  });
}

export function useTranscodeSettings() {
  const fetcher = useFetcher();
  return useQuery({
    queryKey: queryKeys.transcode.settings(),
    queryFn: () =>
      fetcher<TranscodeQueueSettings>(TRANSCODE_ENDPOINTS.SETTINGS),
  });
}

export function useUpdateTranscodeSettings() {
  const fetcher = useFetcher();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<TranscodeQueueSettings>) =>
      fetcher<TranscodeQueueSettings>(TRANSCODE_ENDPOINTS.SETTINGS, {
        method: "PATCH",
        body: patch,
      }),
    onSuccess: (data) => qc.setQueryData(queryKeys.transcode.settings(), data),
    onSettled: () =>
      qc.invalidateQueries({ queryKey: queryKeys.transcode.all }),
  });
}

export function useTranscodeJobAction() {
  const fetcher = useFetcher();
  const qc = useQueryClient();
  const run = useMutation({
    mutationFn: (req: {
      url: string;
      method: "POST" | "DELETE";
      body?: unknown;
    }) => fetcher<unknown>(req.url, { method: req.method, body: req.body }),
    onSettled: () =>
      qc.invalidateQueries({ queryKey: queryKeys.transcode.all }),
  });
  return {
    isPending: run.isPending,
    cancel: (id: number) =>
      run.mutateAsync({ url: TRANSCODE_ENDPOINTS.JOB(id), method: "DELETE" }),
    retry: (id: number) =>
      run.mutateAsync({
        url: TRANSCODE_ENDPOINTS.JOB_RETRY(id),
        method: "POST",
        body: {},
      }),
    moveTop: (id: number) =>
      run.mutateAsync({
        url: TRANSCODE_ENDPOINTS.JOB_MOVE(id),
        method: "POST",
        body: { top: true },
      }),
    moveBefore: (id: number, beforeId: number) =>
      run.mutateAsync({
        url: TRANSCODE_ENDPOINTS.JOB_MOVE(id),
        method: "POST",
        body: { before_id: beforeId },
      }),
    moveAfter: (id: number, afterId: number) =>
      run.mutateAsync({
        url: TRANSCODE_ENDPOINTS.JOB_MOVE(id),
        method: "POST",
        body: { after_id: afterId },
      }),
    removeBatch: (batchId: string) =>
      run.mutateAsync({
        url: TRANSCODE_ENDPOINTS.BATCH(batchId),
        method: "DELETE",
      }),
    batchTop: (batchId: string) =>
      run.mutateAsync({
        url: TRANSCODE_ENDPOINTS.BATCH_MOVE(batchId),
        method: "POST",
        body: { top: true },
      }),
    clearHistory: () =>
      run.mutateAsync({ url: TRANSCODE_ENDPOINTS.HISTORY, method: "DELETE" }),
  };
}
