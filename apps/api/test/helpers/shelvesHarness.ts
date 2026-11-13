/**
 * Shared harness for the shelves route suites: mock the database, the session
 * resolver and the TMDB reach, then import the router once.
 */

import { mock } from "bun:test";
import { fakePrisma, resetState } from "./shelfTestStore";

export { addEntry, resetState, seedShelf, state } from "./shelfTestStore";

/** The signed-in user for the next request; tests flip it between roles. */
export const session: { user: Record<string, unknown> | null } = {
  user: { id: "admin", is_admin: true },
};

const cacheStore = new Map<string, unknown>();

/** The TMDB key the mocked integration answers with; a test that needs one sets it. */
export const tmdb: { key: string | null } = { key: null };

mock.module("@rawkoon/api/db", () => ({ prisma: fakePrisma }));
mock.module("@rawkoon/api/middleware/auth", () => ({
  resolveUser: async () => session.user,
}));
mock.module("@rawkoon/api/services/cache", () => ({
  getJsonCache: async (key: string) => cacheStore.get(key) ?? null,
  setJsonCache: async (key: string, value: unknown) => {
    cacheStore.set(key, value);
  },
}));
// `discoverShelfTitles` stays in the mock because the seed catalogue imports it.
mock.module("@rawkoon/api/services/shelves/shelfTmdb", () => ({
  TMDB_POSTER_BASE: "https://image.tmdb.org/t/p/w342",
  posterUrlOf: (path: string | null) =>
    path ? `https://image.tmdb.org/t/p/w342${path}` : null,
  fetchShelfTitle: async () => null,
  fetchShelfBackdropUrl: async () => null,
  fetchShelfTmdbKey: async () => tmdb.key,
  fetchShelfBackdropCandidates: async () => [
    {
      url: "https://image.tmdb.org/t/p/w1280/back.jpg",
      thumb_url: "https://image.tmdb.org/t/p/w300/back.jpg",
      width: 1920,
      height: 1080,
      language: "en",
    },
  ],
  discoverShelfTitles: async () => [],
}));

const { shelfRoutes } = await import("../../src/routes/shelves");
const { shelfCoverRoutes } = await import("../../src/routes/shelves/covers");

export { shelfRoutes, shelfCoverRoutes };

export const admin = { id: "admin", is_admin: true };
export const user = { id: "user", is_admin: false };

export function resetHarness() {
  resetState();
  cacheStore.clear();
  tmdb.key = null;
  session.user = { ...admin };
}

export const call = (path: string, init?: RequestInit) =>
  shelfRoutes.fetch(new Request(`http://localhost${path}`, init));

/** The public cover route, mounted separately from the guarded shelves router. */
export const callCover = (path: string) =>
  shelfCoverRoutes.fetch(new Request(`http://localhost${path}`));

export const sendJson = (
  method: "POST" | "PATCH" | "PUT",
  path: string,
  body: unknown,
) =>
  call(path, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
