import { randomUUID } from "crypto";
import type { InteractiveReleaseItem } from "@rawkoon/shared/types";
import { extractProwlarrDownloadTarget } from "@rawkoon/api/utils/medias/prowlarrSearchUtils";

export type TmdbProvider = {
  id: number;
  name: string;
  logo_url: string;
};

export type TmdbWatchProvidersResult = {
  region: string;
  streaming: TmdbProvider[];
  free: TmdbProvider[];
  rent: TmdbProvider[];
  buy: TmdbProvider[];
  link: string | null;
};

export type TmdbSearchItem = {
  id: string;
  tmdb_id: number;
  media_type: "movie" | "tv";
  title: string;
  release_year: number | null;
  poster_url: string | null;
  overview: string | null;
  vote_average: number | null;
  service: "prowlarr" | "library";
  already_exists: boolean;
  can_add: boolean;
  source_id: number | null;
  library_id?: number | null;
};

export type { InteractiveReleaseItem };

/**
 * Detects full-season and complete-series packs.
 *
 * A release is a season pack when it has a season marker (S01, Season 1, …)
 * but NO episode number.  The tricky case is SxxExx — "S01E01" has no
 * separator between the season and episode tokens, so the episode regex must
 * also match the bare SxxExx pattern.
 *
 * Matches: "Show.S01", "Show.Season.2.1080p", "Show.S03-S04",
 *          "Show.Integrale", "Show.Complete.Series", "CSI Miami - Season 02 (Complete)"
 * No match: "Show.S01E03", "Show.1x04", "CSI.Miami.S01E01.1080p"
 */
const SEASON_ONLY_RE =
  /(?:^|[\s._-])(?:S|Season|Saison|Stagione|Series)[\s._-]?\d{1,2}(?![\s._-]?\d)/i;
// Covers SxxExx (no separator), as well as " E01", ".x04", "episode 3"
const EPISODE_RE =
  /S\d{1,2}E\d{1,3}|[\s._-](?:E\d{1,3}|x\d{1,2}(?!\d)|\d+x\d+|episode[\s._-]?\d+)/i;
const COMPLETE_SERIES_RE =
  /(?:^|[\s._(-])(?:int[eé]grale?|complete[.\s_-]*(?:series|pack)?|(?:the[.\s_-])?complete[.\s_-]*series)(?:$|[\s._)-])/i;

export function isSeasonPack(title: string): boolean {
  if (COMPLETE_SERIES_RE.test(title)) return true;
  return SEASON_ONLY_RE.test(title) && !EPISODE_RE.test(title);
}

export function isCompleteSeries(title: string): boolean {
  return COMPLETE_SERIES_RE.test(title);
}

const PROWLARR_RELEASE_TTL_MS = 15 * 60 * 1000;
const prowlarrReleasePayloads = new Map<
  string,
  { expiresAt: number; payload: Record<string, unknown> }
>();

export const toRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

export const toNumberOrNull = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value))
    return Math.trunc(value);
  if (typeof value === "string" && value.trim()) {
    const parsed = parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

export const toStringOrNull = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
};

const toBoolean = (value: unknown): boolean => Boolean(value);

const toUniqueStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  const seen = new Set<string>();

  for (const entry of value) {
    let candidate: string | null;
    if (typeof entry === "string") {
      candidate = toStringOrNull(entry);
    } else {
      const record = toRecord(entry);
      candidate =
        toStringOrNull(record?.name) ||
        toStringOrNull(record?.value) ||
        toStringOrNull(record?.title) ||
        toStringOrNull(record?.label);
    }

    if (!candidate) continue;
    const key = candidate.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(candidate);
  }

  return out;
};

const extractInteractiveLanguages = (
  row: Record<string, unknown>,
): string[] => {
  const languages = toUniqueStringArray(row.languages);
  if (languages.length > 0) return languages;

  const singleLanguage = row.language;
  if (typeof singleLanguage === "string") {
    const value = toStringOrNull(singleLanguage);
    return value ? [value] : [];
  }

  const languageRecord = toRecord(singleLanguage);
  if (!languageRecord) return [];
  const value =
    toStringOrNull(languageRecord.name) ||
    toStringOrNull(languageRecord.value) ||
    toStringOrNull(languageRecord.title) ||
    toStringOrNull(languageRecord.label);
  return value ? [value] : [];
};

const TMDB_IMAGE_BASE_URL = "https://image.tmdb.org/t/p/w342";

const parseReleaseYear = (value: unknown): number | null => {
  if (typeof value !== "string" || value.length < 4) return null;
  const year = parseInt(value.slice(0, 4), 10);
  return Number.isFinite(year) ? year : null;
};

export const mapTmdbSearchItem = (raw: unknown): TmdbSearchItem | null => {
  const row = toRecord(raw);
  if (!row) return null;

  const mediaType = toStringOrNull(row.media_type);
  if (mediaType !== "movie" && mediaType !== "tv") return null;

  const tmdbId = toNumberOrNull(row.id);
  if (!tmdbId) return null;

  const title = toStringOrNull(row.title) || toStringOrNull(row.name);
  if (!title) return null;

  const posterPath = toStringOrNull(row.poster_path);
  const releaseYear =
    parseReleaseYear(row.release_date) ?? parseReleaseYear(row.first_air_date);
  const overview = toStringOrNull(row.overview);
  const voteAverage = toNumberOrNull(row.vote_average);

  return {
    id: `${mediaType}-${tmdbId}`,
    tmdb_id: tmdbId,
    media_type: mediaType,
    title,
    release_year: releaseYear,
    poster_url: posterPath ? `${TMDB_IMAGE_BASE_URL}${posterPath}` : null,
    overview: overview || null,
    vote_average: voteAverage && voteAverage > 0 ? voteAverage : null,
    service: "prowlarr",
    already_exists: false,
    can_add: false,
    source_id: null,
  };
};

export const mapInteractiveRelease = (
  raw: unknown,
): InteractiveReleaseItem | null => {
  const row = toRecord(raw);
  if (!row) return null;

  const guid = toStringOrNull(row.guid);
  const title = toStringOrNull(row.title);
  if (!guid || !title) return null;

  const rejections = Array.isArray(row.rejections) ? row.rejections : [];
  const indexerRecord = toRecord(row.indexer);
  const indexerName =
    toStringOrNull(row.indexer) ||
    toStringOrNull(indexerRecord?.name) ||
    toStringOrNull(indexerRecord?.title);
  const indexerId =
    toNumberOrNull(row.indexerId) ||
    toNumberOrNull(row.indexerID) ||
    toNumberOrNull(indexerRecord?.id);
  const rejectionReason =
    rejections.length > 0
      ? rejections
          .map((r) => {
            const record = toRecord(r);
            return (
              toStringOrNull(record?.reason) ||
              toStringOrNull(record?.type) ||
              null
            );
          })
          .filter((v): v is string => Boolean(v))
          .join(", ")
      : null;

  return {
    guid,
    title,
    indexer: indexerName,
    indexer_id: indexerId,
    languages: extractInteractiveLanguages(row),
    protocol: toStringOrNull(row.protocol),
    size_bytes: toNumberOrNull(row.size),
    age: toNumberOrNull(row.age),
    seeders: toNumberOrNull(row.seeders),
    leechers: toNumberOrNull(row.leechers),
    rejected: toBoolean(row.rejected),
    rejection_reason: rejectionReason,
    info_url: toStringOrNull(row.infoUrl),
    source: "prowlarr",
    download_token: null,
    is_season_pack: isSeasonPack(title),
    is_complete_series: isCompleteSeries(title),
  };
};

const cleanupExpiredProwlarrPayloads = () => {
  const now = Date.now();
  for (const [token, entry] of prowlarrReleasePayloads.entries()) {
    if (entry.expiresAt <= now) {
      prowlarrReleasePayloads.delete(token);
    }
  }
};

const storeProwlarrReleasePayload = (
  payload: Record<string, unknown>,
): string => {
  cleanupExpiredProwlarrPayloads();
  const token = randomUUID();
  prowlarrReleasePayloads.set(token, {
    payload,
    expiresAt: Date.now() + PROWLARR_RELEASE_TTL_MS,
  });
  return token;
};

export const takeProwlarrReleasePayload = (
  token: string,
): Record<string, unknown> | null => {
  cleanupExpiredProwlarrPayloads();
  const entry = prowlarrReleasePayloads.get(token);
  if (!entry) return null;
  prowlarrReleasePayloads.delete(token);
  return entry.payload;
};

export const mapProwlarrInteractiveRelease = (
  raw: unknown,
  prowlarrWebsiteUrl: string,
): InteractiveReleaseItem | null => {
  const base = mapInteractiveRelease(raw);
  const row = toRecord(raw);
  if (!base || !row) return null;

  const downloadToken = storeProwlarrReleasePayload(row);
  const target = extractProwlarrDownloadTarget(row, prowlarrWebsiteUrl);
  return {
    ...base,
    source: "prowlarr",
    download_token: downloadToken,
    download_url: target?.url ?? null,
  };
};
