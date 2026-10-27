import type { DownloadClientAdapter } from "./types";

/**
 * Claim a torrent the client already holds, for the grab paths that adopt it
 * instead of failing a duplicate add. Null when there is nothing to adopt by
 * (no hash), the client does not support adoption, or the claim did not apply.
 */
export async function claimExistingTorrent(
  adapter: DownloadClientAdapter,
  opts: { hash: string | null; category: string; logPrefix: string },
): Promise<{ completed: boolean } | null> {
  if (!opts.hash || !adapter.claimExisting) return null;
  return adapter.claimExisting({ ...opts, hash: opts.hash });
}
