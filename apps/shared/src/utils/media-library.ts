/** A grab row the user may drop from history: torrent marked failed, or post-processing reported an error after completion. */
export function isRemovableDownloadHistoryEntry(entry: {
  failed: boolean;
  postProcessError?: string | null;
  post_process_error?: string | null;
}): boolean {
  const err = entry.postProcessError ?? entry.post_process_error;
  return entry.failed || (err != null && err !== "");
}
