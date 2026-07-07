import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ApiError } from "@/lib/api/client";
import { useFetcher } from "@/lib/api/context";
import { queryKeys } from "@/lib/queryKeys";
import type {
  DownloadListRow,
  DownloadParsed,
} from "@/features/downloadsImport/hooks/useDownloadsImport";
import type { TmdbMediaSearchItem } from "@rawkoon/shared/types";

type AssignDownloadPayload = {
  file_path: string;
  tmdb_id: number;
  kind: "movie" | "tv";
  season?: number;
  episode?: number;
};

export type StagedPick = AssignDownloadPayload & {
  poster_url?: string | null;
  preview_title?: string | null;
  preview_year?: number | null;
};

export type RowPhase = "idle" | "submitting" | "success" | "error";

export type BatchState = {
  phase: "idle" | "running" | "done";
  processed: number;
  total: number;
  successes: number;
  failures: number;
};

const INITIAL_BATCH: BatchState = {
  phase: "idle",
  processed: 0,
  total: 0,
  successes: 0,
  failures: 0,
};

function toAssignPayload(s: StagedPick): AssignDownloadPayload {
  return {
    file_path: s.file_path,
    tmdb_id: s.tmdb_id,
    kind: s.kind,
    ...(s.kind === "tv" ? { season: s.season!, episode: s.episode! } : {}),
  };
}

function pickPreviewFields(item: TmdbMediaSearchItem) {
  return {
    preview_title: item.title,
    preview_year: item.release_year,
    poster_url: item.poster_url,
  };
}

function buildStagedPick(
  row: DownloadListRow,
  item: TmdbMediaSearchItem,
): StagedPick | null {
  const kind: DownloadParsed["kind"] = row.parsed.kind;
  const base: StagedPick = {
    file_path: row.file_path,
    tmdb_id: item.tmdb_id,
    kind,
    ...pickPreviewFields(item),
  };
  if (kind === "tv") {
    if (row.parsed.season == null || row.parsed.episode == null) return null;
    base.season = row.parsed.season;
    base.episode = row.parsed.episode;
  }
  return base;
}

function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError) return err.apiError() ?? err.message;
  return fallback;
}

export function useStagedQueue() {
  const queryClient = useQueryClient();
  const fetcher = useFetcher();
  const { t } = useTranslation("common");
  const fallbackMsg = t("downloadsImport.errors.requestFailed", {
    defaultValue: "Request failed",
  });

  const [stagedByPath, setStagedByPath] = useState<Record<string, StagedPick>>(
    {},
  );
  const [rowPhase, setRowPhase] = useState<Record<string, RowPhase>>({});
  const [rowError, setRowError] = useState<Record<string, string>>({});
  const [batch, setBatch] = useState<BatchState>(INITIAL_BATCH);

  const cancelRunRef = useRef(false);

  const assignMutation = useMutation({
    mutationFn: async (payload: AssignDownloadPayload) =>
      fetcher<{ library_media_id: number; media_file_id: number }>(
        "/api/library/downloads/assign",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      ),
  });

  const stageFromTmdbPick = useCallback(
    (row: DownloadListRow, item: TmdbMediaSearchItem) => {
      const pick = buildStagedPick(row, item);
      if (!pick) return;
      setStagedByPath((m) => ({ ...m, [row.file_path]: pick }));
      setRowError((e) => {
        const c = { ...e };
        delete c[row.file_path];
        return c;
      });
      setRowPhase((ph) => ({ ...ph, [row.file_path]: "idle" }));
    },
    [],
  );

  const unstage = useCallback((path: string) => {
    setStagedByPath((m) => {
      const c = { ...m };
      delete c[path];
      return c;
    });
  }, []);

  const clearStagedAll = useCallback(() => {
    cancelRunRef.current = true;
    setStagedByPath({});
    setRowPhase({});
    setRowError({});
    setBatch(INITIAL_BATCH);
  }, []);

  const dismissDone = useCallback(() => setBatch(INITIAL_BATCH), []);

  const cancelRun = useCallback(() => {
    cancelRunRef.current = true;
  }, []);

  const runSubmit = useCallback(async () => {
    const entries = Object.values(stagedByPath);
    if (entries.length === 0 || batch.phase === "running") return;
    cancelRunRef.current = false;
    setBatch({
      phase: "running",
      processed: 0,
      total: entries.length,
      successes: 0,
      failures: 0,
    });

    let ok = 0;
    let fail = 0;
    let completedCount = 0;

    for (const staged of entries) {
      if (cancelRunRef.current) break;
      const pathKey = staged.file_path;
      setRowPhase((m) => ({ ...m, [pathKey]: "submitting" }));
      setRowError((e) => {
        const c = { ...e };
        delete c[pathKey];
        return c;
      });
      try {
        await assignMutation.mutateAsync(toAssignPayload(staged));
        ok++;
        setRowPhase((m) => ({ ...m, [pathKey]: "success" }));
        setStagedByPath((m) => {
          const c = { ...m };
          delete c[pathKey];
          return c;
        });
      } catch (err) {
        fail++;
        setRowPhase((m) => ({ ...m, [pathKey]: "error" }));
        setRowError((er) => ({
          ...er,
          [pathKey]: errorMessage(err, fallbackMsg),
        }));
      } finally {
        completedCount++;
        setBatch((b) => ({
          ...b,
          processed: completedCount,
          total: entries.length,
        }));
      }
    }

    setBatch({
      phase: "done",
      processed: completedCount,
      total: entries.length,
      successes: ok,
      failures: fail,
    });

    await queryClient.invalidateQueries({
      queryKey: queryKeys.library.downloadsImport(),
    });
  }, [assignMutation, batch.phase, fallbackMsg, queryClient, stagedByPath]);

  const retryRow = useCallback(
    async (path: string) => {
      const staged = stagedByPath[path];
      if (!staged) return;
      setRowPhase((m) => ({ ...m, [path]: "submitting" }));
      try {
        await assignMutation.mutateAsync(toAssignPayload(staged));
        setRowPhase((m) => ({ ...m, [path]: "success" }));
        setStagedByPath((m) => {
          const c = { ...m };
          delete c[path];
          return c;
        });
        setRowError((e) => {
          const c = { ...e };
          delete c[path];
          return c;
        });
        await queryClient.invalidateQueries({
          queryKey: queryKeys.library.downloadsImport(),
        });
      } catch (err) {
        setRowPhase((m) => ({ ...m, [path]: "error" }));
        setRowError((er) => ({
          ...er,
          [path]: errorMessage(err, fallbackMsg),
        }));
      }
    },
    [assignMutation, fallbackMsg, queryClient, stagedByPath],
  );

  return {
    stagedByPath,
    rowPhase,
    rowError,
    batch,
    isMutating: assignMutation.isPending,
    stageFromTmdbPick,
    unstage,
    clearStagedAll,
    dismissDone,
    cancelRun,
    runSubmit,
    retryRow,
  };
}
