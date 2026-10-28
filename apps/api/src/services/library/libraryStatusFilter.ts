import { Prisma } from "@prisma/client";

import { AIRING_STATE_TMDB_STATUSES } from "@rawkoon/api/utils/medias/libraryAiring";
import type { AiringState } from "@rawkoon/shared/types";

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

/** SQL twin of `airingStateWhere`. */
export function airingStateSql(alias: string, state: AiringState): Prisma.Sql {
  return Prisma.sql`(${column(alias, "type")} = 'show' AND ${column(alias, "tmdb_status")} IN (${Prisma.join([...AIRING_STATE_TMDB_STATUSES[state]])}))`;
}
