import { Elysia, t } from "elysia";
import { Prisma } from "@prisma/client";
import { prisma } from "@rawkoon/api/db";
import { auth } from "@rawkoon/api/auth";
import { requireUser } from "@rawkoon/api/middleware/auth";
import { serverError } from "@rawkoon/api/errors";

export const searchRoutes = new Elysia({ prefix: "/api/search" })
  .use(auth)
  .use(requireUser)
  .get(
    "/quick",
    async ({ query, user, set }) => {
      try {
        const q = (query.q ?? "").trim().toLowerCase();
        const limit = Math.min(parseInt(query.limit || "6", 10) || 6, 20);

        const empty = {
          medias: [],
          books: [],
          users: [],
        };

        if (!q || q.length < 2) {
          return empty;
        }

        const userOrConditions: Prisma.UserWhereInput[] = [
          { firstName: { contains: q, mode: "insensitive" } },
          { lastName: { contains: q, mode: "insensitive" } },
        ];
        if (user!.is_admin) {
          userOrConditions.push({
            email: { contains: q, mode: "insensitive" },
          });
        }

        const users = await prisma.user.findMany({
          where: {
            OR: userOrConditions,
          },
          take: limit,
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
          },
        });

        // Medias from library
        let medias: {
          id: number;
          title: string;
          type: string;
          year: number | null;
          status: string;
        }[] = [];
        try {
          medias = await prisma.libraryMedia.findMany({
            where: { title: { contains: q, mode: "insensitive" } },
            take: limit,
            select: {
              id: true,
              title: true,
              type: true,
              year: true,
              status: true,
            },
          });
        } catch {
          // library table not yet available — return empty
        }

        // Books are gated: a movies-only install must not pay for the query
        // and must not see a section it has no pages for.
        let books: {
          id: number;
          title: string;
          authors: string[];
          year: number | null;
        }[] = [];
        try {
          const settings = await prisma.appSettings.findUnique({
            where: { id: 1 },
            select: { booksEnabled: true },
          });
          if (settings?.booksEnabled === true) {
            const rows = await prisma.libraryBook.findMany({
              where: { title: { contains: q, mode: "insensitive" } },
              take: limit,
              orderBy: { listTitle: "asc" },
              select: {
                id: true,
                title: true,
                authors: true,
                listYear: true,
              },
            });
            books = rows.map((b) => ({
              id: b.id,
              title: b.title,
              authors: b.authors,
              year: b.listYear,
            }));
          }
        } catch {
          // book tables not yet migrated — return empty
        }

        return {
          medias,
          books,
          users: users.map((u) => ({
            id: u.id,
            name: u.firstName
              ? `${u.firstName}${u.lastName ? ` ${u.lastName}` : ""}`
              : user!.is_admin
                ? u.email
                : "User",
            ...(user!.is_admin ? { email: u.email } : {}),
          })),
        };
      } catch (error) {
        console.error("Error in quick search:", error);
        return serverError(set, "Search failed");
      }
    },
    {
      query: t.Object({
        q: t.Optional(t.String()),
        limit: t.Optional(t.String()),
      }),
    },
  );
