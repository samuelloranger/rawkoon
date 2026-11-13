import type { ArtworkSyncResult } from "@rawkoon/shared/types";
import {
  type Title,
  withJellyfinItem,
} from "@rawkoon/api/services/jellyfin/jellyfinArtwork";

/** Override fields that reach Jellyfin; null means the override was cleared. */
export interface TitleTextChanges {
  title?: string | null;
  sort_title?: string | null;
  overview?: string | null;
}

/** Override field → the Jellyfin field it sets and the lock that keeps a metadata refresh from undoing it. */
const LOCKED = [
  ["title", "Name"],
  ["overview", "Overview"],
] as const;

export function hasTextChanges(changes: TitleTextChanges): boolean {
  return "title" in changes || "sort_title" in changes || "overview" in changes;
}

/**
 * Applies the title's name, sort name and overview overrides to its Jellyfin
 * item. A set value is written and locked; a cleared one is unlocked and the
 * item's metadata refreshed, so Jellyfin's own value comes back.
 */
export function pushMetadataToJellyfin(
  media: Title,
  changes: TitleTextChanges,
): Promise<ArtworkSyncResult> {
  return withJellyfinItem(media, "metadata", async (request, item) => {
    const read = await request(`/Items/${item}`);
    if (!read.ok) throw new Error(`Jellyfin item read returned ${read.status}`);
    // Jellyfin's update takes the whole item, so the change rides on what it just sent
    const dto = (await read.json()) as Record<string, unknown> & {
      LockedFields?: string[];
    };
    const locked = new Set(dto.LockedFields ?? []);
    let refresh = false;
    for (const [field, jellyfinField] of LOCKED) {
      if (!(field in changes)) continue;
      const value = changes[field];
      if (value) {
        dto[jellyfinField] = value;
        locked.add(jellyfinField);
      } else {
        locked.delete(jellyfinField);
        refresh = true;
      }
    }
    // Jellyfin keeps a forced sort name through refreshes, so it needs no lock
    if ("sort_title" in changes)
      dto.ForcedSortName = changes.sort_title || null;
    dto.LockedFields = [...locked];
    const save = await request(`/Items/${item}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(dto),
    });
    if (!save.ok)
      throw new Error(`Jellyfin item update returned ${save.status}`);
    if (!refresh) return;
    const params = new URLSearchParams({
      metadataRefreshMode: "FullRefresh",
      imageRefreshMode: "None",
      replaceAllMetadata: "true",
      replaceAllImages: "false",
    });
    const refreshed = await request(`/Items/${item}/Refresh?${params}`, {
      method: "POST",
    });
    if (!refreshed.ok) {
      throw new Error(`Jellyfin refresh returned ${refreshed.status}`);
    }
  });
}
