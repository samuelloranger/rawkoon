import { describe, it, expect, mock, afterAll, beforeEach } from "bun:test";

let heldCount = 0;
let isAdmin = true;
let due = false;
let grabResult: { grabbed: boolean; reason?: string } = { grabbed: true };
const grabRelease = mock(async (_o: unknown) => grabResult);
mock.module("@rawkoon/api/services/mediaGrabber/mediaGrabberGrab", () => ({
  grabRelease,
}));

const updateMany = mock(
  async (_a: { where: { targetKey: string }; data: { grabAfter: Date } }) => ({
    count: heldCount,
  }),
);

mock.module("@rawkoon/api/db", () => ({
  prisma: {
    user: {
      findUnique: async () => ({
        id: "u1",
        email: "test@example.com",
        firstName: "Test",
        lastName: "User",
        isAdmin,
        locale: null,
        lastLogin: null,
        createdAt: null,
        lastActivity: null,
        avatarUrl: null,
        navPosition: null,
      }),
    },
    // The real worker runs against this: nothing is due, so nothing is grabbed.
    pendingRelease: {
      updateMany,
      deleteMany: async () => ({ count: 0 }),
      findMany: async (a: { distinct?: string[] }) => {
        if (!due) return [];
        if (a.distinct) return [{ targetKey: "m:5" }];
        return [
          {
            id: 1,
            targetKey: "m:5",
            source: null,
            mediaId: 5,
            episodeId: null,
            season: null,
            score: 1,
            release: {
              guid: "g",
              title: "Movie.2020.1080p",
              magnetUrl: "magnet:?xt=urn:btih:g",
              downloadUrl: null,
              indexer: "idx",
              sizeBytes: 1e9,
              seeders: 5,
              freeleech: false,
            },
          },
        ];
      },
    },
    libraryMedia: {
      update: async () => ({}),
      findUnique: async () => ({
        id: 5,
        searchAttempts: 0,
        monitored: true,
        status: "wanted",
        qualityProfileId: null,
        _count: { files: 0 },
      }),
    },
    qualityProfile: { findUnique: async () => null },
    grabBlocklist: { findMany: async () => [] },
  },
}));
mock.module("@rawkoon/api/lib/auth", () => ({
  auth: {
    api: { getSession: async () => ({ user: { id: "u1" } }) },
    handler: async () => new Response("", { status: 404 }),
  },
  refreshOidcProviders: () => {},
}));

const { downloadsRoutes } = await import("@rawkoon/api/routes/downloads");

afterAll(() => mock.restore());

beforeEach(() => {
  heldCount = 0;
  isAdmin = true;
  due = false;
  grabResult = { grabbed: true };
  grabRelease.mockClear();
  updateMany.mockClear();
});

const post = (body: unknown) =>
  downloadsRoutes.request(
    new Request("http://localhost/pending-releases/grab-now", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );

describe("POST /pending-releases/grab-now", () => {
  it("rejects a target key that grabDelay would never produce", async () => {
    const res = await post({ target_key: "x:1; drop" });
    expect(res.status).toBe(400);
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("answers 404 when nothing is held for the target", async () => {
    const res = await post({ target_key: "m:5" });
    expect(res.status).toBe(404);
  });

  it("pulls the held window forward for that target only", async () => {
    heldCount = 2;
    const res = await post({ target_key: "s:5:2" });
    expect(res.status).toBe(200);
    expect(updateMany).toHaveBeenCalledTimes(1);
    expect(updateMany.mock.calls[0]![0].where).toEqual({ targetKey: "s:5:2" });
    expect(await res.json()).toEqual({ grabbed: false, reason: null });
  });

  it("refuses a non-admin", async () => {
    isAdmin = false;
    const res = await post({ target_key: "m:5" });
    expect(res.status).toBe(403);
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("reports grabbed: true when the due release is grabbed", async () => {
    heldCount = 1;
    due = true;
    const res = await post({ target_key: "m:5" });
    expect(res.status).toBe(200);
    expect(grabRelease).toHaveBeenCalledTimes(1);
    expect(await res.json()).toEqual({ grabbed: true, reason: null });
  });

  it("explains a miss when every release is refused", async () => {
    heldCount = 1;
    due = true;
    grabResult = { grabbed: false, reason: "Release rejected" };
    const res = await post({ target_key: "m:5" });
    expect(await res.json()).toEqual({ grabbed: false, reason: "all_failed" });
  });
});
