import { beforeEach, describe, expect, it, mock } from "bun:test";

type UserRow = {
  id: string;
  locale: string | null;
  calendarToken: string | null;
};
let users: UserRow[] = [];

const findUnique = mock(
  async (args: { where: { id?: string; calendarToken?: string } }) => {
    const { id, calendarToken } = args.where;
    return (
      users.find((u) =>
        id !== undefined ? u.id === id : u.calendarToken === calendarToken,
      ) ?? null
    );
  },
);
const updateMany = mock(
  async (args: {
    where: { id: string; calendarToken: null };
    data: { calendarToken: string };
  }) => {
    const user = users.find(
      (u) => u.id === args.where.id && u.calendarToken === null,
    );
    if (user) user.calendarToken = args.data.calendarToken;
    return { count: user ? 1 : 0 };
  },
);
const update = mock(
  async (args: { where: { id: string }; data: { calendarToken: string } }) => {
    const user = users.find((u) => u.id === args.where.id);
    if (!user) throw new Error("not found");
    user.calendarToken = args.data.calendarToken;
    return user;
  },
);
const movieFindMany = mock(async () => [
  {
    id: 9,
    title: "The Movie",
    overview: null,
    overrides: null,
    titles: [],
    status: "wanted",
    digitalReleaseDate: new Date(),
  },
]);

mock.module("@rawkoon/api/db", () => ({
  prisma: {
    user: { findUnique, updateMany, update },
    libraryEpisode: { findMany: async () => [] },
    libraryMedia: { findMany: movieFindMany },
  },
}));
mock.module("@rawkoon/api/middleware/hono/auth", () => ({
  requireUser: async (
    c: { set: (key: string, value: unknown) => void },
    next: () => Promise<void>,
  ) => {
    c.set("user", { id: "u1" });
    await next();
  },
}));

const { calendarRoutes } = await import("./index");

const request = (path: string, init?: RequestInit) =>
  calendarRoutes.request(`http://localhost${path}`, init);

async function subscription(path = "/subscription", init?: RequestInit) {
  const response = await request(path, init);
  expect(response.status).toBe(200);
  return (await response.json()) as { url: string; webcal_url: string };
}

describe("calendar routes", () => {
  beforeEach(() => {
    users = [{ id: "u1", locale: "fr-CA", calendarToken: null }];
    movieFindMany.mockClear();
  });

  it("creates a token on first view and keeps it after", async () => {
    const first = await subscription();
    expect(first.url).toMatch(
      /^https?:\/\/[^/]+\/api\/calendar\/[A-Za-z0-9_-]{43}\.ics$/,
    );
    expect(first.webcal_url).toBe(first.url.replace(/^https?:/, "webcal:"));
    expect(await subscription()).toEqual(first);
  });

  it("serves the feed in the owner's locale for a valid token", async () => {
    const { url } = await subscription();
    const response = await request(
      new URL(url).pathname.replace("/api/calendar", ""),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/calendar");
    expect(await response.text()).toContain(
      "SUMMARY:The Movie — Sortie numérique",
    );
  });

  it("404s an unknown or malformed token without building anything", async () => {
    for (const path of [
      `/${"a".repeat(43)}.ics`,
      "/short.ics",
      "/no-extension",
    ]) {
      expect((await request(path)).status).toBe(404);
    }
    expect(movieFindMany).not.toHaveBeenCalled();
  });

  it("regenerate kills the old URL", async () => {
    const old = await subscription();
    const fresh = await subscription("/subscription/regenerate", {
      method: "POST",
    });
    expect(fresh.url).not.toBe(old.url);
    const oldPath = new URL(old.url).pathname.replace("/api/calendar", "");
    const newPath = new URL(fresh.url).pathname.replace("/api/calendar", "");
    expect((await request(oldPath)).status).toBe(404);
    expect((await request(newPath)).status).toBe(200);
  });
});
