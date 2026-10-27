import { fetchQbittorrentTorrent } from "@rawkoon/api/services/qbittorrent/torrentQueries";
import {
  setQbittorrentTorrentCategory,
  setQbittorrentTorrentTags,
} from "@rawkoon/api/services/qbittorrent/torrentMutations";
import type { QbittorrentIntegrationConfig } from "@rawkoon/api/services/qbittorrent/clientTypes";
import { normalizeQbState } from "@rawkoon/api/services/downloadClient/stateNormalize";

/**
 * The qBittorrent implementation of DownloadClientAdapter.claimExisting.
 *
 * qBittorrent answers 409 to an add whose infohash it already holds, which
 * happens routinely after a removed or failed earlier attempt. Rather than
 * failing the grab, the existing torrent is claimed: its category is flipped to
 * the one Rawkoon expects and the `rawkoon` tag is added, so the download
 * monitor and post-processor treat it as ours.
 *
 * Returns null when claiming does not apply: no torrent with that hash, or the
 * category could not be set (in which case claiming it would leave a torrent
 * nothing manages).
 */
export async function claimExistingQbTorrent(
  config: QbittorrentIntegrationConfig,
  opts: {
    hash: string;
    category: string;
    /** Prefixes the warning logs, so the caller's domain is identifiable. */
    logPrefix: string;
  },
): Promise<{ completed: boolean } | null> {
  const { hash, category, logPrefix } = opts;

  const info = await fetchQbittorrentTorrent(config, true, hash);
  if (!info.torrent) return null;

  const currentCategory = info.torrent.category ?? "";
  if (currentCategory !== category) {
    const setCat = await setQbittorrentTorrentCategory(config, true, {
      hash,
      category,
    });
    if (!setCat.success) {
      console.warn(
        `${logPrefix} adoption: failed to set category on ${hash}: ${setCat.error ?? "unknown error"}`,
      );
      return null;
    }
  }

  const currentTags = info.torrent.tags ?? [];
  if (!currentTags.includes("rawkoon")) {
    // Non-fatal: tag update failure shouldn't block adoption.
    const tagRes = await setQbittorrentTorrentTags(config, true, {
      hash,
      tags: ["rawkoon"],
      previous_tags: null,
    });
    if (!tagRes.success) {
      console.warn(
        `${logPrefix} adoption: failed to add 'rawkoon' tag to ${hash}: ${tagRes.error ?? "unknown error"}`,
      );
    }
  }

  const completed =
    normalizeQbState(info.torrent.state ?? "") === "completed" &&
    (info.torrent.progress ?? 0) >= 1;

  return { completed };
}
