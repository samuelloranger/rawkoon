import type { ArtworkKind, ArtworkSyncResult } from "@rawkoon/shared/types";
import {
  getJellyfinConfig,
  jellyfinAuthHeader,
} from "@rawkoon/api/services/jellyfin/jellyfinUsers";

// Short: the picker waits on this after the override is already saved
const JELLYFIN_TIMEOUT_MS = 5_000;
const SEARCH_LIMIT = 20;

/** A name-search hit, with the TMDB id, name and year Jellyfin has for it. */
export interface JellyfinCandidate {
  id: string;
  tmdbId: string | null;
  name: string;
  year: number | null;
}

/**
 * The TMDB match, else a lone hit with no TMDB id whose name (and year, when
 * known) is exactly the title's; the search is fuzzy, so anything else is a guess.
 */
export function pickJellyfinCandidate(
  candidates: JellyfinCandidate[],
  media: { tmdbId: number; names: string[]; year: number | null },
): JellyfinCandidate | null {
  const verified = candidates.find((c) => c.tmdbId === String(media.tmdbId));
  if (verified) return verified;
  const lone = candidates.length === 1 ? candidates[0] : undefined;
  if (!lone || lone.tmdbId) return null;
  const sameName = media.names.some(
    (name) =>
      name.localeCompare(lone.name, undefined, { sensitivity: "accent" }) === 0,
  );
  const sameYear = media.year == null || lone.year === media.year;
  return sameName && sameYear ? lone : null;
}

export interface Title {
  tmdbId: number;
  type: string;
  title: string;
  originalTitle: string | null;
  year: number | null;
}

export type Request = (path: string, init?: RequestInit) => Promise<Response>;

async function searchItems(
  request: Request,
  params: URLSearchParams,
): Promise<JellyfinCandidate[]> {
  const res = await request(`/Items?${params}`);
  if (!res.ok) throw new Error(`Jellyfin search returned ${res.status}`);
  const body = (await res.json()) as {
    Items?: {
      Id?: string;
      Name?: string;
      ProductionYear?: number;
      ProviderIds?: Record<string, string>;
    }[];
  };
  return (body.Items ?? []).flatMap((item) =>
    item.Id
      ? [
          {
            id: item.Id,
            tmdbId: item.ProviderIds?.Tmdb ?? null,
            name: item.Name ?? "",
            year: item.ProductionYear ?? null,
          },
        ]
      : [],
  );
}

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
      const picked = pickJellyfinCandidate(await searchItems(request, params), {
        tmdbId: media.tmdbId,
        names,
        year: media.year,
      });
      if (picked) return picked.id;
    }
  }
  // Jellyfin may name the item differently (another language or edition), so
  // scan the titles released around that year and trust only the TMDB id
  if (media.year == null) return null;
  const nearby = await searchItems(
    request,
    new URLSearchParams({
      IncludeItemTypes: type,
      Recursive: "true",
      Fields: "ProviderIds",
      HasTmdbId: "true",
      Years: [media.year - 1, media.year, media.year + 1].join(","),
    }),
  );
  return nearby.find((c) => c.tmdbId === String(media.tmdbId))?.id ?? null;
}

async function backdropCount(request: Request, item: string): Promise<number> {
  const read = await request(`/Items/${item}`);
  if (!read.ok) throw new Error(`Jellyfin item read returned ${read.status}`);
  const body = (await read.json()) as { BackdropImageTags?: string[] };
  return body.BackdropImageTags?.length ?? 0;
}

/** Runs `change` on the title's Jellyfin item; never throws, as Jellyfin is optional. */
export async function withJellyfinItem(
  media: Title,
  label: string,
  change: (request: Request, item: string) => Promise<void>,
): Promise<ArtworkSyncResult> {
  const config = await getJellyfinConfig();
  if (!config?.website_url || !config.api_key) return "off";
  const base = config.website_url.replace(/\/+$/, "");
  const auth = jellyfinAuthHeader(config.api_key);
  const request: Request = (path, init = {}) =>
    fetch(`${base}${path}`, {
      ...init,
      headers: { ...auth, ...(init.headers as Record<string, string>) },
      signal: AbortSignal.timeout(JELLYFIN_TIMEOUT_MS),
    });

  try {
    const itemId = await findItemId(request, media);
    if (!itemId) return "not_found";
    await change(request, encodeURIComponent(itemId));
    return "synced";
  } catch (error) {
    console.warn(`[jellyfin] Could not push ${label}:`, error);
    return "failed";
  }
}

/** Sets the title's poster or backdrop in Jellyfin too. */
export function pushArtworkToJellyfin(
  media: Title,
  kind: ArtworkKind,
  url: string,
): Promise<ArtworkSyncResult> {
  return withJellyfinItem(media, "artwork", async (request, item) => {
    const type = kind === "poster" ? "Primary" : "Backdrop";
    const backdropsBefore =
      kind === "backdrop" ? await backdropCount(request, item) : 0;
    const download = await request(
      `/Items/${item}/RemoteImages/Download?${new URLSearchParams({ type, imageUrl: url })}`,
      { method: "POST" },
    );
    if (!download.ok) {
      throw new Error(`Jellyfin image download returned ${download.status}`);
    }
    // Jellyfin appends a new backdrop, and clients show the first one; no new one, nothing to move
    if (kind === "backdrop") {
      const count = await backdropCount(request, item);
      if (count > backdropsBefore && count > 1) {
        const move = await request(
          `/Items/${item}/Images/Backdrop/${count - 1}/Index?newIndex=0`,
          { method: "POST" },
        );
        if (!move.ok) {
          throw new Error(`Jellyfin backdrop reorder returned ${move.status}`);
        }
      }
    }
  });
}
