import { Prisma } from "@prisma/client";

import {
  AIRING_TMDB_STATUSES,
  parseLibraryStatusInput,
} from "@rawkoon/api/utils/medias/libraryAiring";

/** Rows that are not an airing show; a null TMDB status counts as not airing. */
export const notAiringWhere: Prisma.LibraryMediaWhereInput = {
  OR: [
    { type: { not: "show" } },
    { tmdbStatus: null },
    { tmdbStatus: { notIn: [...AIRING_TMDB_STATUSES] } },
  ],
};

/** Prisma filter for a status as clients name it, composite airing values included. */
export function libraryStatusWhere(
  status: string,
): Prisma.LibraryMediaWhereInput {
  const parsed = parseLibraryStatusInput(status);
  if (parsed.airing === "yes") {
    return {
      status: parsed.status,
      type: "show",
      tmdbStatus: parsed.tmdbStatus,
    };
  }
  if (parsed.airing === "no") {
    return { AND: [{ status: parsed.status }, notAiringWhere] };
  }
  return { status: parsed.status };
}

/** `alias` is a trusted column prefix such as `m.` or an empty string. */
function column(alias: string, name: string): Prisma.Sql {
  return Prisma.raw(`${alias}"${name}"`);
}

/** SQL twin of `notAiringWhere`. */
export function notAiringSql(alias = ""): Prisma.Sql {
  return Prisma.sql`(${column(alias, "type")} <> 'show' OR ${column(alias, "tmdb_status")} IS NULL OR ${column(alias, "tmdb_status")} NOT IN (${Prisma.join([...AIRING_TMDB_STATUSES])}))`;
}

/** SQL twin of `libraryStatusWhere`. */
export function libraryStatusSql(alias: string, status: string): Prisma.Sql {
  const parsed = parseLibraryStatusInput(status);
  const stored = column(alias, "status");
  if (parsed.airing === "yes") {
    return Prisma.sql`(${stored} = ${parsed.status} AND ${column(alias, "type")} = 'show' AND ${column(alias, "tmdb_status")} = ${parsed.tmdbStatus})`;
  }
  if (parsed.airing === "no") {
    return Prisma.sql`(${stored} = ${parsed.status} AND ${notAiringSql(alias)})`;
  }
  return Prisma.sql`${stored} = ${parsed.status}`;
}

/** SQL twin of `presentLibraryStatus`, for ordering by the value clients read. */
export function presentedStatusSql(alias = ""): Prisma.Sql {
  const stored = column(alias, "status");
  return Prisma.sql`(CASE WHEN ${stored} = 'downloaded' AND ${column(alias, "type")} = 'show' THEN CASE ${column(alias, "tmdb_status")} WHEN 'Returning Series' THEN 'returning' WHEN 'In Production' THEN 'in_production' WHEN 'Planned' THEN 'planned' ELSE ${stored} END ELSE ${stored} END)`;
}
