import type { DownloadClientIntegrationConfig } from "./config";
import { normalizeDelugeState } from "./stateNormalize";
import {
  type AddTorrentInput,
  type DownloadClientAdapter,
  DownloadClientError,
  type NormalizedTorrent,
} from "./types";
import { fetchWithTimeout } from "@rawkoon/api/utils/fetchWithTimeout";

const num = (value: unknown, fallback = 0): number =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;
const str = (value: unknown, fallback = ""): string =>
  typeof value === "string" ? value : fallback;

const STATUS_FIELDS = [
  "name",
  "progress",
  "state",
  "download_payload_rate",
  "num_seeds",
  "num_peers",
  "save_path",
  "total_wanted",
  "label",
  "ratio",
];

export function delugeRowToNormalized(
  hash: string,
  raw: Record<string, unknown>,
): NormalizedTorrent {
  const dir = str(raw.save_path);
  const name = str(raw.name);
  return {
    hash: hash.toLowerCase(),
    name,
    state: normalizeDelugeState(str(raw.state)),
    progress: num(raw.progress) / 100,
    savePath: dir,
    contentPath: dir && name ? `${dir.replace(/\/+$/, "")}/${name}` : null,
    seeds: num(raw.num_seeds),
    peers: num(raw.num_peers),
    dlSpeed: num(raw.download_payload_rate),
    sizeBytes: num(raw.total_wanted),
    labels: str(raw.label) ? [str(raw.label)] : [],
    ratio: typeof raw.ratio === "number" ? raw.ratio : null,
  };
}

export function createDelugeAdapter(
  config: DownloadClientIntegrationConfig,
): DownloadClientAdapter {
  const jsonUrl = config.website_url.match(/\/json\/?$/)
    ? config.website_url
    : `${config.website_url.replace(/\/+$/, "")}/json`;
  let cookie = "";
  let rpcId = 0;
  let loggedIn = false;

  const rawCall = async <T>(method: string, params: unknown[]): Promise<T> => {
    const response = await fetchWithTimeout(
      jsonUrl,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(cookie ? { Cookie: cookie } : {}),
        },
        body: JSON.stringify({ method, params, id: ++rpcId }),
      },
      15_000,
    );
    const setCookie = response.headers.get("set-cookie");
    if (setCookie) cookie = setCookie.split(";")[0] ?? "";
    if (!response.ok) {
      throw new DownloadClientError(
        `Deluge RPC ${method} failed: HTTP ${response.status}`,
        "deluge",
      );
    }
    const body = (await response.json()) as { result: T; error: unknown };
    if (body.error) {
      throw new DownloadClientError(
        `Deluge RPC ${method}: ${JSON.stringify(body.error)}`,
        "deluge",
      );
    }
    return body.result;
  };

  const ensureLogin = async () => {
    if (loggedIn) return;
    const ok = await rawCall<boolean>("auth.login", [config.password]);
    if (!ok) throw new DownloadClientError("Deluge auth failed", "deluge");
    loggedIn = true;
  };

  const call = async <T>(method: string, params: unknown[]): Promise<T> => {
    await ensureLogin();
    try {
      return await rawCall<T>(method, params);
    } catch {
      loggedIn = false;
      await ensureLogin();
      return rawCall<T>(method, params);
    }
  };

  const setLabelBestEffort = async (hash: string, label: string) => {
    try {
      await call("label.set_torrent", [hash, label]);
    } catch {
      // Deluge's optional Label plugin may be disabled; hash matching remains.
    }
  };

  return {
    type: "deluge",

    async testConnection() {
      try {
        await ensureLogin();
        return { ok: true };
      } catch (error) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : "unreachable",
        };
      }
    },

    async addTorrent(input: AddTorrentInput) {
      const options: Record<string, unknown> = {};
      if (input.savePath) options.download_location = input.savePath;

      let hash: string | null;
      if (input.magnetOrUrl) {
        hash = await call<string>("core.add_torrent_magnet", [
          input.magnetOrUrl,
          options,
        ]);
      } else if (input.fileBuffer) {
        hash = await call<string>("core.add_torrent_file", [
          input.fileName ?? "torrent.torrent",
          Buffer.from(input.fileBuffer).toString("base64"),
          options,
        ]);
      } else {
        throw new DownloadClientError(
          "addTorrent requires a magnet URI or torrent file",
          "deluge",
        );
      }

      if (hash) await setLabelBestEffort(hash, input.tag);
      return { hash: hash?.toLowerCase() ?? null };
    },

    async listTorrents() {
      const result = await call<Record<string, Record<string, unknown>>>(
        "core.get_torrents_status",
        [{}, STATUS_FIELDS],
      );
      return Object.entries(result ?? {}).map(([hash, raw]) =>
        delugeRowToNormalized(hash, raw),
      );
    },

    async getTorrent(hash: string) {
      const result = await call<Record<string, unknown>>(
        "core.get_torrent_status",
        [hash, STATUS_FIELDS],
      );
      return result && Object.keys(result).length
        ? delugeRowToNormalized(hash, result)
        : null;
    },

    async pause(hash: string) {
      await call("core.pause_torrent", [[hash]]);
    },

    async resume(hash: string) {
      await call("core.resume_torrent", [[hash]]);
    },

    async remove(hash: string, deleteData: boolean) {
      await call("core.remove_torrent", [hash, deleteData]);
    },
  };
}
