import { beforeEach, describe, expect, it, mock } from "bun:test";

import { ensureAdmin } from "@rawkoon/api/middleware/ensureAdmin";
import { dbModule } from "./mocks/prisma";

// The guards resolve the session through this one seam; swap the user per test.
let current: { id: string; is_admin: boolean } | null = null;
mock.module("@rawkoon/api/middleware/auth", () => ({
  resolveUser: async () => current,
  ensureAdmin,
}));

const book = {
  id: 1,
  googleVolumeId: "vol",
  isbn13: null,
  title: "T",
  sortTitle: null,
  subtitle: null,
  overview: null,
  coverUrl: null,
  authors: [],
  language: "en",
  publishedYear: null,
  seriesName: null,
  seriesPosition: null,
  narrators: [],
  genres: [],
  publisher: null,
  pageCount: null,
  publishedDate: null,
  rating: null,
  ratingCount: null,
  addedAt: new Date(),
  updatedAt: new Date(),
  editions: [],
  metadataFields: [],
};
mock.module("@rawkoon/api/db", () =>
  dbModule({
    prisma: {
      libraryBook: { findUnique: async () => book },
      oidcProvider: { findMany: async () => [] },
      bookReadState: { findMany: async () => [] },
      mediaRequest: { findMany: async () => [] },
    },
  }),
);

const { bookRoutes } = await import("@rawkoon/api/routes/books");

const call = (method: string, path: string) =>
  bookRoutes.fetch(
    new Request(`http://localhost${path}`, {
      method,
      headers: { "content-type": "application/json" },
      body: method === "GET" || method === "DELETE" ? undefined : "{}",
    }),
  );

const gated: [string, string][] = [
  ["POST", "/"],
  ["DELETE", "/1"],
  ["POST", "/discovery/add"],
  ["PATCH", "/1/editions/ebook"],
  ["POST", "/1/editions"],
  ["POST", "/1/editions/ebook/rescan"],
  ["DELETE", "/1/files/2"],
  ["GET", "/1/editions/ebook/search"],
  ["POST", "/1/editions/ebook/grab"],
  ["POST", "/1/editions/ebook/auto"],
  ["POST", "/1/refresh-metadata"],
  ["PATCH", "/1/overrides"],
];

describe("book mutations are admin-only", () => {
  beforeEach(() => {
    current = { id: "member", is_admin: false };
  });

  for (const [method, path] of gated) {
    it(`${method} ${path} is 403 for a member`, async () => {
      expect((await call(method, path)).status).toBe(403);
    });
    it(`${method} ${path} is 401 when signed out`, async () => {
      current = null;
      expect((await call(method, path)).status).toBe(401);
    });
    it(`${method} ${path} passes the guard for an admin`, async () => {
      current = { id: "admin", is_admin: true };
      const status = (await call(method, path)).status;
      expect(status).not.toBe(401);
      expect(status).not.toBe(403);
    });
  }

  it("still lets a member read a book", async () => {
    const res = await call("GET", "/1");
    expect(res.status).toBe(200);
  });
});
