export interface QbittorrentTorrentRaw {
  hash?: string;
  name?: string;
  /** Top-level file or folder path for the download (qBittorrent API v2) */
  content_path?: string;
  progress?: number;
  dlspeed?: number;
  upspeed?: number;
  eta?: number;
  size?: number;
  state?: string;
  num_seeds?: number;
  num_leechs?: number;
  category?: string;
  tags?: string;
  ratio?: number;
  added_on?: number;
  completed_on?: number;
}

export interface QbittorrentIntegrationConfig {
  website_url: string;
  username: string;
  password: string;
  webhook_secret?: string;
}

export interface QbittorrentDashboardTorrent {
  id: string;
  name: string;
  progress: number;
  download_speed: number;
  upload_speed: number;
  eta_seconds: number | null;
  size_bytes: number;
  state: string;
  seeds: number;
  peers: number;
}

export interface QbittorrentTorrentListItem extends QbittorrentDashboardTorrent {
  category: string | null;
  tags: string[];
  ratio: number | null;
  added_on: string | null;
  completed_on: string | null;
  /** Top-level torrent content path when provided by qBittorrent */
  content_path: string | null;
}

export interface QbittorrentTorrentPropertiesRaw {
  save_path?: string;
  total_size?: number;
  piece_size?: number;
  comment?: string;
  creation_date?: number;
  addition_date?: number;
  completion_date?: number;
  total_downloaded?: number;
  total_uploaded?: number;
  share_ratio?: number;
}

export interface QbittorrentTorrentProperties {
  save_path: string | null;
  total_size_bytes: number | null;
  piece_size_bytes: number | null;
  comment: string | null;
  creation_date: string | null;
  addition_date: string | null;
  completion_date: string | null;
  total_downloaded_bytes: number | null;
  total_uploaded_bytes: number | null;
  share_ratio: number | null;
}
