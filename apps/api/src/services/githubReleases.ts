import { prisma } from "@rawkoon/api/db";
import { loadConfig } from "@rawkoon/api/config";
import { getJsonCache, setJsonCache } from "@rawkoon/api/services/cache";
import { createAndQueueNotification } from "@rawkoon/api/workers/notificationService";
import { getAppVersion } from "@rawkoon/api/services/versionService";
import type {
  GitHubRelease,
  GitHubReleaseAsset,
  GitHubReleaseSyncState,
  GitHubReleasesResponse,
  RefreshGitHubReleasesResponse,
} from "@rawkoon/shared/types";

const RELEASES_CACHE_TTL_SECONDS = 7 * 24 * 60 * 60;
const SYNC_STATE_CACHE_TTL_SECONDS = 365 * 24 * 60 * 60;
const GITHUB_API_VERSION = "2022-11-28";

interface CachedSyncState extends GitHubReleaseSyncState {
  known_release_ids: number[];
}

interface GitHubApiAsset {
  id: number;
  name: string | null;
  size: number | null;
  download_count: number | null;
  browser_download_url: string | null;
}

interface GitHubApiRelease {
  id: number;
  tag_name: string;
  name: string | null;
  body: string | null;
  html_url: string;
  prerelease: boolean;
  draft: boolean;
  published_at: string | null;
  created_at: string | null;
  author: {
    login: string;
    avatar_url: string | null;
  } | null;
  assets: GitHubApiAsset[];
}

function getRepoFullName(): string {
  return loadConfig().GITHUB_RELEASES_REPO;
}

function cacheKey(kind: "releases" | "sync-state", repoFullName: string) {
  return `rawkoon:github-releases:${kind}:v1:${encodeURIComponent(repoFullName)}`;
}

function emptySyncState(repoFullName = getRepoFullName()): CachedSyncState {
  return {
    repo_full_name: repoFullName,
    last_synced_at: null,
    last_error: null,
    initialized_at: null,
    known_release_ids: [],
  };
}

function mapAsset(asset: GitHubApiAsset): GitHubReleaseAsset {
  return {
    id: asset.id,
    name: asset.name ?? "Asset",
    size: asset.size ?? 0,
    download_count: asset.download_count ?? 0,
    browser_download_url: asset.browser_download_url ?? "",
  };
}

function mapRelease(release: GitHubApiRelease): GitHubRelease {
  return {
    id: release.id,
    tag_name: release.tag_name,
    name: release.name,
    body: release.body,
    html_url: release.html_url,
    prerelease: release.prerelease,
    draft: release.draft,
    published_at: release.published_at,
    created_at: release.created_at,
    author: release.author
      ? {
          login: release.author.login,
          avatar_url: release.author.avatar_url,
        }
      : null,
    assets: release.assets.map(mapAsset),
  };
}

function normalizeVersionTag(version: string): string {
  return version.trim().replace(/^v/i, "");
}

async function fetchPublicGitHubReleases(): Promise<GitHubRelease[]> {
  const repoFullName = getRepoFullName();
  const response = await fetch(
    `https://api.github.com/repos/${repoFullName}/releases?per_page=50`,
    {
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": GITHUB_API_VERSION,
        "User-Agent": "Rawkoon",
      },
    },
  );

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `GitHub releases request failed (${response.status}): ${
        text || response.statusText
      }`,
    );
  }

  const payload = (await response.json()) as GitHubApiRelease[];
  return payload.filter((release) => !release.draft).map(mapRelease);
}

async function notifyAdminsForNewReleases(
  releases: GitHubRelease[],
): Promise<void> {
  const currentVersion = normalizeVersionTag(getAppVersion());
  const releasesAheadOfCurrentVersion = releases.filter(
    (release) => normalizeVersionTag(release.tag_name) !== currentVersion,
  );

  if (releasesAheadOfCurrentVersion.length === 0) return;

  const admins = await prisma.user.findMany({
    where: { isAdmin: true },
    select: { id: true },
  });

  if (admins.length === 0) return;

  const title =
    releasesAheadOfCurrentVersion.length === 1
      ? `New Rawkoon release: ${releasesAheadOfCurrentVersion[0].tag_name}`
      : `${releasesAheadOfCurrentVersion.length} new Rawkoon releases`;
  const body =
    releasesAheadOfCurrentVersion.length === 1
      ? releasesAheadOfCurrentVersion[0].name ||
        releasesAheadOfCurrentVersion[0].tag_name
      : releasesAheadOfCurrentVersion
          .map((release) => release.tag_name)
          .join(", ");

  await Promise.all(
    admins.map((admin) =>
      createAndQueueNotification(
        admin.id,
        title,
        body,
        "github-release",
        "/settings?tab=releases",
        {
          current_version: getAppVersion(),
          releases: releasesAheadOfCurrentVersion.map((release) => ({
            id: release.id,
            tag_name: release.tag_name,
            html_url: release.html_url,
          })),
        },
      ),
    ),
  );
}

export async function getCachedGitHubReleases(): Promise<GitHubReleasesResponse> {
  const repoFullName = getRepoFullName();
  const [releases, state] = await Promise.all([
    getJsonCache<GitHubRelease[]>(cacheKey("releases", repoFullName)),
    getJsonCache<CachedSyncState>(cacheKey("sync-state", repoFullName)),
  ]);

  return {
    releases: releases ?? [],
    sync: state ?? emptySyncState(repoFullName),
  };
}

export async function refreshGitHubReleases(options?: {
  notifyAdmins?: boolean;
}): Promise<RefreshGitHubReleasesResponse> {
  const repoFullName = getRepoFullName();
  const previousState =
    (await getJsonCache<CachedSyncState>(
      cacheKey("sync-state", repoFullName),
    )) ?? emptySyncState(repoFullName);

  try {
    const releases = await fetchPublicGitHubReleases();
    const previousIds = new Set(previousState.known_release_ids);
    const isInitialSync = !previousState.initialized_at;
    const newReleases = isInitialSync
      ? []
      : releases.filter((release) => !previousIds.has(release.id));
    const now = new Date().toISOString();
    const nextState: CachedSyncState = {
      repo_full_name: repoFullName,
      last_synced_at: now,
      last_error: null,
      initialized_at: previousState.initialized_at ?? now,
      known_release_ids: releases.map((release) => release.id),
    };

    await Promise.all([
      setJsonCache(
        cacheKey("releases", repoFullName),
        releases,
        RELEASES_CACHE_TTL_SECONDS,
      ),
      setJsonCache(
        cacheKey("sync-state", repoFullName),
        nextState,
        SYNC_STATE_CACHE_TTL_SECONDS,
      ),
    ]);

    if (options?.notifyAdmins !== false) {
      await notifyAdminsForNewReleases(newReleases);
    }

    return {
      releases,
      sync: nextState,
      new_release_count: newReleases.length,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const failedState: CachedSyncState = {
      ...previousState,
      repo_full_name: repoFullName,
      last_error: message,
    };

    await setJsonCache(
      cacheKey("sync-state", repoFullName),
      failedState,
      SYNC_STATE_CACHE_TTL_SECONDS,
    );
    throw error;
  }
}
