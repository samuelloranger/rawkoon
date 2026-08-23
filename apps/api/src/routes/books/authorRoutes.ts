import { Elysia, t } from "elysia";

import { requireUser, ensureAdmin } from "@rawkoon/api/middleware/auth";
import { prisma } from "@rawkoon/api/db";
import { badRequest, notFound } from "@rawkoon/api/errors";
import type { Author, BookEditionKind } from "@rawkoon/shared/types";

const KINDS: BookEditionKind[] = ["ebook", "audiobook"];

type AuthorRow = {
  id: number;
  googleAuthorName: string;
  sortName: string | null;
  imageUrl: string | null;
  bio: string | null;
  monitored: boolean;
  monitorFrom: Date | null;
  monitorEditionKinds: string[];
  monitorLanguages: string[];
  bookQualityProfileId: number | null;
  lastCheckedAt: Date | null;
  _count?: { bookLinks: number };
};

const mapAuthor = (row: AuthorRow): Author => ({
  id: row.id,
  name: row.googleAuthorName,
  sort_name: row.sortName,
  image_url: row.imageUrl,
  bio: row.bio,
  monitored: row.monitored,
  monitor_from: row.monitorFrom?.toISOString() ?? null,
  monitor_edition_kinds: row.monitorEditionKinds.filter(
    (k): k is BookEditionKind => KINDS.includes(k as BookEditionKind),
  ),
  monitor_languages: row.monitorLanguages,
  book_quality_profile_id: row.bookQualityProfileId,
  last_checked_at: row.lastCheckedAt?.toISOString() ?? null,
  book_count: row._count?.bookLinks ?? 0,
});

const authorSelect = {
  id: true,
  googleAuthorName: true,
  sortName: true,
  imageUrl: true,
  bio: true,
  monitored: true,
  monitorFrom: true,
  monitorEditionKinds: true,
  monitorLanguages: true,
  bookQualityProfileId: true,
  lastCheckedAt: true,
  _count: { select: { bookLinks: true } },
} as const;

/**
 * Authors and author monitoring.
 *   GET   /api/authors          — every author in the library, monitored first
 *   GET   /api/authors/search   — filter by name
 *   PATCH /api/authors/:id      — monitoring (admin)
 *
 * Authors are created as a side effect of adding a book, never directly: an
 * author with no books is not something the library has an opinion about.
 */
export const authorRoutes = new Elysia({ prefix: "/api/authors" })
  .use(requireUser)

  .get("/", async () => {
    const authors = await prisma.author.findMany({
      select: authorSelect,
      // Monitored first — the list's job is to show what is being watched.
      orderBy: [{ monitored: "desc" }, { sortName: "asc" }],
    });
    return { authors: authors.map(mapAuthor) };
  })

  .get(
    "/search",
    async ({ query }) => {
      const q = query.q?.trim();
      if (!q) return { authors: [] };
      const authors = await prisma.author.findMany({
        where: { googleAuthorName: { contains: q, mode: "insensitive" } },
        select: authorSelect,
        orderBy: [{ monitored: "desc" }, { sortName: "asc" }],
        take: 50,
      });
      return { authors: authors.map(mapAuthor) };
    },
    { query: t.Object({ q: t.Optional(t.String()) }) },
  )

  .patch(
    "/:id",
    async ({ params, body, set, user }) => {
      const denied = ensureAdmin(user, set);
      if (denied) return denied;

      const author = await prisma.author.findUnique({
        where: { id: params.id },
        select: { id: true, monitored: true, monitorFrom: true },
      });
      if (!author) return notFound(set, "Author not found");

      if (body.monitor_edition_kinds) {
        const invalid = body.monitor_edition_kinds.filter(
          (k) => !KINDS.includes(k as BookEditionKind),
        );
        if (invalid.length > 0) {
          return badRequest(
            set,
            "monitor_edition_kinds must contain only ebook and/or audiobook",
          );
        }
      }

      // ISO 639-1 only: the codes are compared against the provider's own
      // two-letter language field, so anything else can never match.
      let monitorLanguages: string[] | undefined;
      if (body.monitor_languages !== undefined) {
        const normalized = body.monitor_languages.map((l) =>
          l.trim().toLowerCase(),
        );
        if (normalized.some((l) => !/^[a-z]{2}$/.test(l))) {
          return badRequest(
            set,
            "monitor_languages must contain ISO 639-1 codes",
          );
        }
        monitorLanguages = [...new Set(normalized)];
      }

      if (body.book_quality_profile_id != null) {
        const profile = await prisma.bookQualityProfile.findUnique({
          where: { id: body.book_quality_profile_id },
          select: { id: true },
        });
        if (!profile) return notFound(set, "Book quality profile not found");
      }

      let monitorFrom: Date | null | undefined;
      if (body.monitor_from !== undefined) {
        if (body.monitor_from === null) {
          monitorFrom = null;
        } else {
          const parsed = new Date(body.monitor_from);
          if (Number.isNaN(parsed.getTime())) {
            return badRequest(set, "monitor_from must be a valid date");
          }
          monitorFrom = parsed;
        }
      } else if (body.monitored === true && !author.monitored) {
        // Turning monitoring on without a date means "from now" — without this
        // the first check would pull the author's whole backlist.
        monitorFrom = author.monitorFrom ?? new Date();
      }

      const updated = await prisma.author.update({
        where: { id: author.id },
        data: {
          ...(body.monitored !== undefined
            ? { monitored: body.monitored }
            : {}),
          ...(monitorFrom !== undefined ? { monitorFrom } : {}),
          ...(body.monitor_edition_kinds !== undefined
            ? { monitorEditionKinds: body.monitor_edition_kinds }
            : {}),
          ...(monitorLanguages !== undefined ? { monitorLanguages } : {}),
          ...(body.book_quality_profile_id !== undefined
            ? { bookQualityProfileId: body.book_quality_profile_id }
            : {}),
        },
        select: authorSelect,
      });

      return { author: mapAuthor(updated) };
    },
    {
      params: t.Object({ id: t.Numeric() }),
      body: t.Object({
        monitored: t.Optional(t.Boolean()),
        monitor_from: t.Optional(t.Nullable(t.String())),
        monitor_edition_kinds: t.Optional(t.Array(t.String())),
        monitor_languages: t.Optional(t.Array(t.String())),
        book_quality_profile_id: t.Optional(t.Nullable(t.Numeric())),
      }),
    },
  );
