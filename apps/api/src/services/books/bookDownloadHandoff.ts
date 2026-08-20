import { resolveActiveAdapter } from "@rawkoon/api/services/downloadClient/registry";
import { infoHashFromMagnet } from "@rawkoon/api/utils/medias/prowlarrSearchUtils";
import { MAX_TORRENT_FILE_BYTES } from "@rawkoon/api/constants/libraryGrab";
import {
  fetchHttpWithSafeRedirects,
  isHttpUrlSafeForServerTorrentFetch,
  MagnetRedirectError,
} from "@rawkoon/api/utils/medias/safeTorrentFetchUrl";
import {
  infoHashFromTorrentBuffer,
  prowlarrHeadersForTorrentUrl,
} from "@rawkoon/api/services/mediaGrabberHelpers";

/**
 * Hand a release URL to the active download client.
 *
 * This is the magnet-vs-.torrent dance from mediaGrabberGrab.grabRelease,
 * factored out so the book path does not re-implement it. grabRelease itself is
 * deliberately NOT refactored to call this: it carries delicate duplicate-grab
 * race handling and qBittorrent adoption logic that the movie/TV path depends
 * on in production, and rewiring it to add books would put that at risk for no
 * user-visible gain. Folding the two together is a worthwhile follow-up once
 * the book path has proven itself.
 */

export type HandoffResult =
  | { ok: true; torrentHash: string | null }
  | { ok: false; reason: string };

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
  } else if (!isHttpUrlSafeForServerTorrentFetch(downloadUrl)) {
    return {
      ok: false,
      reason: "Download URL is not allowed for server-side fetch",
    };
  }

  const active = await resolveActiveAdapter();
  if (!active) return { ok: false, reason: "No download client configured" };
  const { adapter } = active;

  const add = async (
    payload:
      | { magnetOrUrl: string }
      | { fileBuffer: Uint8Array; fileName: string },
    fallbackHash: string | null,
  ): Promise<HandoffResult> => {
    try {
      const added = await adapter.addTorrent({
        ...payload,
        category: opts.category,
        tag: opts.tag,
        savePath: active.savePath,
      });
      return { ok: true, torrentHash: added.hash ?? fallbackHash };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Torrent add failed";
      // qBittorrent answers 409 when the torrent is already in the client,
      // which happens routinely after a failed or removed earlier attempt.
      // mediaGrabberGrab adopts the existing torrent in this case
      // (tryAdoptQbDuplicate); the book path does not yet, so at least say what
      // actually happened instead of surfacing a bare status code.
      if (message.includes("409")) {
        return {
          ok: false,
          reason:
            "That release is already in the download client. Remove it there, or use Rescan files once it has finished downloading.",
        };
      }
      return { ok: false, reason: message };
    }
  };

  if (isMagnet) {
    return add({ magnetOrUrl: downloadUrl }, infoHashFromMagnet(downloadUrl));
  }

  // Some indexers redirect a .torrent URL straight to a magnet.
  let buf: ArrayBuffer;
  try {
    const res = await fetchHttpWithSafeRedirects(downloadUrl, {
      headers: { ...(await prowlarrHeadersForTorrentUrl(downloadUrl)) },
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const cl = res.headers.get("content-length");
    if (cl) {
      const n = Number(cl);
      if (Number.isFinite(n) && n > MAX_TORRENT_FILE_BYTES) {
        throw new Error("Torrent file too large");
      }
    }
    buf = await res.arrayBuffer();
    if (buf.byteLength > MAX_TORRENT_FILE_BYTES) {
      throw new Error("Torrent file too large");
    }
  } catch (e) {
    if (e instanceof MagnetRedirectError) {
      return add({ magnetOrUrl: e.magnetUrl }, infoHashFromMagnet(e.magnetUrl));
    }
    return {
      ok: false,
      reason: e instanceof Error ? e.message : "Torrent download failed",
    };
  }

  return add(
    {
      fileBuffer: new Uint8Array(buf),
      fileName: "release.torrent",
    },
    infoHashFromTorrentBuffer(buf),
  );
}
