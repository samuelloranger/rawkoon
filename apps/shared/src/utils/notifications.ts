const LEGACY_NOTIFICATION_PATHS: Record<string, string> = {
  "/medias": "/library",
};

function hasScheme(url: string): boolean {
  return /^[a-zA-Z][a-zA-Z\d+.-]*:/.test(url);
}

function normalizePathname(pathname: string): string {
  if (LEGACY_NOTIFICATION_PATHS[pathname]) {
    return LEGACY_NOTIFICATION_PATHS[pathname];
  }

  if (
    pathname.endsWith("/") &&
    LEGACY_NOTIFICATION_PATHS[pathname.slice(0, -1)]
  ) {
    return LEGACY_NOTIFICATION_PATHS[pathname.slice(0, -1)];
  }

  return pathname;
}

export function normalizeNotificationUrl(
  url: string | null | undefined,
): string | null {
  if (!url) return null;

  try {
    const raw = url.trim();
    if (!raw) return null;

    const isAbsolute = hasScheme(raw);
    const parsed = new URL(raw, "https://rawkoon.local");
    parsed.pathname = normalizePathname(parsed.pathname);

    if (isAbsolute) {
      return parsed.toString();
    }

    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return url;
  }
}

/** Deep-link into a library item, optionally focusing a TV season/episode. */
export function buildLibraryNotificationUrl(
  mediaId: number,
  opts?: {
    season?: number | null;
    episode?: number | null;
    tab?: "management";
  },
): string {
  return buildNotificationUrl(`/library/${mediaId}`, {
    tab: opts?.tab ?? "management",
    season: opts?.season ?? undefined,
    episode: opts?.episode ?? undefined,
  });
}

export function buildNotificationUrl(
  pathname: string,
  search?: Record<string, string | number | boolean | null | undefined>,
): string {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(search ?? {})) {
    if (value == null || value === "") continue;
    params.set(key, String(value));
  }

  const normalizedPath = normalizePathname(pathname);
  const query = params.toString();
  return query ? `${normalizedPath}?${query}` : normalizedPath;
}
