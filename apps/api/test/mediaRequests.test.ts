import { describe, it, expect, beforeEach, mock, afterAll } from "bun:test";

type Req = {
  id: number;
  tmdbId: number;
  type: string;
  status: string;
  requestedById: string;
  libraryMediaId: number | null;
  title?: string;
};

const state: {
  library: Array<{ tmdbId: number }>;
  requests: Req[];
  created: unknown[];
  notifications: Array<{ userId: string; type: string }>;
  admins: Array<{ id: string }>;
  profiles: number[];
  mediaStatusById: Record<number, string>;
} = {
  library: [],
  requests: [],
  created: [],
  notifications: [],
  admins: [],
  profiles: [],
  mediaStatusById: {},
};

mock.module("@rawkoon/api/db", () => ({
  prisma: {
    libraryMedia: {
      findUnique: ({ where }: { where: { tmdbId?: number; id?: number } }) => {
        if (where.id != null)
          return Promise.resolve(
            state.mediaStatusById[where.id] != null
              ? { id: where.id, status: state.mediaStatusById[where.id] }
              : null,
          );
        return Promise.resolve(
          state.library.find((m) => m.tmdbId === where.tmdbId) ?? null,
        );
      },
      update: () => Promise.resolve({}),
    },
    qualityProfile: {
      findUnique: ({ where }: { where: { id: number } }) =>
        Promise.resolve(
          state.profiles.includes(where.id) ? { id: where.id } : null,
        ),
    },
    mediaRequest: {
      findUnique: ({
        where,
      }: {
        where: { tmdbId_type?: { tmdbId: number; type: string }; id?: number };
      }) => {
        if (where.id != null)
          return Promise.resolve(
            state.requests.find((r) => r.id === where.id) ?? null,
          );
        const k = where.tmdbId_type!;
        return Promise.resolve(
          state.requests.find(
            (r) => r.tmdbId === k.tmdbId && r.type === k.type,
          ) ?? null,
        );
      },
      findFirst: ({
        where,
      }: {
        where: { libraryMediaId: number; status: string };
      }) =>
        Promise.resolve(
          state.requests.find(
            (r) =>
              r.libraryMediaId === where.libraryMediaId &&
              r.status === where.status,
          ) ?? null,
        ),
      create: ({ data }: { data: Req }) => {
        const row = { ...data, id: state.requests.length + 1 };
        state.requests.push(row);
        state.created.push(row);
        return Promise.resolve(row);
      },
      update: ({
        where,
        data,
      }: {
        where: { id: number };
        data: Partial<Req>;
      }) => {
        const row = state.requests.find((r) => r.id === where.id)!;
        Object.assign(row, data);
        return Promise.resolve(row);
      },
    },
    user: {
      findMany: () => Promise.resolve(state.admins),
    },
    $transaction: (promises: Promise<any>[]) => Promise.all(promises),
  },
}));

mock.module("@rawkoon/api/services/libraryFromTmdb", () => ({
  addOrUpdateLibraryFromTmdb: ({ tmdb_id }: { tmdb_id: number }) =>
    Promise.resolve({
      id: 900 + tmdb_id,
      tmdbId: tmdb_id,
      type: "movie",
      title: "T",
    }),
}));

mock.module("@rawkoon/api/utils/medias/tmdbRegion", () => ({
  getGlobalTmdbRegion: () => Promise.resolve("US"),
}));

// Full export surface — a partial mock here leaks globally (bun mock.module is
// process-wide) and breaks other suites that use the real cache module.
mock.module("@rawkoon/api/services/cache", () => ({
  getJsonCache: () => Promise.resolve(null),
  setJsonCache: () => Promise.resolve(),
  deleteCache: () => Promise.resolve(),
  acquireLock: () => Promise.resolve(true),
  releaseLock: () => Promise.resolve(),
}));

mock.module("@rawkoon/api/utils/dashboard/tmdbUpcoming", () => ({
  TMDB_UPCOMING_CACHE_KEY: "tmdb:upcoming",
}));

mock.module("@rawkoon/api/workers/notificationService", () => ({
  createAndQueueNotification: (
    userId: string,
    _t: string,
    _b: string,
    type: string,
  ) => {
    state.notifications.push({ userId, type });
    return Promise.resolve(true);
  },
}));

const { createRequest, approveRequest, denyRequest, notifyRequestAvailable } =
  await import("@rawkoon/api/services/mediaRequests");

afterAll(() => {
  mock.restore();
});

beforeEach(() => {
  state.library = [];
  state.requests = [];
  state.created = [];
  state.notifications = [];
  state.admins = [{ id: "admin-1" }];
  state.profiles = [1, 3];
  state.mediaStatusById = {};
});

describe("createRequest", () => {
  it("rejects when title already in library", async () => {
    state.library = [{ tmdbId: 5 }];
    const r = await createRequest({
      tmdbId: 5,
      type: "movie",
      title: "X",
      posterUrl: null,
      year: null,
      userId: "u1",
    });
    expect(r).toEqual({ ok: false, reason: "exists_in_library" });
  });

  it("rejects a duplicate request", async () => {
    state.requests = [
      {
        id: 1,
        tmdbId: 7,
        type: "movie",
        status: "pending",
        requestedById: "u2",
        libraryMediaId: null,
      },
    ];
    const r = await createRequest({
      tmdbId: 7,
      type: "movie",
      title: "X",
      posterUrl: null,
      year: null,
      userId: "u1",
    });
    expect(r).toEqual({ ok: false, reason: "already_requested" });
  });

  it("creates and notifies admins", async () => {
    const r = await createRequest({
      tmdbId: 9,
      type: "movie",
      title: "X",
      posterUrl: null,
      year: null,
      userId: "u1",
    });
    expect(r).toEqual({ ok: true, id: 1 });
    expect(state.notifications).toEqual([
      { userId: "admin-1", type: "request_pending" },
    ]);
  });

  it("reopens a denied request", async () => {
    state.requests = [
      {
        id: 1,
        tmdbId: 9,
        type: "movie",
        status: "denied",
        requestedById: "u2",
        libraryMediaId: null,
      },
    ];
    const r = await createRequest({
      tmdbId: 9,
      type: "movie",
      title: "X",
      posterUrl: null,
      year: null,
      userId: "u1",
    });
    expect(r).toEqual({ ok: true, id: 1 });
    expect(state.requests[0].status).toBe("pending");
    expect(state.requests[0].requestedById).toBe("u1");
    expect(state.notifications).toEqual([
      { userId: "admin-1", type: "request_pending" },
    ]);
  });
});

describe("approveRequest", () => {
  it("fails when not found", async () => {
    expect(await approveRequest(99, 1, "admin-1")).toEqual({
      ok: false,
      reason: "not_found",
    });
  });

  it("adds to library, links it, sets approved, notifies requester", async () => {
    state.requests = [
      {
        id: 1,
        tmdbId: 9,
        type: "movie",
        status: "pending",
        requestedById: "u1",
        libraryMediaId: null,
        title: "X",
      },
    ];
    const r = await approveRequest(1, 3, "admin-1");
    expect(r).toEqual({ ok: true });
    const row = state.requests[0];
    expect(row.status).toBe("approved");
    expect(row.libraryMediaId).toBe(909);
    expect(state.notifications).toEqual([
      { userId: "u1", type: "request_decided" },
    ]);
  });

  it("rejects a stale/deleted quality profile without touching the request", async () => {
    state.requests = [
      {
        id: 1,
        tmdbId: 9,
        type: "movie",
        status: "pending",
        requestedById: "u1",
        libraryMediaId: null,
        title: "X",
      },
    ];
    const r = await approveRequest(1, 999, "admin-1"); // 999 not in profiles
    expect(r).toEqual({ ok: false, reason: "invalid_profile" });
    expect(state.requests[0].status).toBe("pending");
    expect(state.notifications).toEqual([]);
  });
});

describe("denyRequest", () => {
  it("sets denied and notifies requester", async () => {
    state.requests = [
      {
        id: 1,
        tmdbId: 9,
        type: "movie",
        status: "pending",
        requestedById: "u1",
        libraryMediaId: null,
        title: "X",
      },
    ];
    const r = await denyRequest(1, "admin-1", "no");
    expect(r).toEqual({ ok: true });
    expect(state.requests[0].status).toBe("denied");
    expect(state.notifications).toEqual([
      { userId: "u1", type: "request_decided" },
    ]);
  });
});

describe("notifyRequestAvailable", () => {
  it("flips approved request to available and notifies requester", async () => {
    state.requests = [
      {
        id: 1,
        tmdbId: 9,
        type: "movie",
        status: "approved",
        requestedById: "u1",
        libraryMediaId: 909,
        title: "X",
      },
    ];
    state.mediaStatusById = { 909: "downloaded" };
    await notifyRequestAvailable(909);
    expect(state.requests[0].status).toBe("available");
    expect(state.notifications).toEqual([
      { userId: "u1", type: "request_available" },
    ]);
  });

  it("does not flip while the media is not yet complete (e.g. one show episode)", async () => {
    state.requests = [
      {
        id: 1,
        tmdbId: 9,
        type: "show",
        status: "approved",
        requestedById: "u1",
        libraryMediaId: 909,
        title: "X",
      },
    ];
    state.mediaStatusById = { 909: "returning" }; // ongoing show, not "downloaded"
    await notifyRequestAvailable(909);
    expect(state.requests[0].status).toBe("approved");
    expect(state.notifications).toEqual([]);
  });

  it("is a no-op when no approved request links to the media", async () => {
    await notifyRequestAvailable(123);
    expect(state.notifications).toEqual([]);
  });
});
