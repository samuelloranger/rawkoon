export type DownloadClientType = "qbittorrent" | "transmission" | "deluge";

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
  addTorrent(input: AddTorrentInput): Promise<{ hash: string | null }>;
  listTorrents(): Promise<NormalizedTorrent[]>;
  getTorrent(hash: string): Promise<NormalizedTorrent | null>;
  pause(hash: string): Promise<void>;
  resume(hash: string): Promise<void>;
  remove(hash: string, deleteData: boolean): Promise<void>;
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
