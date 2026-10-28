/** The key that ties every notification about one grab to a single row. */
export function downloadLifecycleKey(downloadHistoryId: number): string {
  return `download:${downloadHistoryId}`;
}

/**
 * Whether to write a stage of a notification and whether it reaches devices.
 * A stage the user turned off still rewrites a row an earlier stage created, so
 * that row never stays stuck at an old stage; it just stays quiet.
 */
export function planLifecycleWrite(opts: {
  hasRow: boolean;
  enabled: boolean;
  push: boolean;
}): { action: "write" | "skip"; push: boolean } {
  if (opts.enabled) return { action: "write", push: opts.push };
  return opts.hasRow
    ? { action: "write", push: false }
    : { action: "skip", push: false };
}

/**
 * A later stage replaces the row's fields, but keeps the release the grab
 * named, which the download notice itself doesn't carry.
 */
export function mergeLifecycleMetadata(
  previous: Record<string, unknown>,
  incoming: Record<string, unknown>,
): Record<string, unknown> {
  const release =
    typeof incoming.release === "string"
      ? incoming.release
      : typeof previous.release === "string"
        ? previous.release
        : null;
  return { ...incoming, ...(release ? { release } : {}) };
}
