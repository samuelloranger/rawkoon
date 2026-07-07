import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { useFetcher } from "@/lib/api/context";
import { queryKeys } from "@/lib/queryKeys";

type DownloadsListResponse = {
  items: DownloadListRow[];
  file_operation: "hardlink" | "move";
};

export type DownloadParsed = {
  title: string | null;
  year: number | null;
  season: number | null;
  episode: number | null;
  quality: string | null;
  codec: string | null;
  release_group: string | null;
  hdr: string | null;
  audio: string[];
  subtitles: string[];
  kind: "movie" | "tv";
};

export type DownloadListRow = {
  file_path: string;
  file_name: string;
  size_bytes: number;
  modified_at: string;
  dev: number;
  ino: number;
  is_imported: boolean;
  parsed: DownloadParsed;
};

export function useDownloadsImport() {
  const fetcher = useFetcher();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: queryKeys.library.downloadsImport(),
    queryFn: () =>
      fetcher<DownloadsListResponse>("/api/library/downloads/list"),
  });

  const hardRefresh = useCallback(async () => {
    await fetcher<DownloadsListResponse>(
      "/api/library/downloads/list?refresh=1",
    );
    await queryClient.invalidateQueries({
      queryKey: queryKeys.library.downloadsImport(),
    });
  }, [fetcher, queryClient]);

  return {
    ...query,
    hardRefresh,
  };
}
