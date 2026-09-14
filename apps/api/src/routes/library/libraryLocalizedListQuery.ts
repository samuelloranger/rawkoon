import { Prisma } from "@prisma/client";
import type { TitleLanguage } from "@rawkoon/shared/constants";
import type { LibrarySortBy, LibrarySortDir } from "./libraryListQuery";

/**
 * ORDER BY fragments, keyed by the already-narrowed sort enum. The only place
 * SQL text varies; no caller-supplied string is ever concatenated.
 */
function orderByFragment(
  sortBy: LibrarySortBy,
  sortDir: LibrarySortDir,
): Prisma.Sql {
  const dir = sortDir === "asc" ? Prisma.raw("ASC") : Prisma.raw("DESC");
  switch (sortBy) {
    case "title":
      return Prisma.sql`CASE
        WHEN m.overrides->>'title' IS NOT NULL THEN m."list_title"
        ELSE COALESCE(t.sort_title, m."list_title")
      END ${dir}, m."id" ${dir}`;
    case "year":
      return Prisma.sql`m."list_year" ${dir} NULLS LAST, m."id" ${dir}`;
    case "status":
      return Prisma.sql`m."status" ${dir}, m."id" ${dir}`;
    case "digital_release_date":
      return Prisma.sql`m."digital_release_date" ${dir} NULLS LAST, m."id" ${dir}`;
    case "file_size":
      return Prisma.sql`m."total_size_bytes" ${dir} NULLS LAST, m."id" ${dir}`;
    case "last_grabbed_at":
      // null treated as oldest: asc → nulls first, desc → nulls last.
      return sortDir === "asc"
        ? Prisma.sql`m."last_grabbed_at" ASC NULLS FIRST, m."id" ASC`
        : Prisma.sql`m."last_grabbed_at" DESC NULLS LAST, m."id" DESC`;
    case "added_at":
      return Prisma.sql`m."added_at" ${dir}, m."id" ${dir}`;
  }
}

/**
 * Page of library ids, ordered and filtered by the localized title.
 * Prisma cannot order by a to-many relation column, so the page is resolved
 * here and hydrated through the normal include by the caller.
 */
type LocalizedFilters = {
  language: TitleLanguage;
  type?: string;
  status?: string;
  q?: string;
  fileLanguage?: string;
};

function localizedFromWhere(input: LocalizedFilters): Prisma.Sql {
  const conditions: Prisma.Sql[] = [];
  if (input.type) conditions.push(Prisma.sql`m."type" = ${input.type}`);
  if (input.status) conditions.push(Prisma.sql`m."status" = ${input.status}`);
  if (input.q) {
    const pattern = `%${input.q}%`;
    conditions.push(
      Prisma.sql`(t.title ILIKE ${pattern} OR m."title" ILIKE ${pattern})`,
    );
  }
  if (input.fileLanguage) {
    conditions.push(
      Prisma.sql`EXISTS (
        SELECT 1 FROM media_files f
        WHERE f.media_id = m."id"
          AND ${input.fileLanguage} = ANY(f.language_tags)
      )`,
    );
  }
  const where = conditions.length
    ? Prisma.sql`WHERE ${Prisma.join(conditions, " AND ")}`
    : Prisma.empty;
  return Prisma.sql`
    FROM library_media m
    LEFT JOIN library_media_titles t
      ON t.media_id = m."id" AND t.language = ${input.language}
    ${where}
  `;
}

export function buildLocalizedIdQuery(
  input: LocalizedFilters & {
    sortBy: LibrarySortBy;
    sortDir: LibrarySortDir;
    take: number;
    skip: number;
  },
): Prisma.Sql {
  return Prisma.sql`
    SELECT m."id"
    ${localizedFromWhere(input)}
    ORDER BY ${orderByFragment(input.sortBy, input.sortDir)}
    LIMIT ${input.take} OFFSET ${input.skip}
  `;
}

/** Match the list's localized search when reporting counts by media type. */
export function buildLocalizedCountQuery(input: LocalizedFilters): Prisma.Sql {
  return Prisma.sql`
    SELECT m."type", COUNT(*)::int AS "_count"
    ${localizedFromWhere(input)}
    GROUP BY m."type"
  `;
}
