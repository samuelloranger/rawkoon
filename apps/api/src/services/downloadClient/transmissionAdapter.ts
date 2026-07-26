import type { DownloadClientIntegrationConfig } from "./config";
import { normalizeTransmissionState } from "./stateNormalize";
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

const TORRENT_FIELDS = [
  "hashString",
  "name",
  "percentDone",
  "status",
  "rateDownload",
  "peersConnected",
  "peersSendingToUs",
  "downloadDir",
  "sizeWhenDone",
  "error",
  "isStalled",
  "labels",
];

export function transmissionRowToNormalized(
  raw: Record<string, unknown>,
): NormalizedTorrent {
  const dir = str(raw.downloadDir);
  const name = str(raw.name);
  return {
    hash: str(raw.hashString).toLowerCase(),
    name,
    state: normalizeTransmissionState(num(raw.status), {
      isStalled: raw.isStalled === true,
      errorNo: num(raw.error),
      percentDone: num(raw.percentDone),
    }),
    progress: num(raw.percentDone),
    savePath: dir,
    contentPath: dir && name ? `${dir.replace(/\/+$/, "")}/${name}` : null,
    seeds: num(raw.peersSendingToUs),
    peers: num(raw.peersConnected),
    dlSpeed: num(raw.rateDownload),
    sizeBytes: num(raw.sizeWhenDone),
    labels: Array.isArray(raw.labels)
      ? raw.labels.filter((label): label is string => typeof label === "string")
      : [],
  };
}

export function createTransmissionAdapter(
  config: DownloadClientIntegrationConfig,
): DownloadClientAdapter {
  const rpcUrl = config.website_url.match(/\/transmission\/rpc\/?$/)
    ? config.website_url
    : `${config.website_url.replace(/\/+$/, "")}/transmission/rpc`;
  let sessionId = "";

  const rpc = async <T = Record<string, unknown>>(
    method: string,
    args: Record<string, unknown> = {},
  ): Promise<T> => {
    const request = () =>
      fetch(rpcUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Transmission-Session-Id": sessionId,
          Authorization: `Basic ${Buffer.from(
            `${config.username}:${config.password}`,
          ).toString("base64")}`,
        },
        body: JSON.stringify({ method, arguments: args }),
      });

    let response = await request();
    if (response.status === 409) {
      sessionId =
        response.headers.get("X-Transmission-Session-Id") ?? "";
      response = await request();
    }
    if (!response.ok) {
      throw new DownloadClientError(
        `Transmission RPC ${method} failed: HTTP ${response.status}`,
        "transmission",
      );
    }
    const body = (await response.json()) as {
      result: string;
      arguments: T;
    };
    if (body.result !== "success") {
      throw new DownloadClientError(
        `Transmission RPC ${method}: ${body.result}`,
        "transmission",
      );
    }
    return body.arguments;
  };

  return {
    type: "transmission",

    async testConnection() {
      try {
        await rpc("session-get");
        return { ok: true };
      } catch (error) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : "unreachable",
        };
      }
    },

    async addTorrent(input: AddTorrentInput) {
      const args: Record<string, unknown> = { labels: [input.tag] };
      if (input.savePath) args["download-dir"] = input.savePath;
      if (input.magnetOrUrl) {
        args.filename = input.magnetOrUrl;
      } else if (input.fileBuffer) {
        args.metainfo = Buffer.from(input.fileBuffer).toString("base64");
      } else {
        throw new DownloadClientError(
          "addTorrent requires a magnet URI or torrent file",
          "transmission",
        );
      }
      const result = await rpc<{
        "torrent-added"?: { hashString?: string };
        "torrent-duplicate"?: { hashString?: string };
      }>("torrent-add", args);
      const hash =
        result["torrent-added"]?.hashString ??
        result["torrent-duplicate"]?.hashString ??
        null;
      return { hash: hash?.toLowerCase() ?? null };
    },

    async listTorrents() {
      const result = await rpc<{ torrents: Record<string, unknown>[] }>(
        "torrent-get",
        { fields: TORRENT_FIELDS },
      );
      return (result.torrents ?? []).map(transmissionRowToNormalized);
    },

    async getTorrent(hash: string) {
      const result = await rpc<{ torrents: Record<string, unknown>[] }>(
        "torrent-get",
        { fields: TORRENT_FIELDS, ids: [hash] },
      );
      const row = result.torrents?.[0];
      return row ? transmissionRowToNormalized(row) : null;
    },

    async pause(hash: string) {
      await rpc("torrent-stop", { ids: [hash] });
    },

    async resume(hash: string) {
      await rpc("torrent-start", { ids: [hash] });
    },

    async remove(hash: string, deleteData: boolean) {
      await rpc("torrent-remove", {
        ids: [hash],
        "delete-local-data": deleteData,
      });
    },
  };
}
