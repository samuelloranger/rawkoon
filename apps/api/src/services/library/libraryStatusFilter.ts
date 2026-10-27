import { Prisma } from "@prisma/client";

import {
  AIRING_STATE_TMDB_STATUSES,
  AIRING_TMDB_STATUSES,
} from "@rawkoon/api/utils/medias/libraryAiring";
import type { AiringState } from "@rawkoon/shared/types";

/** Rows that are not an airing show; a null TMDB status counts as not airing. */
export const notAiringWhere: Prisma.LibraryMediaWhereInput = {
  OR: [
    { type: { not: "show" } },
    { tmdbStatus: null },
    { tmdbStatus: { notIn: [...AIRING_TMDB_STATUSES] } },
  ],
};

/** Downloaded titles that are not airing shows. */
export const downloadedNotAiringWhere: Prisma.LibraryMediaWhereInput = {
  AND: [{ status: "downloaded" }, notAiringWhere],
};

/** Shows whose TMDB status maps to `state`. */
export function airingStateWhere(
  state: AiringState,
): Prisma.LibraryMediaWhereInput {
  return {
    type: "show",
    tmdbStatus: { in: [...AIRING_STATE_TMDB_STATUSES[state]] },
  };
}

/** `alias` is a trusted column prefix such as `m.` or an empty string. */
function column(alias: string, name: string): Prisma.Sql {
  return Prisma.raw(`${alias}"${name}"`);
}

/** SQL twin of `notAiringWhere`. */
export function notAiringSql(alias = ""): Prisma.Sql {
  return Prisma.sql`(${column(alias, "type")} <> 'show' OR ${column(alias, "tmdb_status")} IS NULL OR ${column(alias, "tmdb_status")} NOT IN (${Prisma.join([...AIRING_TMDB_STATUSES])}))`;
}

/** SQL twin of `airingStateWhere`. */
export function airingStateSql(alias: string, state: AiringState): Prisma.Sql {
  return Prisma.sql`(${column(alias, "type")} = 'show' AND ${column(alias, "tmdb_status")} IN (${Prisma.join([...AIRING_STATE_TMDB_STATUSES[state]])}))`;
}
