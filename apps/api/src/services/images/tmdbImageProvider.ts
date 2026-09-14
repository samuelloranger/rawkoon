import type { ArtworkCandidate, ArtworkKind } from "@rawkoon/shared/types";
import { tmdbApiFetch } from "@rawkoon/api/utils/medias/libraryHelpers";
import {
  IMG_BACKDROP_STILL,
  IMG_POSTER_STILL,
} from "@rawkoon/api/utils/medias/tmdbFetcherTypes";

const IMG_ORIGINAL = "https://image.tmdb.org/t/p/original";

/** Languages requested from TMDB; `null` is the textless variant. */
const INCLUDE_IMAGE_LANGUAGE = "en,fr,null";

const toRecord = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;

const toNumberOrNull = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

export function parseTmdbImages(
  raw: unknown,
  kind: ArtworkKind,
): ArtworkCandidate[] {
  const root = toRecord(raw);
  if (!root) return [];
  const list = root[kind === "poster" ? "posters" : "backdrops"];
  if (!Array.isArray(list)) return [];

  const thumbBase = kind === "poster" ? IMG_POSTER_STILL : IMG_BACKDROP_STILL;
  const out: ArtworkCandidate[] = [];

  for (const entry of list) {
    const r = toRecord(entry);
    if (!r) continue;
    const path = typeof r.file_path === "string" ? r.file_path.trim() : "";
    if (!path) continue;
    const language = typeof r.iso_639_1 === "string" ? r.iso_639_1 : null;
    out.push({
      url: `${IMG_ORIGINAL}${path}`,
      thumb_url: `${thumbBase}${path}`,
      width: toNumberOrNull(r.width),
      height: toNumberOrNull(r.height),
      language,
      vote: toNumberOrNull(r.vote_average),
      source: "tmdb",
    });
  }

  out.sort((a, b) => (b.vote ?? 0) - (a.vote ?? 0));
  return out;
}

/** Uncapped, language-tagged artwork for the picker — not `media_stills`. */
export async function fetchTmdbArtwork(input: {
  apiKey: string;
  mediaType: "movie" | "tv";
  tmdbId: number;
  kind: ArtworkKind;
}): Promise<ArtworkCandidate[]> {
  try {
    // No `language` param: TMDB intersects it with include_image_language and
    // would drop the textless variants.
    const raw = await tmdbApiFetch<unknown>(
      `${input.mediaType}/${input.tmdbId}/images`,
      input.apiKey,
      { include_image_language: INCLUDE_IMAGE_LANGUAGE },
    );
    return parseTmdbImages(raw, input.kind);
  } catch (e) {
    console.warn(
      `[tmdbImageProvider] images for ${input.mediaType}/${input.tmdbId} failed:`,
      e,
    );
    return [];
  }
}
