import { fetchQbittorrentTorrent } from "@rawkoon/api/services/qbittorrent/torrentQueries";
import {
  setQbittorrentTorrentCategory,
  setQbittorrentTorrentTags,
} from "@rawkoon/api/services/qbittorrent/torrentMutations";
import { getQbittorrentIntegrationConfig } from "@rawkoon/api/services/qbittorrent/config";
import { normalizeQbState } from "@rawkoon/api/services/downloadClient/stateNormalize";

/**
 * The qBittorrent half of adopting a torrent that is already in the client.
 *
 * qBittorrent answers 409 to an add whose infohash it already holds, which
 * happens routinely after a removed or failed earlier attempt. Rather than
 * failing the grab, the existing torrent is claimed: its category is flipped to
 * the one Rawkoon expects and the `rawkoon` tag is added, so the download
 * monitor and post-processor treat it as ours.
 *
 * This is deliberately free of any library-domain knowledge — no media, no book
 * edition, no DownloadHistory. Callers own the database half, because the two
 * domains finish a grab differently. Category is passed in for the same reason.
 *
 * Returns null when adoption does not apply: no hash to look up, qBittorrent
 * disabled or unreachable, no torrent with that hash, or the category could not
 * be set (in which case claiming it would leave a torrent nothing manages).
 */
export async function claimExistingQbTorrent(opts: {
  torrentHash: string | null;
  expectedCategory: string;
  /** Prefixes the warning logs, so the caller's domain is identifiable. */
  logPrefix: string;
}): Promise<{ completed: boolean } | null> {
  const { torrentHash, expectedCategory, logPrefix } = opts;
  if (!torrentHash) return null;

  const qb = await getQbittorrentIntegrationConfig();
  if (!qb.enabled || !qb.config) return null;

  const info = await fetchQbittorrentTorrent(
    qb.config,
    qb.enabled,
    torrentHash,
  );
  if (!info.torrent) return null;

  const currentCategory = info.torrent.category ?? "";
  if (currentCategory !== expectedCategory) {
    const setCat = await setQbittorrentTorrentCategory(qb.config, qb.enabled, {
      hash: torrentHash,
      category: expectedCategory,
    });
    if (!setCat.success) {
      console.warn(
        `${logPrefix} adoption: failed to set category on ${torrentHash}: ${setCat.error ?? "unknown error"}`,
      );
      return null;
    }
  }

  const currentTags = info.torrent.tags ?? [];
  if (!currentTags.includes("rawkoon")) {
    // Non-fatal: tag update failure shouldn't block adoption.
    const tagRes = await setQbittorrentTorrentTags(qb.config, qb.enabled, {
      hash: torrentHash,
      tags: ["rawkoon"],
      previous_tags: null,
    });
    if (!tagRes.success) {
      console.warn(
        `${logPrefix} adoption: failed to add 'rawkoon' tag to ${torrentHash}: ${tagRes.error ?? "unknown error"}`,
      );
    }
  }

  const completed =
    normalizeQbState(info.torrent.state ?? "") === "completed" &&
    (info.torrent.progress ?? 0) >= 1;

  return { completed };
}
