import { describe, it, expect, beforeEach, mock } from "bun:test";

// Author monitoring adds new titles by itself, so the guards matter more than
// the happy path: the monitorFrom cutoff (otherwise switching monitoring on
// imports a whole backlist) and not advancing lastCheckedAt through a provider
// outage (otherwise titles published during the outage are never seen).

type Volume = {
  volumeId: string;
  title: string;
  publishedYear: number | null;
};

const state: {
  booksEnabled: boolean;
  authors: Array<Record<string, unknown>>;
  volumes: Volume[];
  providerThrows: Error | null;
  knownVolumeIds: string[];
  addCalls: Array<Record<string, unknown>>;
  addResult: Record<string, unknown>;
  authorUpdates: Array<{
    where: { id: number };
    data: Record<string, unknown>;
  }>;
  notices: Array<{ author: string; titles: string[] }>;
} = {
  booksEnabled: true,
  authors: [],
  volumes: [],
  providerThrows: null,
  knownVolumeIds: [],
  addCalls: [],
  addResult: { added: true, bookId: 1, created: true },
  authorUpdates: [],
  notices: [],
};

mock.module("@rawkoon/api/db", () => ({
  prisma: {
    appSettings: {
      findUnique: () => Promise.resolve({ booksEnabled: state.booksEnabled }),
    },
    author: {
      findMany: () => Promise.resolve(state.authors),
      update: (args: {
        where: { id: number };
        data: Record<string, unknown>;
      }) => {
        state.authorUpdates.push(args);
        return Promise.resolve({});
      },
    },
    libraryBook: {
      findMany: () =>
        Promise.resolve(
          state.knownVolumeIds.map((googleVolumeId) => ({ googleVolumeId })),
        ),
    },
  },
}));

const realBooks = await import("@rawkoon/api/services/books");
mock.module("@rawkoon/api/services/books", () => ({
  ...realBooks,
  getBookMetadataProvider: () =>
    Promise.resolve({
      source: "googlebooks" as const,
      searchBooks: () => Promise.resolve([]),
      getBook: () => Promise.resolve(null),
      resolveIsbn: () => Promise.resolve(null),
      getAuthorBooks: () => {
        if (state.providerThrows) return Promise.reject(state.providerThrows);
        return Promise.resolve(state.volumes);
      },
    }),
}));

mock.module("@rawkoon/api/services/books/bookLibrary", () => ({
  addBookFromVolume: (opts: Record<string, unknown>) => {
    state.addCalls.push(opts);
    return Promise.resolve(state.addResult);
  },
  resolveBookProfileId: () => Promise.resolve(null),
}));

mock.module("@rawkoon/api/workers/notifyBookEvents", () => ({
  notifyAdminsAuthorNewReleases: (author: string, titles: string[]) => {
    state.notices.push({ author, titles });
    return Promise.resolve();
  },
  notifyAdminsBookGrabbed: () => Promise.resolve(),
  notifyAdminsBookDownloaded: () => Promise.resolve(),
  notifyAdminsBookImportFailed: () => Promise.resolve(),
  notifyAdminsBookSearchSkipped: () => Promise.resolve(),
}));

const { checkAuthorReleases } = await import(
  "@rawkoon/api/workers/checkAuthorReleases"
);

const author = (over: Record<string, unknown> = {}) => ({
  id: 1,
  googleAuthorName: "Camille Rousseau",
  monitorFrom: new Date("2026-01-01T00:00:00Z"),
  monitorEditionKinds: ["ebook"],
  bookQualityProfileId: 3,
  updatedAt: new Date("2020-01-01T00:00:00Z"),
  ...over,
});

describe("checkAuthorReleases", () => {
  beforeEach(() => {
    state.booksEnabled = true;
    state.authors = [author()];
    state.volumes = [];
    state.providerThrows = null;
    state.knownVolumeIds = [];
    state.addCalls = [];
    state.addResult = { added: true, bookId: 1, created: true };
    state.authorUpdates = [];
    state.notices = [];
  });

  it("does nothing when books are disabled", async () => {
    state.booksEnabled = false;
    state.volumes = [{ volumeId: "v1", title: "New One", publishedYear: 2026 }];

    await checkAuthorReleases();

    expect(state.addCalls).toEqual([]);
    expect(state.authorUpdates).toEqual([]);
  });

  it("adds a title published on or after monitorFrom", async () => {
    state.volumes = [{ volumeId: "v1", title: "New One", publishedYear: 2026 }];

    await checkAuthorReleases();

    expect(state.addCalls).toHaveLength(1);
    expect(state.addCalls[0]?.volumeId).toBe("v1");
    expect(state.addCalls[0]?.kinds).toEqual(["ebook"]);
    expect(state.addCalls[0]?.bookQualityProfileId).toBe(3);
    expect(state.notices[0]?.titles).toEqual(["New One"]);
  });

  // The backlist guard.
  it("ignores titles published before monitorFrom", async () => {
    state.volumes = [
      { volumeId: "old", title: "Backlist", publishedYear: 2015 },
      { volumeId: "new", title: "Current", publishedYear: 2026 },
    ];

    await checkAuthorReleases();

    expect(state.addCalls.map((c) => c.volumeId)).toEqual(["new"]);
  });

  it("ignores titles with no publication year, which cannot be dated", async () => {
    state.volumes = [{ volumeId: "v1", title: "Undated", publishedYear: null }];

    await checkAuthorReleases();

    expect(state.addCalls).toEqual([]);
  });

  it("skips volumes already in the library", async () => {
    state.volumes = [{ volumeId: "v1", title: "Known", publishedYear: 2026 }];
    state.knownVolumeIds = ["v1"];

    await checkAuthorReleases();

    expect(state.addCalls).toEqual([]);
    expect(state.notices).toEqual([]);
    // Still a completed check, so the timestamp advances.
    expect(state.authorUpdates).toHaveLength(1);
  });

  it("falls back to the ebook edition when no kind is configured", async () => {
    state.authors = [author({ monitorEditionKinds: [] })];
    state.volumes = [{ volumeId: "v1", title: "New One", publishedYear: 2026 }];

    await checkAuthorReleases();

    expect(state.addCalls[0]?.kinds).toEqual(["ebook"]);
  });

  // Without monitorFrom, the year monitoring was switched on is the boundary.
  it("uses the row's own updatedAt year when monitorFrom is unset", async () => {
    state.authors = [
      author({
        monitorFrom: null,
        updatedAt: new Date("2026-03-01T00:00:00Z"),
      }),
    ];
    state.volumes = [
      { volumeId: "old", title: "Older", publishedYear: 2025 },
      { volumeId: "new", title: "Newer", publishedYear: 2026 },
    ];

    await checkAuthorReleases();

    expect(state.addCalls.map((c) => c.volumeId)).toEqual(["new"]);
  });

  it("does not advance lastCheckedAt when the provider is unavailable", async () => {
    const { BookProviderUnavailableError } = realBooks;
    state.providerThrows = new BookProviderUnavailableError("503", 503);
    state.volumes = [{ volumeId: "v1", title: "New One", publishedYear: 2026 }];

    await checkAuthorReleases();

    expect(state.addCalls).toEqual([]);
    expect(state.authorUpdates).toEqual([]);
  });

  it("records the check even when nothing new was found", async () => {
    await checkAuthorReleases();

    expect(state.authorUpdates).toHaveLength(1);
    expect(state.authorUpdates[0]?.data.lastCheckedAt).toBeInstanceOf(Date);
    expect(state.notices).toEqual([]);
  });

  // A volume that already existed is not news, so it must not be announced.
  it("does not announce a volume that was already in the library", async () => {
    state.volumes = [
      { volumeId: "v1", title: "Existing", publishedYear: 2026 },
    ];
    state.addResult = { added: true, bookId: 1, created: false };

    await checkAuthorReleases();

    expect(state.addCalls).toHaveLength(1);
    expect(state.notices).toEqual([]);
  });
});
