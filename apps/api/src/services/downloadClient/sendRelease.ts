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

/** Stops reading once the body passes `max`, so a missing content-length can't buffer unbounded. */
async function readCapped(res: Response, max: number): Promise<ArrayBuffer> {
  if (!res.body) return new ArrayBuffer(0);
  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel();
      throw new Error("Torrent file too large");
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.byteLength;
  }
  return out.buffer;
}

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
      return { ok: true, hash: added.hash || fallbackHash };
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
    buf = await readCapped(res, MAX_TORRENT_FILE_BYTES);
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
    return { ok: true, hash: added.hash || fallbackHash };
  } catch (error) {
    return { ok: false, stage: "add", error, via: "file", hash: fallbackHash };
  }
}
