import { describe, expect, it, mock } from "bun:test";

import { ensureAdmin } from "@rawkoon/api/middleware/ensureAdmin";

mock.module("@rawkoon/api/middleware/auth", () => ({
  resolveUser: async () => ({ id: "u1", is_admin: true }),
  ensureAdmin,
}));

const createdAt = new Date("2026-01-01T00:00:00.000Z");
mock.module("@rawkoon/api/services/dashboard/activityLogs", () => ({
  findRecentActivityLogs: async () => [
    {
      id: 2,
      userId: "u1",
      type: "book_deleted",
      payload: { book_id: 3, title: "Book", year: 2010 },
      createdAt,
      user: { firstName: "Admin", email: null },
    },
    {
      id: 1,
      userId: "u1",
      type: "media_deleted",
      payload: {
        media_id: 7,
        tmdb_id: 603,
        media_type: "movie",
        title: "Name",
        year: 1999,
        delete_files: true,
        release_torrents: false,
        files_removed: 2,
        torrents_released: 0,
      },
      createdAt,
      user: { firstName: "Admin", email: null },
    },
  ],
}));

const { dashboardActivitiesRoutes } = await import(
  "@rawkoon/api/routes/dashboard/activities"
);

describe("activity feed deletion entries", () => {
  it("maps both types to the library service and passes the fields through", async () => {
    const res = await dashboardActivitiesRoutes.fetch(
      new Request("http://localhost/activities/feed"),
    );
    const body = (await res.json()) as {
      activities: Record<string, unknown>[];
    };
    const media = body.activities.find((a) => a.type === "media_deleted");
    const book = body.activities.find((a) => a.type === "book_deleted");

    expect(media).toMatchObject({
      service: "library",
      media_id: 7,
      tmdb_id: 603,
      media_type: "movie",
      title: "Name",
      year: 1999,
      delete_files: true,
      release_torrents: false,
      files_removed: 2,
      torrents_released: 0,
      username: "Admin",
    });
    expect(book).toMatchObject({
      service: "library",
      book_id: 3,
      title: "Book",
      year: 2010,
    });
  });
});
