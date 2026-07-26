import { fetchMaindata } from "@rawkoon/api/services/qbittorrent/clientFetch";
import { resetMaindataState } from "@rawkoon/api/services/qbittorrent/clientSession";
import type { QbittorrentIntegrationConfig } from "@rawkoon/api/services/qbittorrent/clientTypes";
import {
  addQbittorrentMagnet,
  addQbittorrentTorrentFile,
} from "@rawkoon/api/services/qbittorrent/torrentAdd";
import {
  deleteQbittorrentTorrent,
  pauseQbittorrentTorrent,
  resumeQbittorrentTorrent,
} from "@rawkoon/api/services/qbittorrent/torrentMutations";
import { normalizeQbState } from "./stateNormalize";
import {
  type AddTorrentInput,
  type DownloadClientAdapter,
  DownloadClientError,
  type NormalizedTorrent,
} from "./types";

const num = (value: unknown, fallback = 0): number =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;
const str = (value: unknown, fallback = ""): string =>
  typeof value === "string" ? value : fallback;

export function qbRawToNormalized(
  hash: string,
  raw: Record<string, unknown>,
): NormalizedTorrent {
  const contentPath = str(raw.content_path);
  return {
    hash,
    name: str(raw.name),
    state: normalizeQbState(str(raw.state)),
    progress: num(raw.progress),
    savePath: str(raw.save_path),
    contentPath: contentPath || null,
    seeds: num(raw.num_seeds),
    peers: num(raw.num_leechs),
    dlSpeed: num(raw.dlspeed),
    sizeBytes: num(raw.size),
    labels: str(raw.tags)
      .split(",")
      .map((label) => label.trim())
      .filter(Boolean),
  };
}

export function createQbittorrentAdapter(
  config: QbittorrentIntegrationConfig,
): DownloadClientAdapter {
  const fail = (message: string): never => {
    throw new DownloadClientError(message, "qbittorrent");
  };

  return {
    type: "qbittorrent",

    async testConnection() {
      try {
        await fetchMaindata(config);
        return { ok: true };
      } catch (error) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : "unreachable",
        };
      }
    },

    async addTorrent(input: AddTorrentInput) {
      const tags = [input.tag];
      if (input.magnetOrUrl?.startsWith("magnet:")) {
        const result = await addQbittorrentMagnet(config, true, {
          magnet: input.magnetOrUrl,
          category: input.category ?? null,
          tags,
          save_path: input.savePath ?? null,
        });
        if (!result.success) fail(result.error ?? "magnet add failed");
      } else if (input.fileBuffer) {
        const file = new File(
          [input.fileBuffer],
          input.fileName ?? "torrent.torrent",
        );
        const result = await addQbittorrentTorrentFile(config, true, {
          torrent: file,
          category: input.category ?? null,
          tags,
          save_path: input.savePath ?? null,
        });
        if (!result.success) fail(result.error ?? "torrent add failed");
      } else {
        fail("addTorrent requires a magnet URI or torrent file");
      }
      return { hash: null };
    },

    async listTorrents() {
      resetMaindataState();
      const { torrents } = await fetchMaindata(config);
      return [...torrents].map(([hash, raw]) =>
        qbRawToNormalized(hash, raw),
      );
    },

    async getTorrent(hash: string) {
      const torrents = await this.listTorrents();
      return (
        torrents.find(
          (torrent) => torrent.hash.toLowerCase() === hash.toLowerCase(),
        ) ?? null
      );
    },

    async pause(hash: string) {
      const result = await pauseQbittorrentTorrent(config, true, { hash });
      if (!result.success) fail(result.error ?? "pause failed");
    },

    async resume(hash: string) {
      const result = await resumeQbittorrentTorrent(config, true, { hash });
      if (!result.success) fail(result.error ?? "resume failed");
    },

    async remove(hash: string, deleteData: boolean) {
      const result = await deleteQbittorrentTorrent(config, true, {
        hash,
        delete_files: deleteData,
      });
      if (!result.success) fail(result.error ?? "delete failed");
    },
  };
}
