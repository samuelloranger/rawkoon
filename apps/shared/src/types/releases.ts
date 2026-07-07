interface GitHubReleaseAuthor {
  login: string;
  avatar_url: string | null;
}

export interface GitHubReleaseAsset {
  id: number;
  name: string;
  size: number;
  download_count: number;
  browser_download_url: string;
}

export interface GitHubRelease {
  id: number;
  tag_name: string;
  name: string | null;
  body: string | null;
  html_url: string;
  prerelease: boolean;
  draft: boolean;
  published_at: string | null;
  created_at: string | null;
  author: GitHubReleaseAuthor | null;
  assets: GitHubReleaseAsset[];
}

export interface GitHubReleaseSyncState {
  repo_full_name: string;
  last_synced_at: string | null;
  last_error: string | null;
  initialized_at: string | null;
}

export interface GitHubReleasesResponse {
  releases: GitHubRelease[];
  sync: GitHubReleaseSyncState;
}

export interface RefreshGitHubReleasesResponse extends GitHubReleasesResponse {
  new_release_count: number;
}
