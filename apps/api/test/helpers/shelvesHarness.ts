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
  fetchShelfTmdbKey: async () => null,
  discoverShelfTitles: async () => [],
}));

const { shelfRoutes } = await import("../../src/routes/shelves");

export { shelfRoutes };

export const admin = { id: "admin", is_admin: true };
export const user = { id: "user", is_admin: false };

export function resetHarness() {
  resetState();
  cacheStore.clear();
  session.user = { ...admin };
}

export const call = (path: string, init?: RequestInit) =>
  shelfRoutes.fetch(new Request(`http://localhost${path}`, init));

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
