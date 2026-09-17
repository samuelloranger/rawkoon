import type {
  DownloadProgressItem,
  LibraryDownloadsResponse,
} from "@rawkoon/shared/types";

/**
 * Overlay pushed live progress onto a cached downloads response. Rows are keyed
 * by id; a row with no pushed item keeps its current `live`. Returns a new
 * object (never mutates) so React Query sees a fresh reference.
 *
 * The SSE payload is camelCase; the row's `live` shape is snake_case, so the
 * fields are re-mapped here.
 */
export function mergeDownloadProgress(
  current: LibraryDownloadsResponse | undefined,
  progress: DownloadProgressItem[],
): LibraryDownloadsResponse | undefined {
  if (!current) return current;
  if (progress.length === 0) return current;

  const byId = new Map(progress.map((item) => [item.id, item]));
  return {
    items: current.items.map((row) => {
      const live = byId.get(row.id);
      if (!live) return row;
      return {
        ...row,
        live: {
          progress: live.progress,
          download_speed: live.downloadSpeed,
          eta_seconds: live.etaSeconds,
          state: live.state,
        },
      };
    }),
  };
}
