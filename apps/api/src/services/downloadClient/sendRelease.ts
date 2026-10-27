import { MAX_TORRENT_FILE_BYTES } from "@rawkoon/api/constants/libraryGrab";
import {
  infoHashFromTorrentBuffer,
  prowlarrHeadersForTorrentUrl,
} from "@rawkoon/api/services/mediaGrabber/mediaGrabberHelpers";
import { infoHashFromMagnet } from "@rawkoon/api/utils/medias/prowlarrSearchUtils";
import {
  fetchHttpWithSafeRedirects,
  MagnetRedirectError,
} from "@rawkoon/api/utils/medias/safeTorrentFetchUrl";
import type { DownloadClientAdapter } from "./types";

export type SendReleaseResult =
  | { ok: true; hash: string | null }
  /** The release could not be fetched, so nothing reached the client. */
  | { ok: false; stage: "fetch"; message: string }
  /**
   * The client refused the add. `error` is the raw throw so callers pick their
   * own wording; `hash` is what is known of the torrent, for adopting it.
   */
  | {
      ok: false;
      stage: "add";
      error: unknown;
      via: "magnet" | "file";
      hash: string | null;
    };

/**
 * Hand an already-validated release URL to the client: a magnet goes straight
 * through, a .torrent URL is fetched first (some indexers redirect it to a
 * magnet). The magnet-vs-file dance shared by the media and book grab paths;
 * what each path does around it (rows, refusals, wording) stays theirs.
 */
export async function sendReleaseToClient(
  adapter: DownloadClientAdapter,
  opts: {
    downloadUrl: string;
    category: string;
    tag: string;
    savePath?: string;
  },
): Promise<SendReleaseResult> {
  const { downloadUrl, category, tag, savePath } = opts;

  const addMagnet = async (magnet: string): Promise<SendReleaseResult> => {
    const fallbackHash = infoHashFromMagnet(magnet);
    try {
      const added = await adapter.addTorrent({
        magnetOrUrl: magnet,
        category,
        tag,
        savePath,
      });
      return { ok: true, hash: added.hash ?? fallbackHash };
    } catch (error) {
      return {
        ok: false,
        stage: "add",
        error,
        via: "magnet",
        hash: fallbackHash,
      };
    }
  };

  if (downloadUrl.startsWith("magnet:")) return addMagnet(downloadUrl);

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
    if (e instanceof MagnetRedirectError) return addMagnet(e.magnetUrl);
    return {
      ok: false,
      stage: "fetch",
      message: e instanceof Error ? e.message : "Torrent download failed",
    };
  }

  const fallbackHash = infoHashFromTorrentBuffer(buf);
  try {
    const added = await adapter.addTorrent({
      fileBuffer: new Uint8Array(buf),
      fileName: "release.torrent",
      category,
      tag,
      savePath,
    });
    return { ok: true, hash: added.hash ?? fallbackHash };
  } catch (error) {
    return { ok: false, stage: "add", error, via: "file", hash: fallbackHash };
  }
}
