/** A grab row the user may drop from history: torrent marked failed, or post-processing failed before importing anything. A partly imported pack (has a destination) stays, as the seed sweep still needs it. */
export function isRemovableDownloadHistoryEntry(entry: {
  failed: boolean;
  postProcessError?: string | null;
  post_process_error?: string | null;
  postProcessDestinationPath?: string | null;
  post_process_destination_path?: string | null;
}): boolean {
  const err = entry.postProcessError ?? entry.post_process_error;
  const dest =
    entry.postProcessDestinationPath ?? entry.post_process_destination_path;
  return entry.failed || (err != null && err !== "" && !dest);
}
