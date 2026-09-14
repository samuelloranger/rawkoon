import type { ArtworkCandidate, ArtworkKind } from "@rawkoon/shared/types";
import { getIntegrationConfigRecord } from "@rawkoon/api/services/integrationConfigCache";
import { normalizeFanartConfig } from "@rawkoon/api/utils/integrations/normalizers";

const FANART_BASE = "https://webservice.fanart.tv/v3";
const REQUEST_TIMEOUT_MS = 8000;

/** fanart.tv keys the same artwork differently per media type. */
const KEYS: Record<"movie" | "tv", Record<ArtworkKind, string[]>> = {
  movie: { poster: ["movieposter"], backdrop: ["moviebackground"] },
  tv: { poster: ["tvposter"], backdrop: ["showbackground"] },
};

const toRecord = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;

export function parseFanartImages(
  raw: unknown,
  kind: ArtworkKind,
): ArtworkCandidate[] {
  const root = toRecord(raw);
  if (!root) return [];

  const out: ArtworkCandidate[] = [];
  const keys = [...KEYS.movie[kind], ...KEYS.tv[kind]];
  for (const key of keys) {
    const list = root[key];
    if (!Array.isArray(list)) continue;
    for (const entry of list) {
      const r = toRecord(entry);
      if (!r) continue;
      const url = typeof r.url === "string" ? r.url.trim() : "";
      if (!url) continue;
      const lang = typeof r.lang === "string" ? r.lang.trim() : "";
      const likes = Number.parseInt(String(r.likes ?? ""), 10);
      out.push({
        url,
        thumb_url: url,
        width: null,
        height: null,
        language: lang || null,
        vote: Number.isFinite(likes) ? likes : null,
        source: "fanart",
      });
    }
  }

  out.sort((a, b) => (b.vote ?? 0) - (a.vote ?? 0));
  return out;
}

/**
 * Artwork from fanart.tv. Optional by design: a missing key, a missing TVDB id,
 * or any request failure yields an empty list rather than an error.
 */
export async function fetchFanartArtwork(input: {
  mediaType: "movie" | "tv";
  /** TMDB id for a movie, TVDB id for a show. */
  providerId: number | null;
  kind: ArtworkKind;
}): Promise<ArtworkCandidate[]> {
  if (input.providerId == null) return [];

  const integration = await getIntegrationConfigRecord("fanart");
  if (!integration?.enabled) return [];
  const config = normalizeFanartConfig(integration.config);
  if (!config) return [];

  const path = input.mediaType === "movie" ? "movies" : "tv";
  const url = `${FANART_BASE}/${path}/${input.providerId}?api_key=${encodeURIComponent(config.api_key)}`;

  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) return [];
    return parseFanartImages(await res.json(), input.kind);
  } catch (e) {
    console.warn(
      `[fanartProvider] ${input.mediaType}/${input.providerId} failed:`,
      e,
    );
    return [];
  }
}
