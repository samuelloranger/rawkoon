/**
 * Route tests for /api/requests — isolated prisma + auth stubs (see custom-formats).
 */
import { describe, it, expect, beforeEach, mock, afterAll } from "bun:test";

const EPOCH = new Date("2026-06-19T00:00:00Z");

type FakeUser = {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  isAdmin: boolean | null;
  locale: string | null;
  lastLogin: Date | null;
  createdAt: Date | null;
  lastActivity: Date | null;
  avatarUrl: string | null;
  navPosition: string | null;
  name: string;
} | null;

let injectedDbUser: FakeUser = null;
let requestRows: Array<{
  id: number;
  tmdbId: number;
  type: string;
  title: string;
  posterUrl: string | null;
  year: number | null;
  status: string;
  requestedById: string;
  qualityProfileId: number | null;
  libraryMediaId: number | null;
  denyReason: string | null;
  createdAt: Date;
  decidedAt: Date | null;
  requestedBy?: { id: string; name: string | null };
}> = [];
let libraryRows: Array<{ tmdbId: number }> = [];
let nextRequestId = 1;

const prismaStub = {
  libraryMedia: {
    findUnique: async ({ where }: { where: { tmdbId: number } }) =>
      libraryRows.find((m) => m.tmdbId === where.tmdbId) ?? null,
    update: async () => ({}),
  },
  mediaRequest: {
    findMany: async () => requestRows,
    findUnique: async ({
      where,
    }: {
      where: { id?: number; tmdbId_type?: { tmdbId: number; type: string } };
    }) => {
      if (where.id != null)
        return requestRows.find((r) => r.id === where.id) ?? null;
      const k = where.tmdbId_type!;
      return (
        requestRows.find((r) => r.tmdbId === k.tmdbId && r.type === k.type) ??
        null
      );
    },
    findFirst: async () => null,
    create: async ({
      data,
    }: {
      data: {
        tmdbId: number;
        type: string;
        title: string;
        posterUrl: string | null;
        year: number | null;
        requestedById: string;
        status: string;
      };
    }) => {
      const row = {
        id: nextRequestId++,
        ...data,
        qualityProfileId: null,
        libraryMediaId: null,
        denyReason: null,
        createdAt: EPOCH,
        decidedAt: null,
      };
      requestRows.push(row);
      return row;
    },
    update: async ({
      where,
      data,
    }: {
      where: { id: number };
      data: Record<string, unknown>;
    }) => {
      const row = requestRows.find((r) => r.id === where.id)!;
      Object.assign(row, data);
      return row;
    },
  },
  user: {
    findUnique: async () => injectedDbUser,
    findMany: async () =>
      injectedDbUser?.isAdmin ? [{ id: injectedDbUser.id }] : [],
  },
};

mock.module("@rawkoon/api/db", () => ({ prisma: prismaStub }));
mock.module("@rawkoon/api/lib/auth", () => ({
  auth: {
    api: {
      getSession: async () =>
        injectedDbUser ? { user: { id: injectedDbUser.id } } : null,
    },
    handler: async () => new Response("", { status: 404 }),
  },
  refreshOidcProviders: () => {},
}));
mock.module("@rawkoon/api/services/libraryFromTmdb", () => ({
  addOrUpdateLibraryFromTmdb: async ({ tmdb_id }: { tmdb_id: number }) => ({
    id: 900 + tmdb_id,
    tmdbId: tmdb_id,
    type: "movie",
    title: "T",
  }),
}));
mock.module("@rawkoon/api/workers/notificationService", () => ({
  createAndQueueNotification: async () => true,
}));

const { requestRoutes } = await import("@rawkoon/api/routes/requests");

afterAll(() => {
  mock.restore();
});

const ADMIN_USER: NonNullable<FakeUser> = {
  id: "u1",
  email: "admin@test.com",
  firstName: "Sam",
  lastName: null,
  isAdmin: true,
  locale: "en",
  lastLogin: null,
  createdAt: EPOCH,
  lastActivity: null,
  avatarUrl: null,
  navPosition: null,
  name: "Sam",
};

beforeEach(() => {
  injectedDbUser = ADMIN_USER;
  requestRows = [
    {
      id: 1,
      tmdbId: 9,
      type: "movie",
      title: "X",
      posterUrl: null,
      year: 2020,
      status: "pending",
      requestedById: "u1",
      qualityProfileId: null,
      libraryMediaId: null,
      denyReason: null,
      createdAt: EPOCH,
      decidedAt: null,
      requestedBy: { id: "u1", name: "Sam" },
    },
  ];
  libraryRows = [];
  nextRequestId = 2;
});

describe("requestRoutes", () => {
  it("GET / returns snake_case mapped requests", async () => {
    const res = await requestRoutes.handle(
      new Request("http://localhost/api/requests"),
    );
    const json = (await res.json()) as {
      requests: Array<Record<string, unknown>>;
    };
    expect(json.requests[0]).toMatchObject({
      id: 1,
      tmdb_id: 9,
      poster_url: null,
      requested_by: { id: "u1", name: "Sam" },
      created_at: "2026-06-19T00:00:00.000Z",
    });
  });

  it("POST / returns the new id", async () => {
    const res = await requestRoutes.handle(
      new Request("http://localhost/api/requests", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tmdb_id: 42, type: "movie", title: "X" }),
      }),
    );
    expect(await res.json()).toEqual({ id: 2 });
  });
});
