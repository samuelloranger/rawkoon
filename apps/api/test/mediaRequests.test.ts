import { describe, it, expect, beforeEach, mock, afterAll } from "bun:test";

type Req = {
  id: number;
  tmdbId?: number | null;
  type: string;
  status: string;
  requestedById: string;
  libraryMediaId: number | null;
  title?: string;
  googleVolumeId?: string | null;
  bookQualityProfileId?: number | null;
  libraryBookId?: number | null;
};

const state: {
  library: Array<{ tmdbId: number }>;
  libraryBooks: Array<{ googleVolumeId: string }>;
  requests: Req[];
  created: unknown[];
  notifications: Array<{ userId: string; type: string }>;
  admins: Array<{
    id: string;
    locale?: string | null;
    notificationPreferences?: null;
  }>;
  profiles: number[];
  bookProfiles: number[];
  mediaStatusById: Record<number, string>;
  addedBooks: Array<{ volumeId: string; bookQualityProfileId?: number }>;
  bookEditionStatusByBookId: Record<number, string>;
  defaultProfiles: { movie: number | null; show: number | null };
  failLibraryAdd: boolean;
  searchQueued: number[];
  beforeDeleteMany: (() => void) | null;
  deletedLibrary: string[];
} = {
  library: [],
  libraryBooks: [],
  requests: [],
  created: [],
  notifications: [],
  admins: [],
  profiles: [],
  bookProfiles: [],
  mediaStatusById: {},
  addedBooks: [],
  bookEditionStatusByBookId: {},
  defaultProfiles: { movie: null, show: null },
  failLibraryAdd: false,
  searchQueued: [],
  beforeDeleteMany: null,
  deletedLibrary: [],
};

function installMediaRequestDbMock() {
  mock.module("@rawkoon/api/db", () => ({
    prisma: {
      libraryMedia: {
        findUnique: ({
          where,
        }: {
          where: { tmdbId?: number; id?: number };
        }) => {
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
        delete: ({ where }: { where: { id: number } }) => {
          state.deletedLibrary.push(`media:${where.id}`);
          return Promise.resolve({});
        },
      },
      libraryBook: {
        delete: ({ where }: { where: { id: number } }) => {
          state.deletedLibrary.push(`book:${where.id}`);
          return Promise.resolve({});
        },
        findUnique: ({ where }: { where: { googleVolumeId: string } }) =>
          Promise.resolve(
            state.libraryBooks.find(
              (b) => b.googleVolumeId === where.googleVolumeId,
            ) ?? null,
          ),
      },
      qualityProfile: {
        findUnique: ({ where }: { where: { id: number } }) =>
          Promise.resolve(
            state.profiles.includes(where.id) ? { id: where.id } : null,
          ),
      },
      bookQualityProfile: {
        findUnique: ({ where }: { where: { id: number } }) =>
          Promise.resolve(
            state.bookProfiles.includes(where.id) ? { id: where.id } : null,
          ),
      },
      mediaRequest: {
        findUnique: ({
          where,
        }: {
          where: {
            tmdbId_type?: { tmdbId: number; type: string };
            googleVolumeId?: string;
            id?: number;
          };
        }) => {
          if (where.id != null)
            return Promise.resolve(
              state.requests.find((r) => r.id === where.id) ?? null,
            );
          if (where.googleVolumeId != null)
            return Promise.resolve(
              state.requests.find(
                (r) => r.googleVolumeId === where.googleVolumeId,
              ) ?? null,
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
          where: {
            libraryMediaId?: number;
            libraryBookId?: number;
            status: string;
          };
        }) =>
          Promise.resolve(
            state.requests.find((r) => {
              if (where.status !== r.status) return false;
              if (where.libraryMediaId != null)
                return r.libraryMediaId === where.libraryMediaId;
              if (where.libraryBookId != null)
                return r.libraryBookId === where.libraryBookId;
              return false;
            }) ?? null,
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
        deleteMany: ({
          where,
        }: {
          where: {
            id?: number;
            status?: { in: string[] };
            libraryMediaId?: number;
            libraryBookId?: number;
          };
        }) => {
          state.beforeDeleteMany?.();
          if (where.libraryMediaId != null || where.libraryBookId != null)
            state.deletedLibrary.push("requests");
          const before = state.requests.length;
          state.requests = state.requests.filter(
            (r) =>
              !(
                (where.id == null || r.id === where.id) &&
                (where.status == null || where.status.in.includes(r.status)) &&
                (where.libraryMediaId == null ||
                  r.libraryMediaId === where.libraryMediaId) &&
                (where.libraryBookId == null ||
                  r.libraryBookId === where.libraryBookId)
              ),
          );
          return Promise.resolve({ count: before - state.requests.length });
        },
      },
      bookEdition: {
        findFirst: ({ where }: { where: { bookId: number; status: string } }) =>
          Promise.resolve(
            state.bookEditionStatusByBookId[where.bookId] === where.status
              ? { id: where.bookId }
              : null,
          ),
      },
      user: {
        findMany: ({ where }: { where?: { isAdmin?: boolean } } = {}) => {
          if (where?.isAdmin) {
            return Promise.resolve(
              state.admins.map((a) => ({
                id: a.id,
                locale: a.locale ?? null,
                notificationPreferences: a.notificationPreferences ?? null,
              })),
            );
          }
          return Promise.resolve(state.admins);
        },
        findUnique: ({ where }: { where: { id: string } }) =>
          Promise.resolve({
            id: where.id,
            locale: null,
            notificationPreferences: null,
          }),
      },
      mediaSettings: {
        findUnique: () =>
          Promise.resolve({
            defaultMovieQualityProfileId: state.defaultProfiles.movie,
            defaultShowQualityProfileId: state.defaultProfiles.show,
          }),
      },
      $transaction: (promises: Promise<any>[]) => {
        state.deletedLibrary.push("transaction");
        return Promise.all(promises);
      },
    },
  }));
}
installMediaRequestDbMock();

mock.module("@rawkoon/api/services/libraryFromTmdb", () => ({
  addOrUpdateLibraryFromTmdb: ({ tmdb_id }: { tmdb_id: number }) =>
    state.failLibraryAdd
      ? Promise.reject(new Error("TMDB unreachable"))
      : Promise.resolve({
          id: 900 + tmdb_id,
          tmdbId: tmdb_id,
          type: "movie",
          title: "T",
          status: "wanted",
          digitalReleaseDate: new Date("2020-01-01"),
        }),
}));

const realSearchOnAdd = {
  ...(await import("@rawkoon/api/services/searchOnAdd")),
};
mock.module("@rawkoon/api/services/searchOnAdd", () => ({
  isMovieReleased: () => true,
  searchOnAddJobId: (id: number) => `search-on-add-${id}`,
  queueSearchOnAdd: (media: { id: number }) => {
    state.searchQueued.push(media.id);
    return Promise.resolve({
      search_queued: true,
      search_skipped_reason: null,
    });
  },
}));

mock.module("@rawkoon/api/utils/medias/tmdbRegion", () => ({
  getGlobalTmdbRegion: () => Promise.resolve("US"),
}));

mock.module("@rawkoon/api/services/books/bookLibrary", () => ({
  addBookFromVolume: ({
    volumeId,
    bookQualityProfileId,
  }: {
    volumeId: string;
    bookQualityProfileId?: number;
  }) => {
    state.addedBooks.push({ volumeId, bookQualityProfileId });
    return Promise.resolve({
      added: true,
      bookId: 5000 + state.addedBooks.length,
      created: true,
    });
  },
}));

// Full export surface — a partial mock here leaks globally (bun mock.module is
// process-wide) and breaks other suites that use the real cache module.
mock.module("@rawkoon/api/services/cache", () => ({
  getJsonCache: () => Promise.resolve(null),
  setJsonCache: () => Promise.resolve(),
  deleteCache: () => Promise.resolve(),
}));

mock.module("@rawkoon/api/utils/dashboard/tmdbUpcoming", () => ({
  TMDB_UPCOMING_CACHE_KEY: "tmdb:upcoming",
}));

function installMediaRequestNotificationMock() {
  mock.module("@rawkoon/api/workers/notificationService", () => ({
    getAllUsers: () => Promise.resolve([]),
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
}
installMediaRequestNotificationMock();

const {
  createRequest,
  approveRequest,
  deleteLibraryBookWithRequests,
  deleteLibraryMediaWithRequests,
  deleteRequest,
  denyRequest,
  notifyRequestAvailable,
  notifyBookRequestAvailable,
} = await import("@rawkoon/api/services/mediaRequests");

afterAll(() => {
  mock.module("@rawkoon/api/services/searchOnAdd", () => realSearchOnAdd);
  mock.restore();
});

beforeEach(() => {
  state.library = [];
  state.libraryBooks = [];
  state.requests = [];
  state.created = [];
  state.notifications = [];
  state.admins = [{ id: "admin-1" }];
  state.profiles = [1, 3];
  state.bookProfiles = [7];
  state.mediaStatusById = {};
  state.addedBooks = [];
  state.bookEditionStatusByBookId = {};
  state.defaultProfiles = { movie: null, show: null };
  state.failLibraryAdd = false;
  state.searchQueued = [];
  state.beforeDeleteMany = null;
  state.deletedLibrary = [];
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
    expect(r).toEqual({ ok: true, id: 1, status: "pending" });
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
    expect(r).toEqual({ ok: true, id: 1, status: "pending" });
    expect(state.requests[0].status).toBe("pending");
    expect(state.requests[0].requestedById).toBe("u1");
    expect(state.notifications).toEqual([
      { userId: "admin-1", type: "request_pending" },
    ]);
  });

  it("reopens an approved request whose title left the library", async () => {
    state.requests = [
      {
        id: 1,
        tmdbId: 9,
        type: "movie",
        status: "approved",
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
    expect(r).toEqual({ ok: true, id: 1, status: "pending" });
    expect(state.requests[0].status).toBe("pending");
    expect(state.requests[0].requestedById).toBe("u1");
  });

  it("rejects a book already in the library", async () => {
    state.libraryBooks = [{ googleVolumeId: "vol-1" }];
    const r = await createRequest({
      type: "book",
      googleVolumeId: "vol-1",
      title: "Book X",
      author: "Author X",
      posterUrl: null,
      year: null,
      userId: "u1",
    });
    expect(r).toEqual({ ok: false, reason: "exists_in_library" });
  });

  it("creates a book request and notifies admins", async () => {
    const r = await createRequest({
      type: "book",
      googleVolumeId: "vol-2",
      title: "Book Y",
      author: "Author Y",
      posterUrl: null,
      year: 2020,
      userId: "u1",
    });
    expect(r).toEqual({ ok: true, id: 1, status: "pending" });
    expect(state.requests[0]).toMatchObject({
      type: "book",
      googleVolumeId: "vol-2",
      title: "Book Y",
    });
    expect(state.notifications).toEqual([
      { userId: "admin-1", type: "request_pending" },
    ]);
  });

  it("rejects a duplicate book request by volume id", async () => {
    state.requests = [
      {
        id: 1,
        type: "book",
        status: "pending",
        requestedById: "u2",
        libraryMediaId: null,
        googleVolumeId: "vol-3",
      },
    ];
    const r = await createRequest({
      type: "book",
      googleVolumeId: "vol-3",
      title: "Book Z",
      author: null,
      posterUrl: null,
      year: null,
      userId: "u1",
    });
    expect(r).toEqual({ ok: false, reason: "already_requested" });
  });

  it("reopens an approved book request whose book was removed", async () => {
    state.requests = [
      {
        id: 1,
        type: "book",
        status: "approved",
        requestedById: "u2",
        libraryMediaId: null,
        googleVolumeId: "vol-4",
      },
    ];
    const r = await createRequest({
      type: "book",
      googleVolumeId: "vol-4",
      title: "Book W",
      author: null,
      posterUrl: null,
      year: null,
      userId: "u1",
    });
    expect(r).toMatchObject({ ok: true, id: 1 });
    expect(state.requests[0].status).toBe("pending");
    expect(state.requests[0].requestedById).toBe("u1");
  });
});

describe("createRequest by an admin", () => {
  const adminMovie = {
    tmdbId: 9,
    type: "movie" as const,
    title: "X",
    posterUrl: null,
    year: null,
    userId: "admin-1",
    autoApprove: true,
  };

  it("approves on the spot with the default profile, without notifying anyone", async () => {
    state.defaultProfiles.movie = 3;
    const r = await createRequest(adminMovie);
    expect(r).toEqual({ ok: true, id: 1, status: "approved" });
    const row = state.requests[0] as Req & { decidedById?: string };
    expect(row.status).toBe("approved");
    expect(row.libraryMediaId).toBe(909);
    expect(row.decidedById).toBe("admin-1");
    expect(state.notifications).toEqual([]);
  });

  it("stays pending when no default profile is set", async () => {
    const r = await createRequest(adminMovie);
    expect(r).toEqual({ ok: true, id: 1, status: "pending" });
    expect(state.requests[0].status).toBe("pending");
    expect(state.notifications).toEqual([
      { userId: "admin-1", type: "request_pending" },
    ]);
  });

  it("stays pending when the default profile no longer exists", async () => {
    state.defaultProfiles.movie = 42;
    const r = await createRequest(adminMovie);
    expect(r).toEqual({ ok: true, id: 1, status: "pending" });
    expect(state.requests[0].status).toBe("pending");
  });

  it("uses the show default for a show", async () => {
    state.defaultProfiles.movie = 3;
    const r = await createRequest({ ...adminMovie, type: "show" });
    expect(r).toEqual({ ok: true, id: 1, status: "pending" });
    state.requests = [];
    state.defaultProfiles.show = 1;
    const r2 = await createRequest({ ...adminMovie, type: "show" });
    expect(r2).toEqual({ ok: true, id: 1, status: "approved" });
  });

  it("approves a reopened denied request", async () => {
    state.defaultProfiles.movie = 3;
    state.requests = [
      {
        id: 1,
        tmdbId: 9,
        type: "movie",
        status: "denied",
        requestedById: "u2",
        libraryMediaId: null,
        title: "X",
      },
    ];
    const r = await createRequest(adminMovie);
    expect(r).toEqual({ ok: true, id: 1, status: "approved" });
    expect(state.requests[0].status).toBe("approved");
    expect(state.requests[0].requestedById).toBe("admin-1");
  });

  it("falls back to pending and notifies admins when the approval throws", async () => {
    state.defaultProfiles.movie = 3;
    state.failLibraryAdd = true;
    const r = await createRequest(adminMovie);
    expect(r).toEqual({ ok: true, id: 1, status: "pending" });
    expect(state.requests[0].status).toBe("pending");
    expect(state.notifications).toEqual([
      { userId: "admin-1", type: "request_pending" },
    ]);
  });

  it("leaves a non-admin request pending even with a default profile", async () => {
    state.defaultProfiles.movie = 3;
    const r = await createRequest({
      ...adminMovie,
      userId: "u1",
      autoApprove: false,
    });
    expect(r).toEqual({ ok: true, id: 1, status: "pending" });
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
    expect(r).toEqual({
      ok: true,
      library_media_id: 909,
      search_queued: true,
      search_skipped_reason: null,
    });
    const row = state.requests[0];
    expect(row.status).toBe("approved");
    expect(row.libraryMediaId).toBe(909);
    expect(state.notifications).toEqual([
      { userId: "u1", type: "request_decided" },
    ]);
    // Approving searches right away, like a direct add.
    expect(state.searchQueued).toEqual([909]);
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

  it("adds a book via the book-add flow, links it, sets approved, notifies requester", async () => {
    state.requests = [
      {
        id: 1,
        type: "book",
        status: "pending",
        requestedById: "u1",
        libraryMediaId: null,
        title: "Book X",
        googleVolumeId: "vol-1",
      },
    ];
    const r = await approveRequest(1, 7, "admin-1"); // 7 is a book profile
    expect(r).toEqual({ ok: true });
    const row = state.requests[0];
    expect(row.status).toBe("approved");
    expect(row.bookQualityProfileId).toBe(7);
    expect(row.libraryBookId).toBe(5001);
    expect(state.addedBooks).toEqual([
      { volumeId: "vol-1", bookQualityProfileId: 7 },
    ]);
    expect(state.notifications).toEqual([
      { userId: "u1", type: "request_decided" },
    ]);
  });

  it("rejects a stale/deleted book quality profile for a book request", async () => {
    state.requests = [
      {
        id: 1,
        type: "book",
        status: "pending",
        requestedById: "u1",
        libraryMediaId: null,
        title: "Book X",
        googleVolumeId: "vol-1",
      },
    ];
    const r = await approveRequest(1, 999, "admin-1"); // 999 not in bookProfiles
    expect(r).toEqual({ ok: false, reason: "invalid_profile" });
    expect(state.requests[0].status).toBe("pending");
    expect(state.addedBooks).toEqual([]);
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

describe("deleteRequest", () => {
  function seed(status: string) {
    state.requests = [
      {
        id: 1,
        tmdbId: 9,
        type: "movie",
        status,
        requestedById: "u1",
        libraryMediaId: null,
        title: "X",
      },
    ];
  }

  for (const status of ["pending", "denied"]) {
    it(`lets the requester delete their own ${status} request`, async () => {
      seed(status);
      expect(await deleteRequest(1, "u1", false)).toEqual({ ok: true });
      expect(state.requests).toEqual([]);
    });

    it(`lets an admin delete someone else's ${status} request`, async () => {
      seed(status);
      expect(await deleteRequest(1, "admin-1", true)).toEqual({ ok: true });
      expect(state.requests).toEqual([]);
    });
  }

  for (const status of ["approved", "available"]) {
    it(`refuses to delete an ${status} request, even for an admin`, async () => {
      seed(status);
      expect(await deleteRequest(1, "u1", false)).toEqual({
        ok: false,
        reason: "not_deletable",
      });
      expect(await deleteRequest(1, "admin-1", true)).toEqual({
        ok: false,
        reason: "not_deletable",
      });
      expect(state.requests).toHaveLength(1);
    });
  }

  it("hides another user's request from a non-admin as not found", async () => {
    seed("pending");
    expect(await deleteRequest(1, "u2", false)).toEqual({
      ok: false,
      reason: "not_found",
    });
    expect(state.requests).toHaveLength(1);
  });

  it("reports a missing request as not found", async () => {
    expect(await deleteRequest(1, "admin-1", true)).toEqual({
      ok: false,
      reason: "not_found",
    });
  });

  it("keeps a request approved between the read and the delete", async () => {
    seed("pending");
    state.beforeDeleteMany = () => {
      state.requests[0].status = "approved";
    };
    expect(await deleteRequest(1, "u1", false)).toEqual({
      ok: false,
      reason: "not_deletable",
    });
    expect(state.requests[0].status).toBe("approved");
  });
});

describe("deleting a library title", () => {
  const req = (over: Partial<Req>): Req => ({
    id: 1,
    tmdbId: 9,
    type: "movie",
    status: "approved",
    requestedById: "u1",
    libraryMediaId: null,
    ...over,
  });

  it("removes a movie or show's request with it", async () => {
    state.requests = [
      req({ id: 1, libraryMediaId: 5 }),
      req({ id: 2, tmdbId: 10, status: "pending" }),
    ];
    await deleteLibraryMediaWithRequests(5);
    expect(state.requests.map((r) => r.id)).toEqual([2]);
    // Requests go first: the title's delete would otherwise null their link.
    expect(state.deletedLibrary).toEqual([
      "requests",
      "media:5",
      "transaction",
    ]);
  });

  it("removes a book's request with it", async () => {
    state.requests = [
      req({ id: 1, type: "book", tmdbId: null, libraryBookId: 7 }),
      req({ id: 2, type: "book", tmdbId: null, libraryBookId: 8 }),
    ];
    await deleteLibraryBookWithRequests(7);
    expect(state.requests.map((r) => r.id)).toEqual([2]);
    expect(state.deletedLibrary).toEqual(["requests", "book:7", "transaction"]);
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

describe("notifyBookRequestAvailable", () => {
  it("flips an approved book request to available once an edition lands", async () => {
    state.requests = [
      {
        id: 1,
        type: "book",
        status: "approved",
        requestedById: "u1",
        libraryMediaId: null,
        libraryBookId: 5001,
        title: "Book X",
      },
    ];
    state.bookEditionStatusByBookId = { 5001: "downloaded" };
    await notifyBookRequestAvailable(5001);
    expect(state.requests[0].status).toBe("available");
    expect(state.notifications).toEqual([
      { userId: "u1", type: "request_available" },
    ]);
  });

  it("does not flip while no edition of the book has finished downloading", async () => {
    state.requests = [
      {
        id: 1,
        type: "book",
        status: "approved",
        requestedById: "u1",
        libraryMediaId: null,
        libraryBookId: 5001,
        title: "Book X",
      },
    ];
    state.bookEditionStatusByBookId = { 5001: "wanted" };
    await notifyBookRequestAvailable(5001);
    expect(state.requests[0].status).toBe("approved");
    expect(state.notifications).toEqual([]);
  });

  it("is a no-op when no approved request links to the book", async () => {
    await notifyBookRequestAvailable(9999);
    expect(state.notifications).toEqual([]);
  });
});
