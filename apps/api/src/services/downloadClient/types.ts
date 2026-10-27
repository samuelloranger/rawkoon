export type DownloadClientType =
  | "qbittorrent"
  | "transmission"
  | "deluge"
  | "rdtclient";

export type NormalizedState =
  | "downloading"
  | "completed"
  | "stalled"
  | "error"
  | "paused";

export interface NormalizedTorrent {
  hash: string;
  name: string;
  state: NormalizedState;
  /** 0..1 */
  progress: number;
  savePath: string;
  /** Absolute path to the downloaded top-level content, or null if unknown */
  contentPath: string | null;
  seeds: number;
  peers: number;
  /** bytes/s */
  dlSpeed: number;
  /** bytes/s */
  upSpeed: number;
  /** Seconds spent seeding since completion; null when the client does not report it. */
  seedingTimeSecs: number | null;
  /** qBittorrent category; null for clients without categories. */
  category: string | null;
  sizeBytes: number;
  labels: string[];
  ratio: number | null;
}

export interface AddTorrentInput {
  /** magnet: URI or http(s) .torrent URL */
  magnetOrUrl?: string;
  /** raw .torrent bytes (mutually exclusive with magnetOrUrl) */
  fileBuffer?: Uint8Array;
  fileName?: string;
  /** label/tag applied to the torrent, e.g. "rawkoon-dh-123" */
  tag: string;
  /** optional category, e.g. "rawkoon-movies" */
  category?: string;
  /** optional download-dir override */
  savePath?: string;
}

export interface DownloadClientAdapter {
  readonly type: DownloadClientType;
  testConnection(): Promise<{ ok: boolean; error?: string }>;
  /** Returns the info-hash if the client reports it on add, else null. */
  addTorrent(
    input: AddTorrentInput,
  ): Promise<{ hash: string | null; duplicate?: boolean }>;
  listTorrents(): Promise<NormalizedTorrent[]>;
  getTorrent(hash: string): Promise<NormalizedTorrent | null>;
  /** Relative file paths, or null while the torrent's metadata is still unknown. */
  listFiles(hash: string): Promise<string[] | null>;
  pause(hash: string): Promise<void>;
  resume(hash: string): Promise<void>;
  remove(hash: string, deleteData: boolean): Promise<void>;
  /**
   * Take over a torrent the client already holds (an add answered "duplicate"):
   * make it ours (category/label) and report whether it has finished. Null when
   * the torrent is absent or could not be claimed. Absent on clients that do
   * not support adoption, so callers treat a missing method as "not adoptable".
   */
  claimExisting?(opts: {
    hash: string;
    category: string;
    /** Prefixes warning logs so the caller's domain is identifiable. */
    logPrefix: string;
  }): Promise<{ completed: boolean } | null>;
}

export class DownloadClientError extends Error {
  constructor(
    message: string,
    readonly clientType: DownloadClientType,
  ) {
    super(message);
    this.name = "DownloadClientError";
  }
}
