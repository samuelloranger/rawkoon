import type { LibraryStats, LibraryStatsResolution } from "@rawkoon/shared";

const RESOLUTION_ORDER: LibraryStatsResolution[] = [
  "unknown",
  "480p",
  "720p",
  "1080p",
  "4k",
];

export function bucketResolution(
  resolution: number | null,
): LibraryStatsResolution {
  if (!resolution || resolution <= 0) return "unknown";
  if (resolution >= 2160) return "4k";
  if (resolution >= 1080) return "1080p";
  if (resolution >= 720) return "720p";
  return "480p";
}

export function buildLibraryStatsResponse(input: {
  byTypeStatus: { type: string; status: string; count: number }[];
  byTmdbStatus: { tmdb_status: string | null; count: number }[];
  files: { resolution: number | null; size_bytes: bigint }[];
}): LibraryStats {
  let total_movies = 0;
  let total_shows = 0;
  let downloaded = 0;
  let wanted = 0;

  const counts_by_status_type = input.byTypeStatus.map((row) => {
    if (row.type === "movie") total_movies += row.count;
    if (row.type === "show") total_shows += row.count;
    if (row.status === "downloaded") downloaded += row.count;
    if (row.status === "wanted") wanted += row.count;
    return {
      type: row.type as "movie" | "show",
      status: row.status,
      count: row.count,
    };
  });

  let returning_series = 0;
  const shows_by_tmdb_status = input.byTmdbStatus.map((row) => {
    // tmdbStatus stores the raw TMDB value (e.g. "Returning Series"), not a snake_case code.
    if (row.tmdb_status === "Returning Series") {
      returning_series += row.count;
    }
    return {
      tmdb_status: row.tmdb_status ?? "unknown",
      count: row.count,
    };
  });

  let storage_total = 0n;
  const byRes = new Map<LibraryStatsResolution, bigint>();
  for (const b of RESOLUTION_ORDER) byRes.set(b, 0n);

  for (const f of input.files) {
    storage_total += f.size_bytes;
    const bucket = bucketResolution(f.resolution);
    byRes.set(bucket, (byRes.get(bucket) ?? 0n) + f.size_bytes);
  }

  const storage_by_resolution = RESOLUTION_ORDER.map((resolution) => {
    const raw = byRes.get(resolution) ?? 0n;
    const size_bytes =
      raw > BigInt(Number.MAX_SAFE_INTEGER)
        ? Number.MAX_SAFE_INTEGER
        : Number(raw);
    return { resolution, size_bytes };
  }).filter((row) => row.size_bytes > 0);

  const storage_used_bytes =
    storage_total > BigInt(Number.MAX_SAFE_INTEGER)
      ? Number.MAX_SAFE_INTEGER
      : Number(storage_total);

  return {
    total_movies,
    total_shows,
    downloaded,
    wanted,
    returning_series,
    storage_used_bytes,
    counts_by_status_type,
    storage_by_resolution,
    shows_by_tmdb_status,
  };
}
