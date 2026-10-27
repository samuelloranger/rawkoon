import { basename, extname } from "node:path";

import { prisma } from "@rawkoon/api/db";
import { TMDB_LANGUAGE_LIBRARY_PERSISTENCE } from "@rawkoon/api/utils/medias/tmdbFetcherTypes";
import {
  sortTitleFromName,
  tmdbApiFetch,
} from "@rawkoon/api/utils/medias/libraryHelpers";
import { parseReleaseStructure } from "@rawkoon/shared/utils/releaseStructure";

const TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p/w342";

export function parseFilenameForScan(nameWithoutExt: string): {
  title: string;
  year: number | null;
} {
  const { title, year } = parseReleaseStructure(nameWithoutExt);
  return { title, year };
}

/** Matches each video file to TMDB and inserts library rows for titles not yet present. */
export async function importScannedVideos(
  videos: string[],
  type: "movie" | "show",
  key: string,
): Promise<{ matched: number; unmatched: string[] }> {
  const unmatched: string[] = [];
  let matched = 0;

  for (const filePath of videos) {
    const base = basename(filePath, extname(filePath));
    const { title, year } = parseFilenameForScan(base);
    if (!title) {
      unmatched.push(base);
      continue;
    }

    try {
      if (type === "movie") {
        const search = await tmdbApiFetch<{
          results: Array<{
            id: number;
            title: string;
            release_date?: string;
          }>;
        }>("search/movie", key, {
          query: title,
          language: TMDB_LANGUAGE_LIBRARY_PERSISTENCE,
          ...(year ? { year: String(year) } : {}),
        });
        const top = search.results[0];
        if (!top) {
          unmatched.push(base);
          continue;
        }
        const exists = await prisma.libraryMedia.findUnique({
          where: { tmdbId_type: { tmdbId: top.id, type: "movie" } },
        });
        if (exists) continue;

        const details = await tmdbApiFetch<{
          title: string;
          release_date: string;
          poster_path: string | null;
          overview: string;
        }>(`movie/${top.id}`, key, {
          language: TMDB_LANGUAGE_LIBRARY_PERSISTENCE,
        });

        const y = details.release_date
          ? parseInt(details.release_date.slice(0, 4), 10)
          : year;
        const posterUrl = details.poster_path
          ? `${TMDB_IMAGE_BASE}${details.poster_path}`
          : null;

        await prisma.libraryMedia.create({
          data: {
            tmdbId: top.id,
            type: "movie",
            title: details.title,
            sortTitle: sortTitleFromName(details.title),
            year: y,
            status: "downloaded",
            posterUrl,
            overview: details.overview || null,
          },
        });
        matched++;
      } else {
        const search = await tmdbApiFetch<{
          results: Array<{
            id: number;
            name: string;
            first_air_date?: string;
          }>;
        }>("search/tv", key, {
          query: title,
          language: TMDB_LANGUAGE_LIBRARY_PERSISTENCE,
        });
        const top = search.results[0];
        if (!top) {
          unmatched.push(base);
          continue;
        }
        const exists = await prisma.libraryMedia.findUnique({
          where: { tmdbId_type: { tmdbId: top.id, type: "show" } },
        });
        if (exists) continue;

        const details = await tmdbApiFetch<{
          name: string;
          first_air_date: string;
          poster_path: string | null;
          overview: string;
          status: string | null;
        }>(`tv/${top.id}`, key, {
          language: TMDB_LANGUAGE_LIBRARY_PERSISTENCE,
        });

        const y = details.first_air_date
          ? parseInt(details.first_air_date.slice(0, 4), 10)
          : year;
        const posterUrl = details.poster_path
          ? `${TMDB_IMAGE_BASE}${details.poster_path}`
          : null;

        await prisma.libraryMedia.create({
          data: {
            tmdbId: top.id,
            type: "show",
            title: details.name,
            sortTitle: sortTitleFromName(details.name),
            year: y,
            status: "downloaded",
            tmdbStatus: details.status ?? null,
            posterUrl,
            overview: details.overview || null,
          },
        });
        await prisma.$executeRaw`
          UPDATE "library_media"
          SET "tmdb_status_refreshed_at" = NOW()
          WHERE "tmdb_id" = ${top.id}
            AND "type" = 'show'
        `;
        matched++;
      }
    } catch {
      unmatched.push(base);
    }
  }

  return { matched, unmatched };
}
