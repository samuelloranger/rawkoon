interface QuickSearchTorrent {
  id: string;
  name: string;
  size_bytes: number;
  category: string;
  progress: number;
}

interface QuickSearchMedia {
  id: number;
  title: string;
  type: string; // "movie" | "show"
  year: number | null;
  status: string; // "wanted" | "downloading" | "downloaded" | "skipped"
}

interface QuickSearchUser {
  id: number;
  name: string;
  email: string;
}

export interface QuickSearchResponse {
  torrents: QuickSearchTorrent[];
  medias: QuickSearchMedia[];
  users: QuickSearchUser[];
}
