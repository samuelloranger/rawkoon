import { resolveActiveAdapter } from "@rawkoon/api/services/downloadClient/registry";
import type { DownloadClientAdapter } from "@rawkoon/api/services/downloadClient/types";
import { sendReleaseToClient } from "@rawkoon/api/services/downloadClient/sendRelease";
import { isServerTorrentFetchUrlAllowed } from "@rawkoon/api/utils/medias/safeTorrentFetchUrl";

/**
 * Hand a release URL to the active download client: the book path's checks and
 * wording around the shared sendReleaseToClient.
 */

export type HandoffResult =
  | { ok: true; torrentHash: string | null }
  /**
   * `duplicate` marks the one failure the caller can recover from: the torrent
   * is already in the client, so it can be adopted instead of re-added. The
   * hash comes back with it, because adoption needs it and the add never got
   * far enough to report one.
   */
  | {
      ok: false;
      reason: string;
      duplicate?: boolean;
      torrentHash?: string | null;
      /** Set with `duplicate`: the client that refused the add. */
      adapter?: DownloadClientAdapter;
    };

export async function addReleaseToDownloadClient(opts: {
  downloadUrl: string;
  category: string;
  tag: string;
}): Promise<HandoffResult> {
  const downloadUrl = opts.downloadUrl.trim();
  if (!downloadUrl) return { ok: false, reason: "Missing download URL" };

  const isMagnet = downloadUrl.startsWith("magnet:");
  if (isMagnet) {
    if (downloadUrl.length > 16_384) {
      return { ok: false, reason: "Magnet link too long" };
    }
  } else if (!(await isServerTorrentFetchUrlAllowed(downloadUrl))) {
    return {
      ok: false,
      reason: "Download URL is not allowed for server-side fetch",
    };
  }

  const active = await resolveActiveAdapter();
  if (!active) return { ok: false, reason: "No download client configured" };
  const { adapter } = active;

  const sent = await sendReleaseToClient(adapter, {
    downloadUrl,
    category: opts.category,
    tag: opts.tag,
    savePath: active.savePath,
  });
  if (sent.ok) return { ok: true, torrentHash: sent.hash };
  if (sent.stage === "fetch") return { ok: false, reason: sent.message };

  const message =
    sent.error instanceof Error ? sent.error.message : "Torrent add failed";
  // qBittorrent answers 409 when the torrent is already in the client,
  // which happens routinely after a failed or removed earlier attempt.
  // Reported as recoverable so the caller can adopt the existing torrent;
  // the reason still stands on its own, because adoption can fail (no hash
  // to look it up by, or qBittorrent unreachable).
  if (message.includes("409")) {
    return {
      ok: false,
      duplicate: true,
      torrentHash: sent.hash,
      adapter,
      reason:
        "That release is already in the download client. Remove it there, or use Rescan files once it has finished downloading.",
    };
  }
  return { ok: false, reason: message };
}
