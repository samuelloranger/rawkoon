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

/** Sets a title's name, sort name and overview in Jellyfin; a cleared one gets Rawkoon's value back, unlocked, with no refresh (it would replace other fields). */
export function pushMetadataToJellyfin(
  media: Title & { overview: string | null },
  changes: TitleTextChanges,
): Promise<ArtworkSyncResult> {
  const fallback = { title: media.title, overview: media.overview ?? "" };
  return withJellyfinItem(media, "metadata", async (request, item) => {
    const read = await request(`/Items/${item}`);
    if (!read.ok) throw new Error(`Jellyfin item read returned ${read.status}`);
    // Jellyfin's update takes the whole item, so the change rides on what it just sent
    const dto = (await read.json()) as Record<string, unknown> & {
      LockedFields?: string[];
    };
    const locked = new Set(dto.LockedFields ?? []);
    for (const [field, jellyfinField] of LOCKED) {
      if (!(field in changes)) continue;
      const value = changes[field]?.trim();
      dto[jellyfinField] = value || fallback[field];
      if (value) locked.add(jellyfinField);
      else locked.delete(jellyfinField);
    }
    // Jellyfin keeps a forced sort name through refreshes, so it needs no lock
    if ("sort_title" in changes) {
      dto.ForcedSortName = changes.sort_title?.trim() || null;
    }
    dto.LockedFields = [...locked];
    const save = await request(`/Items/${item}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(dto),
    });
    if (!save.ok)
      throw new Error(`Jellyfin item update returned ${save.status}`);
  });
}
