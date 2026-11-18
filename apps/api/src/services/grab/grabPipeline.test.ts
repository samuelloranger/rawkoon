import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";

// The shared grab pipeline, driven through both adapters (media and book).
// mock.module leaks across files, so each fake delegates to the real module
// once this file's `active` flag is cleared in afterAll.

let active = true;
const gate =
  <A extends unknown[], R>(real: (...a: A) => R, fake: (...a: A) => R) =>
  (...a: A): R =>
    active ? fake(...a) : real(...a);

type Call = { where?: unknown; data?: Record<string, unknown> };
const s = {
  dhCreates: [] as Call[],
  dhUpdates: [] as Call[],
  createError: null as unknown,
  activeBookGrab: null as { id: number } | null,
  clientConfigured: true,
  urlAllowed: true,
  sendResult: {
    ok: true,
    hash: "abc",
  } as unknown,
  adopts: true,
  mediaStatusError: null as Error | null,
  notifyError: null as Error | null,
  hashWriteError: null as Error | null,
  announced: 0,
};

mock.module("@rawkoon/api/db", () => ({
  prisma: {
    grabBlocklist: { findFirst: async () => null },
    mediaSettings: { findUnique: async () => null },
    libraryMedia: {
      findUnique: async () => ({ id: 7, type: "movie" }),
      update: async () => {
        if (s.mediaStatusError) throw s.mediaStatusError;
        return {};
      },
    },
    libraryEpisode: { update: async () => ({}) },
    mediaFile: { findMany: async () => [] },
    bookEdition: {
      findUnique: async () => ({
        kind: "ebook",
        book: {
          title: "T",
          authors: [],
          language: "en",
          seriesName: null,
          seriesPosition: null,
        },
        bookQualityProfile: null,
      }),
      update: async (a: Call) => {
        s.dhUpdates.push({ where: "edition", data: a.data });
        return { bookId: 1 };
      },
    },
    downloadHistory: {
      findFirst: async () => s.activeBookGrab,
      create: async (a: Call) => {
        if (s.createError) throw s.createError;
        s.dhCreates.push(a);
        return { id: 99 };
      },
      update: async (a: Call) => {
        if (a.data?.torrentHash && s.hashWriteError) throw s.hashWriteError;
        s.dhUpdates.push(a);
        return {};
      },
    },
  },
}));

const registry = await import("@rawkoon/api/services/downloadClient/registry");
mock.module("@rawkoon/api/services/downloadClient/registry", () => ({
  ...registry,
  resolveActiveAdapter: gate(registry.resolveActiveAdapter, async () =>
    s.clientConfigured
      ? { adapter: { claimExisting: true } as never, label: "c" }
      : null,
  ),
}));

const send = await import("@rawkoon/api/services/downloadClient/sendRelease");
mock.module("@rawkoon/api/services/downloadClient/sendRelease", () => ({
  ...send,
  sendReleaseToClient: gate(
    send.sendReleaseToClient,
    async () => s.sendResult as never,
  ),
}));

const safe = await import("@rawkoon/api/utils/medias/safeTorrentFetchUrl");
mock.module("@rawkoon/api/utils/medias/safeTorrentFetchUrl", () => ({
  ...safe,
  isServerTorrentFetchUrlAllowed: gate(
    safe.isServerTorrentFetchUrlAllowed,
    async () => s.urlAllowed,
  ),
}));

const conflicts = await import(
  "@rawkoon/api/services/mediaGrabber/mediaGrabberConflicts"
);
mock.module("@rawkoon/api/services/mediaGrabber/mediaGrabberConflicts", () => ({
  ...conflicts,
  findGrabConflict: gate(conflicts.findGrabConflict, async () => null),
}));

const mediaAdopt = await import(
  "@rawkoon/api/services/mediaGrabber/mediaGrabberAdopt"
);
mock.module("@rawkoon/api/services/mediaGrabber/mediaGrabberAdopt", () => ({
  ...mediaAdopt,
  tryAdoptDuplicate: gate(mediaAdopt.tryAdoptDuplicate, async () =>
    s.adopts ? { adopted: true as const, completed: false } : null,
  ),
}));

const bookAdopt = await import("@rawkoon/api/services/books/bookAdopt");
mock.module("@rawkoon/api/services/books/bookAdopt", () => ({
  ...bookAdopt,
  tryAdoptDuplicateForBook: gate(
    bookAdopt.tryAdoptDuplicateForBook,
    async () =>
      s.adopts ? { adopted: true as const, completed: false } : null,
  ),
}));

const activity = await import("@rawkoon/api/utils/activityLogs");
mock.module("@rawkoon/api/utils/activityLogs", () => ({
  ...activity,
  logActivity: gate(activity.logActivity, async () => {
    s.announced++;
  }),
}));

const notifyBook = await import("@rawkoon/api/workers/notifyBookEvents");
mock.module("@rawkoon/api/workers/notifyBookEvents", () => ({
  ...notifyBook,
  notifyAdminsBookGrabbed: gate(
    notifyBook.notifyAdminsBookGrabbed,
    async () => {
      if (s.notifyError) throw s.notifyError;
    },
  ),
}));

const notifyLib = await import("@rawkoon/api/workers/notifyLibraryEvents");
mock.module("@rawkoon/api/workers/notifyLibraryEvents", () => ({
  ...notifyLib,
  notifyAdminsLibraryGrabbed: gate(
    notifyLib.notifyAdminsLibraryGrabbed,
    async () => {
      if (s.notifyError) throw s.notifyError;
    },
  ),
}));

const { grabRelease } = await import(
  "@rawkoon/api/services/mediaGrabber/mediaGrabberGrab"
);
const { grabBookRelease } = await import(
  "@rawkoon/api/services/books/bookGrabber"
);

const magnet = `magnet:?xt=urn:btih:${"a".repeat(40)}`;
const kinds = {
  media: () =>
    grabRelease({ mediaId: 7, downloadUrl: magnet, releaseTitle: "Rel" }),
  book: () =>
    grabBookRelease({
      editionId: 3,
      downloadUrl: magnet,
      releaseTitle: "Rel",
    }),
} as const;

afterAll(() => {
  active = false;
});

for (const [kind, grab] of Object.entries(kinds)) {
  describe(`grab pipeline (${kind})`, () => {
    beforeEach(() => {
      s.dhCreates = [];
      s.dhUpdates = [];
      s.createError = null;
      s.activeBookGrab = null;
      s.clientConfigured = true;
      s.urlAllowed = true;
      s.sendResult = { ok: true, hash: "abc" };
      s.adopts = true;
      s.mediaStatusError = null;
      s.notifyError = null;
      s.hashWriteError = null;
      s.announced = 0;
    });

    it("refuses on preflight without leaving a history row", async () => {
      s.clientConfigured = false;
      const res = await grab();
      expect(res).toMatchObject({
        grabbed: false,
        reason: "No download client configured",
      });
      expect(s.dhCreates).toEqual([]);
      expect(s.dhUpdates).toEqual([]);

      s.clientConfigured = true;
      s.urlAllowed = false;
      const url = "http://10.0.0.1/x.torrent";
      const blocked = await (kind === "media"
        ? grabRelease({ mediaId: 7, downloadUrl: url, releaseTitle: "Rel" })
        : grabBookRelease({
            editionId: 3,
            downloadUrl: url,
            releaseTitle: "Rel",
          }));
      expect(blocked).toMatchObject({
        grabbed: false,
        reason: "Download URL is not allowed for server-side fetch",
      });
      expect(s.dhCreates).toEqual([]);
    });

    it("reports a lost unique-index race without failing a row", async () => {
      s.createError = Object.assign(new Error("dup"), { code: "P2002" });
      const res = await grab();
      expect(res).toMatchObject({ grabbed: false });
      expect((res as { reason: string }).reason).toMatch(/already/i);
      expect(s.dhUpdates).toEqual([]);
    });

    it("adopts a torrent the client already holds", async () => {
      s.sendResult = {
        ok: false,
        stage: "add",
        error: new Error("409"),
        via: "magnet",
        hash: "abc",
      };
      expect(await grab()).toEqual({ grabbed: true, releaseTitle: "Rel" });
      expect(s.dhUpdates).toEqual([]);

      s.adopts = false;
      expect(await grab()).toEqual({ grabbed: false, reason: "409" });
      expect(s.dhUpdates[0]?.data).toMatchObject({ failed: true });
    });

    it("still counts as grabbed when a step after the hand-off throws", async () => {
      s.mediaStatusError = new Error("status write failed");
      s.notifyError = new Error("notify failed");
      expect(await grab()).toEqual({ grabbed: true, releaseTitle: "Rel" });
      expect(s.dhUpdates.some((u) => u.data?.failed)).toBe(false);
      expect(s.dhUpdates.some((u) => u.data?.torrentHash === "abc")).toBe(true);
      expect(s.announced).toBe(1);
    });

    it("still counts as grabbed and marks the target when the hash write fails", async () => {
      s.hashWriteError = new Error("hash write failed");
      expect(await grab()).toEqual({ grabbed: true, releaseTitle: "Rel" });
      expect(s.dhUpdates.some((u) => u.data?.failed)).toBe(false);
      expect(s.announced).toBe(1);
    });
  });
}

describe("book-only behaviour", () => {
  it("refuses when the edition already has an active grab, before any row", async () => {
    s.dhCreates = [];
    s.activeBookGrab = { id: 5 };
    expect(await kinds.book()).toEqual({
      grabbed: false,
      reason: "Already downloading (grab #5)",
    });
    expect(s.dhCreates).toEqual([]);
  });
});
