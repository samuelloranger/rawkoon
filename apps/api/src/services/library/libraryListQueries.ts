import { Prisma } from "@prisma/client";

import { prisma } from "@rawkoon/api/db";
import {
  libraryStatusSql,
  libraryStatusWhere,
  notAiringSql,
  presentedStatusSql,
} from "@rawkoon/api/services/library/libraryStatusFilter";
import { libraryMediaInclude } from "@rawkoon/api/routes/library/libraryHelpers";
import {
  buildLibraryOrderBy,
  parseLibrarySort,
  slicePage,
} from "@rawkoon/api/routes/library/libraryListQuery";
import {
  buildLocalizedCountQuery,
  buildLocalizedIdQuery,
} from "@rawkoon/api/routes/library/libraryLocalizedListQuery";
import {
  DEFAULT_TITLE_LANGUAGE,
  type TitleLanguage,
} from "@rawkoon/shared/constants";

export type LibraryListParams = {
  type?: string;
  status?: string;
  q?: string;
  language?: string;
  page?: number;
  limit?: number;
  sort_by?: string;
  sort_dir?: string;
  titleLanguage: TitleLanguage;
};

const watchableWhere = Prisma.sql`((status = 'downloaded' AND ${notAiringSql()}) OR status = 'upgrading' OR downloaded_episode_count > 0)`;

async function randomWatchableIds(
  take: number,
  exclude: number[],
): Promise<number[]> {
  const notIn =
    exclude.length > 0
      ? Prisma.sql`AND id NOT IN (${Prisma.join(exclude)})`
      : Prisma.empty;
  const rows = await prisma.$queryRaw<{ id: number }[]>(
    Prisma.sql`SELECT id FROM library_media WHERE ${watchableWhere} ${notIn} ORDER BY random() LIMIT ${take}`,
  );
  return rows.map((r) => r.id);
}

async function hydrateInOrder(ids: number[]) {
  const rows = await prisma.libraryMedia.findMany({
    where: { id: { in: ids } },
    include: libraryMediaInclude,
  });
  const byId = new Map(rows.map((r) => [r.id, r]));
  return ids
    .map((id) => byId.get(id))
    .filter((r): r is (typeof rows)[number] => r !== undefined);
}

/** One page of ids ordered by the status clients read, then id in the same direction. */
async function statusSortedIds(input: {
  type?: string;
  status?: string;
  q?: string;
  fileLanguage?: string;
  sortDir: "asc" | "desc";
  take: number;
  skip: number;
}): Promise<number[]> {
  const conditions: Prisma.Sql[] = [];
  if (input.type) conditions.push(Prisma.sql`m."type" = ${input.type}`);
  if (input.status) conditions.push(libraryStatusSql("m.", input.status));
  if (input.q) conditions.push(Prisma.sql`m."title" ILIKE ${`%${input.q}%`}`);
  if (input.fileLanguage) {
    conditions.push(
      Prisma.sql`EXISTS (SELECT 1 FROM media_files f WHERE f.media_id = m."id" AND ${input.fileLanguage} = ANY(f.language_tags))`,
    );
  }
  const where = conditions.length
    ? Prisma.sql`WHERE ${Prisma.join(conditions, " AND ")}`
    : Prisma.empty;
  const dir = Prisma.raw(input.sortDir === "asc" ? "ASC" : "DESC");
  const rows = await prisma.$queryRaw<{ id: number }[]>(
    Prisma.sql`SELECT m."id" FROM library_media m ${where} ORDER BY ${presentedStatusSql("m.")} ${dir}, m."id" ${dir} LIMIT ${input.take} OFFSET ${input.skip}`,
  );
  return rows.map((r) => r.id);
}

/**
 * Library rows for one list request, plus how the route must map them:
 * `mapTitleLanguage` is passed to the mapper, `resortLanguage` is set when the
 * rows must be re-sorted by the localized title.
 */
export async function queryLibraryList(params: LibraryListParams) {
  const { type, status, q, language, page, limit, sort_by, sort_dir } = params;
  const { titleLanguage } = params;
  const titleFilter = q
    ? { title: { contains: q, mode: "insensitive" as const } }
    : {};
  const sharedWhere: Prisma.LibraryMediaWhereInput = {
    ...(status ? { AND: [libraryStatusWhere(status)] } : {}),
    ...titleFilter,
    ...(language && language.length > 0
      ? { files: { some: { languageTags: { has: language } } } }
      : {}),
  };
  const typedWhere: Prisma.LibraryMediaWhereInput = {
    ...sharedWhere,
    ...(type ? { type } : {}),
  };

  const countsPromise =
    titleLanguage !== DEFAULT_TITLE_LANGUAGE && q
      ? prisma.$queryRaw<{ type: string; _count: number }[]>(
          buildLocalizedCountQuery({
            language: titleLanguage,
            status,
            q,
            fileLanguage: language,
          }),
        )
      : prisma.libraryMedia.groupBy({
          by: ["type"],
          where: sharedWhere,
          _count: true,
        });

  const paged = page !== undefined || limit !== undefined;
  const { sortBy, sortDir } = parseLibrarySort(sort_by, sort_dir);

  let has_more = false;
  let mapTitleLanguage: TitleLanguage | undefined;
  let resortLanguage: TitleLanguage | undefined;
  let rows: Awaited<ReturnType<typeof hydrateInOrder>>;

  if (!paged) {
    // Legacy full-list path (title asc) for non-Library-page callers.
    rows = await prisma.libraryMedia.findMany({
      where: typedWhere,
      orderBy: { title: "asc" },
      include: libraryMediaInclude,
      take: 5000,
    });
    mapTitleLanguage = titleLanguage;
    // This path sorts in SQL on the English title; re-sort on what the
    // caller will actually see.
    if (titleLanguage !== DEFAULT_TITLE_LANGUAGE)
      resortLanguage = titleLanguage;
  } else {
    const take = Math.min(Math.max(1, limit ?? 60), 100);
    const skip = (Math.max(1, page ?? 1) - 1) * take;

    // Every sort pages in the database (skip/take or LIMIT/OFFSET).
    if (titleLanguage === DEFAULT_TITLE_LANGUAGE && sortBy === "status") {
      // Clients read airing shows as returning/in_production/planned, which the stored column alone can't order by.
      const ids = await statusSortedIds({
        type,
        status,
        q,
        fileLanguage: language,
        sortDir,
        take: take + 1,
        skip,
      });
      const sliced = slicePage(ids, take);
      has_more = sliced.has_more;
      rows = await hydrateInOrder(sliced.items);
      mapTitleLanguage = undefined;
    } else if (titleLanguage === DEFAULT_TITLE_LANGUAGE) {
      // English keeps the pure-Prisma path: persisted columns, skip/take.
      const found = await prisma.libraryMedia.findMany({
        where: typedWhere,
        orderBy: buildLibraryOrderBy(sortBy, sortDir),
        include: libraryMediaInclude,
        take: take + 1,
        skip,
      });
      const sliced = slicePage(found, take);
      has_more = sliced.has_more;
      rows = sliced.items;
      mapTitleLanguage = undefined;
    } else {
      // Prisma cannot order by a to-many relation column, so resolve the
      // page's ids in SQL and hydrate them through the normal include.
      const idRows = await prisma.$queryRaw<{ id: number }[]>(
        buildLocalizedIdQuery({
          language: titleLanguage,
          type,
          status,
          q,
          fileLanguage: language,
          sortBy,
          sortDir,
          take: take + 1,
          skip,
        }),
      );
      const sliced = slicePage(idRows, take);
      has_more = sliced.has_more;
      rows = await hydrateInOrder(sliced.items.map((r) => r.id));
      mapTitleLanguage = titleLanguage;
    }
  }

  const counts = await countsPromise;
  return {
    rows,
    has_more,
    mapTitleLanguage,
    resortLanguage,
    movie_count: counts.find((c) => c.type === "movie")?._count ?? 0,
    show_count: counts.find((c) => c.type === "show")?._count ?? 0,
  };
}

/** Random playable titles; `exclude` is tried first, then topped up when too few remain. */
export async function queryRandomLibraryItems(take: number, exclude: number[]) {
  const ids = await randomWatchableIds(take, exclude);
  if (ids.length < take && exclude.length > 0) {
    const more = await randomWatchableIds(take - ids.length, ids);
    ids.push(...more);
  }
  return hydrateInOrder(ids);
}

export function findLibraryItemById(id: number) {
  return prisma.libraryMedia.findUnique({
    where: { id },
    include: libraryMediaInclude,
  });
}
