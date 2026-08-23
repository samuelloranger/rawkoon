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

interface QuickSearchBook {
  id: number;
  title: string;
  authors: string[];
  year: number | null;
}

interface QuickSearchUser {
  id: number;
  name: string;
  email: string;
}

export interface QuickSearchResponse {
  torrents: QuickSearchTorrent[];
  medias: QuickSearchMedia[];
  books: QuickSearchBook[];
  users: QuickSearchUser[];
}
