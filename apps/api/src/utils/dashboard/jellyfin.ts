import type { JellyfinIntegrationConfig } from "@rawkoon/api/utils/integrations/types";
import type { DashboardJellyfinNowPlayingItem } from "@rawkoon/shared/types";
import {
  toNumberOrNull,
  toRecord,
  toStringOrNull,
} from "@rawkoon/shared/utils";

/**
 * Map raw Jellyfin `/Sessions` entries to now-playing items.
 * Filters out idle sessions (no `NowPlayingItem`). Poster URLs use a
 * `/api/dashboard/jellyfin/image` proxy URL preferring the Primary image,
 * or null when no Primary image tag exists.
 */
export const mapJellyfinSessions = (
  rawSessions: unknown[],
  _config: JellyfinIntegrationConfig,
): DashboardJellyfinNowPlayingItem[] => {
  const items: DashboardJellyfinNowPlayingItem[] = [];

  for (const rawSession of rawSessions) {
    const session = toRecord(rawSession);
    if (!session) continue;

    const nowPlaying = toRecord(session.NowPlayingItem);
    if (!nowPlaying) continue; // idle session

    const sessionId = toStringOrNull(session.Id);
    if (!sessionId) continue;

    const itemType = toStringOrNull(nowPlaying.Type);
    const name = toStringOrNull(nowPlaying.Name);
    const isEpisode = itemType?.toLowerCase() === "episode";

    let title: string;
    if (isEpisode) {
      const seriesName = toStringOrNull(nowPlaying.SeriesName);
      const season = toNumberOrNull(nowPlaying.ParentIndexNumber);
      const episode = toNumberOrNull(nowPlaying.IndexNumber);
      const parts: string[] = [];
      if (seriesName) parts.push(seriesName);
      if (season !== null && episode !== null) {
        parts.push(`S${season}E${episode}`);
      }
      if (name) parts.push(name);
      title = parts.join(" · ") || (name ?? "Unknown");
    } else {
      title = name ?? "Unknown";
    }

    const runTimeTicks = toNumberOrNull(nowPlaying.RunTimeTicks);
    const positionTicks =
      toNumberOrNull(toRecord(session.PlayState)?.PositionTicks) ?? 0;
    const progressPct =
      runTimeTicks && runTimeTicks > 0
        ? Math.min(
            100,
            Math.max(0, Math.round((positionTicks / runTimeTicks) * 100)),
          )
        : 0;

    const paused = toRecord(session.PlayState)?.IsPaused === true;

    const itemId = toStringOrNull(nowPlaying.Id);
    const primaryTag = toStringOrNull(toRecord(nowPlaying.ImageTags)?.Primary);
    const posterUrl =
      itemId && primaryTag
        ? (() => {
            const params = new URLSearchParams({
              itemId,
              preferred: "primary",
              primaryTag,
            });
            return `/api/dashboard/jellyfin/image?${params.toString()}`;
          })()
        : null;

    items.push({
      session_id: sessionId,
      user: toStringOrNull(session.UserName) ?? "",
      device: toStringOrNull(session.DeviceName),
      title,
      poster_url: posterUrl,
      progress_pct: progressPct,
      paused,
    });
  }

  return items;
};

/**
 * Cap the dimensions/quality of a Jellyfin image URL before proxying it.
 * Posters (Primary) render small in dashboard widgets; backdrops a bit wider.
 * Without this, Jellyfin serves full-resolution originals (hundreds of KB).
 */
export function appendJellyfinImageSizing(
  url: URL,
  imageType: "Primary" | "Backdrop",
): void {
  if (imageType === "Primary") {
    url.searchParams.set("fillWidth", "320");
    url.searchParams.set("quality", "90");
  } else {
    url.searchParams.set("fillWidth", "640");
    url.searchParams.set("quality", "80");
  }
}
