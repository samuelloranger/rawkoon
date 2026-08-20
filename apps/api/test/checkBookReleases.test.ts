import { describe, it, expect, beforeEach, mock } from "bun:test";

// The scheduled book sweep. Two behaviours carry the weight: the failed-search
// counter (without it an unavailable title is searched forever) and the cutoff
// comparison (without it every downloaded book is re-searched forever).

type Edition = {
  id: number;
  searchAttempts: number;
  book: { title: string };
};

type UpgradeEdition = {
  id: number;
  files: { format: string }[];
  bookQualityProfile: {
    allowedFormats: string[];
    cutoffFormat: string | null;
  } | null;
};

const state: {
  booksEnabled: boolean;
  wanted: Edition[];
  upgradable: UpgradeEdition[];
  editionUpdates: Array<{
    where: { id: number };
    data: Record<string, unknown>;
  }>;
  autoGrabCalls: number[];
  autoGrabResult: { grabbed: boolean; reason?: string; releaseTitle?: string };
  searchCalls: number[];
  searchResult: {
    releases: Array<Record<string, unknown>>;
    error?: string;
  };
  grabCalls: Array<Record<string, unknown>>;
  skippedNotices: Array<{ editionId: number; reason: string }>;
} = {
  booksEnabled: true,
  wanted: [],
  upgradable: [],
  editionUpdates: [],
  autoGrabCalls: [],
  autoGrabResult: { grabbed: false, reason: "No matching releases found" },
  searchCalls: [],
  searchResult: { releases: [] },
  grabCalls: [],
  skippedNotices: [],
};

mock.module("@rawkoon/api/db", () => ({
  prisma: {
    appSettings: {
      findUnique: () => Promise.resolve({ booksEnabled: state.booksEnabled }),
    },
    bookEdition: {
      findMany: (args: { where: Record<string, unknown> }) =>
        Promise.resolve(
          args.where.status === "downloaded" ? state.upgradable : state.wanted,
        ),
      update: (args: {
        where: { id: number };
        data: Record<string, unknown>;
      }) => {
        state.editionUpdates.push(args);
        return Promise.resolve({ bookId: 1 });
      },
    },
  },
}));

const realGrabber = await import("@rawkoon/api/services/books/bookGrabber");
mock.module("@rawkoon/api/services/books/bookGrabber", () => ({
  ...realGrabber,
  searchAndGrabBook: (editionId: number) => {
    state.autoGrabCalls.push(editionId);
    return Promise.resolve(state.autoGrabResult);
  },
  searchBookReleases: (editionId: number) => {
    state.searchCalls.push(editionId);
    return Promise.resolve(state.searchResult);
  },
  grabBookRelease: (opts: Record<string, unknown>) => {
    state.grabCalls.push(opts);
    return Promise.resolve({ grabbed: true, releaseTitle: opts.releaseTitle });
  },
}));

mock.module("@rawkoon/api/workers/notifyBookEvents", () => ({
  notifyAdminsBookSearchSkipped: (editionId: number, reason: string) => {
    state.skippedNotices.push({ editionId, reason });
    return Promise.resolve();
  },
  notifyAdminsBookGrabbed: () => Promise.resolve(),
  notifyAdminsBookDownloaded: () => Promise.resolve(),
  notifyAdminsBookImportFailed: () => Promise.resolve(),
  notifyAdminsAuthorNewReleases: () => Promise.resolve(),
}));

const { checkBookReleases, searchWantedBookEditions, searchBookUpgrades } =
  await import("@rawkoon/api/workers/checkBookReleases");

const release = (over: Record<string, unknown> = {}) => ({
  title: "Some Release",
  format: "epub",
  rejected: false,
  download_url: "magnet:?xt=urn:btih:1",
  magnet_url: null,
  indexer: "test",
  score: 10,
  ...over,
});

describe("checkBookReleases", () => {
  beforeEach(() => {
    state.booksEnabled = true;
    state.wanted = [];
    state.upgradable = [];
    state.editionUpdates = [];
    state.autoGrabCalls = [];
    state.autoGrabResult = {
      grabbed: false,
      reason: "No matching releases found",
    };
    state.searchCalls = [];
    state.searchResult = { releases: [] };
    state.grabCalls = [];
    state.skippedNotices = [];
  });

  // A movies-only install must never touch an indexer for books.
  it("does nothing at all when books are disabled", async () => {
    state.booksEnabled = false;
    state.wanted = [{ id: 1, searchAttempts: 0, book: { title: "A" } }];

    await checkBookReleases();

    expect(state.autoGrabCalls).toEqual([]);
    expect(state.searchCalls).toEqual([]);
  });

  it("searches every wanted edition and leaves the counter alone on a grab", async () => {
    state.wanted = [
      { id: 1, searchAttempts: 3, book: { title: "A" } },
      { id: 2, searchAttempts: 0, book: { title: "B" } },
    ];
    state.autoGrabResult = { grabbed: true, releaseTitle: "x" };

    await searchWantedBookEditions();

    expect(state.autoGrabCalls).toEqual([1, 2]);
    // grabBookRelease owns the counter on a successful grab; the sweep must not
    // bump it a second time.
    expect(state.editionUpdates).toEqual([]);
  });

  it("bumps the attempt counter when a search finds nothing", async () => {
    state.wanted = [{ id: 7, searchAttempts: 4, book: { title: "A" } }];

    await searchWantedBookEditions();

    expect(state.editionUpdates).toHaveLength(1);
    expect(state.editionUpdates[0]?.data.searchAttempts).toBe(5);
    expect(state.editionUpdates[0]?.data.status).toBeUndefined();
    expect(state.skippedNotices).toEqual([]);
  });

  it("gives up at the attempt cap, marks the edition skipped, and says so", async () => {
    state.wanted = [{ id: 7, searchAttempts: 23, book: { title: "A" } }];

    await searchWantedBookEditions();

    expect(state.editionUpdates[0]?.data.searchAttempts).toBe(24);
    expect(state.editionUpdates[0]?.data.status).toBe("skipped");
    expect(state.skippedNotices).toHaveLength(1);
    expect(state.skippedNotices[0]?.editionId).toBe(7);
  });

  // One failing edition must not stop the sweep.
  it("keeps going after a search throws", async () => {
    state.wanted = [
      { id: 1, searchAttempts: 0, book: { title: "A" } },
      { id: 2, searchAttempts: 0, book: { title: "B" } },
    ];
    let first = true;
    mock.module("@rawkoon/api/services/books/bookGrabber", () => ({
      ...realGrabber,
      searchAndGrabBook: (editionId: number) => {
        state.autoGrabCalls.push(editionId);
        if (first) {
          first = false;
          return Promise.reject(new Error("indexer exploded"));
        }
        return Promise.resolve({ grabbed: true, releaseTitle: "x" });
      },
      searchBookReleases: () => Promise.resolve(state.searchResult),
      grabBookRelease: () => Promise.resolve({ grabbed: true }),
    }));

    await searchWantedBookEditions();

    expect(state.autoGrabCalls).toEqual([1, 2]);

    // Restore for the tests that follow.
    mock.module("@rawkoon/api/services/books/bookGrabber", () => ({
      ...realGrabber,
      searchAndGrabBook: (editionId: number) => {
        state.autoGrabCalls.push(editionId);
        return Promise.resolve(state.autoGrabResult);
      },
      searchBookReleases: (editionId: number) => {
        state.searchCalls.push(editionId);
        return Promise.resolve(state.searchResult);
      },
      grabBookRelease: (opts: Record<string, unknown>) => {
        state.grabCalls.push(opts);
        return Promise.resolve({ grabbed: true });
      },
    }));
  });
});

describe("searchBookUpgrades", () => {
  beforeEach(() => {
    state.upgradable = [];
    state.searchCalls = [];
    state.grabCalls = [];
    state.searchResult = { releases: [] };
  });

  // The entire point of a cutoff: an edition that has reached it is finished.
  it("does not search an edition already at its cutoff", async () => {
    state.upgradable = [
      {
        id: 1,
        files: [{ format: "epub" }],
        bookQualityProfile: {
          allowedFormats: ["epub", "azw3", "pdf"],
          cutoffFormat: "epub",
        },
      },
    ];

    await searchBookUpgrades();

    expect(state.searchCalls).toEqual([]);
  });

  it("searches an edition below its cutoff and grabs a strictly better format", async () => {
    state.upgradable = [
      {
        id: 5,
        files: [{ format: "pdf" }],
        bookQualityProfile: {
          allowedFormats: ["epub", "azw3", "pdf"],
          cutoffFormat: "epub",
        },
      },
    ];
    state.searchResult = { releases: [release({ format: "epub" })] };

    await searchBookUpgrades();

    expect(state.searchCalls).toEqual([5]);
    expect(state.grabCalls).toHaveLength(1);
    expect(state.grabCalls[0]?.isUpgrade).toBe(true);
    expect(state.grabCalls[0]?.editionId).toBe(5);
  });

  it("ignores a release no better than what is already held", async () => {
    state.upgradable = [
      {
        id: 5,
        files: [{ format: "azw3" }],
        bookQualityProfile: {
          allowedFormats: ["epub", "azw3", "pdf"],
          cutoffFormat: "epub",
        },
      },
    ];
    state.searchResult = { releases: [release({ format: "pdf" })] };

    await searchBookUpgrades();

    expect(state.grabCalls).toEqual([]);
  });

  it("ignores rejected releases even when the format would be an upgrade", async () => {
    state.upgradable = [
      {
        id: 5,
        files: [{ format: "pdf" }],
        bookQualityProfile: {
          allowedFormats: ["epub", "pdf"],
          cutoffFormat: "epub",
        },
      },
    ];
    state.searchResult = {
      releases: [release({ format: "epub", rejected: true })],
    };

    await searchBookUpgrades();

    expect(state.grabCalls).toEqual([]);
  });

  // An edition holding both formats is only below cutoff if even its best is.
  it("judges by the best format held, not the worst", async () => {
    state.upgradable = [
      {
        id: 5,
        files: [{ format: "pdf" }, { format: "epub" }],
        bookQualityProfile: {
          allowedFormats: ["epub", "pdf"],
          cutoffFormat: "epub",
        },
      },
    ];

    await searchBookUpgrades();

    expect(state.searchCalls).toEqual([]);
  });

  it("skips an edition with no profile, since there is no cutoff to compare to", async () => {
    state.upgradable = [
      { id: 5, files: [{ format: "pdf" }], bookQualityProfile: null },
    ];

    await searchBookUpgrades();

    expect(state.searchCalls).toEqual([]);
  });
});
