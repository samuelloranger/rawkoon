import type { ArtworkKind, ArtworkSyncResult } from "@rawkoon/shared/types";
import {
  getJellyfinConfig,
  jellyfinAuthHeader,
} from "@rawkoon/api/services/jellyfin/jellyfinUsers";

const JELLYFIN_TIMEOUT_MS = 15_000;
const SEARCH_LIMIT = 20;

/** A name-search hit and the TMDB id Jellyfin has for it. */
export interface JellyfinCandidate {
  id: string;
  tmdbId: string | null;
}

/** The TMDB match, else a lone hit with no TMDB id; several unverified hits are ambiguous. */
export function pickJellyfinCandidate(
  candidates: JellyfinCandidate[],
  tmdbId: number,
): JellyfinCandidate | null {
  const verified = candidates.find((c) => c.tmdbId === String(tmdbId));
  if (verified) return verified;
  if (candidates.length === 1 && !candidates[0]?.tmdbId) return candidates[0];
  return null;
}

interface Title {
  tmdbId: number;
  type: string;
  title: string;
  originalTitle: string | null;
  year: number | null;
}

type Request = (path: string, init?: RequestInit) => Promise<Response>;

/** Jellyfin can't filter on a provider id's value, so search by name and check the TMDB id. */
async function findItemId(
  request: Request,
  media: Title,
): Promise<string | null> {
  const names = [media.title, media.originalTitle].filter(
    (name, i, all): name is string => !!name && all.indexOf(name) === i,
  );
  const years = media.year != null ? [media.year, null] : [null];
  const type = media.type === "movie" ? "Movie" : "Series";
  for (const name of names) {
    for (const year of years) {
      const params = new URLSearchParams({
        searchTerm: name,
        IncludeItemTypes: type,
        Recursive: "true",
        Fields: "ProviderIds",
        Limit: String(SEARCH_LIMIT),
      });
      if (year != null) params.set("Years", String(year));
      const res = await request(`/Items?${params}`);
      if (!res.ok) throw new Error(`Jellyfin search returned ${res.status}`);
      const body = (await res.json()) as {
        Items?: { Id?: string; ProviderIds?: Record<string, string> }[];
      };
      const candidates = (body.Items ?? []).flatMap((item) =>
        item.Id
          ? [{ id: item.Id, tmdbId: item.ProviderIds?.Tmdb ?? null }]
          : [],
      );
      const picked = pickJellyfinCandidate(candidates, media.tmdbId);
      if (picked) return picked.id;
    }
  }
  return null;
}

/** Sets the title's poster or backdrop in Jellyfin too; never throws, as Jellyfin is optional. */
export async function pushArtworkToJellyfin(
  media: Title,
  kind: ArtworkKind,
  url: string,
): Promise<ArtworkSyncResult> {
  const config = await getJellyfinConfig();
  if (!config?.website_url || !config.api_key) return "off";
  const base = config.website_url.replace(/\/+$/, "");
  const headers = jellyfinAuthHeader(config.api_key);
  const request: Request = (path, init = {}) =>
    fetch(`${base}${path}`, {
      ...init,
      headers,
      signal: AbortSignal.timeout(JELLYFIN_TIMEOUT_MS),
    });

  try {
    const itemId = await findItemId(request, media);
    if (!itemId) return "not_found";
    const type = kind === "poster" ? "Primary" : "Backdrop";
    const item = encodeURIComponent(itemId);
    const download = await request(
      `/Items/${item}/RemoteImages/Download?${new URLSearchParams({ type, imageUrl: url })}`,
      { method: "POST" },
    );
    if (!download.ok) {
      throw new Error(`Jellyfin image download returned ${download.status}`);
    }
    // Jellyfin appends a downloaded backdrop, and clients show the first one
    if (kind === "backdrop") {
      const read = await request(`/Items/${item}`);
      if (!read.ok)
        throw new Error(`Jellyfin item read returned ${read.status}`);
      const count =
        ((await read.json()) as { BackdropImageTags?: string[] })
          .BackdropImageTags?.length ?? 0;
      if (count > 1) {
        const move = await request(
          `/Items/${item}/Images/Backdrop/${count - 1}/Index?newIndex=0`,
          { method: "POST" },
        );
        if (!move.ok) {
          throw new Error(`Jellyfin backdrop reorder returned ${move.status}`);
        }
      }
    }
    return "synced";
  } catch (error) {
    console.warn("[jellyfinArtwork] Could not push artwork:", error);
    return "failed";
  }
}
