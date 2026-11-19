import { describe, it, expect, mock, afterAll, beforeEach } from "bun:test";

const EPOCH = new Date("2026-06-19T00:00:00Z");

type FakeUser = {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  isAdmin: boolean | null;
  locale: string | null;
  lastLogin: Date | null;
  createdAt: Date | null;
  lastActivity: Date | null;
  avatarUrl: string | null;
  navPosition: string | null;
  name: string;
} | null;

let injectedDbUser: FakeUser = null;
let dhRow: {
  id: number;
  mediaId: number;
  torrentHash: string | null;
  episodeId: number | null;
  postProcessDestinationPath: string | null;
} | null = null;
const deleted: number[] = [];
const qbCalls: Array<{ fn: string; hash: string; delete_files?: boolean }> = [];
// dhCountCalls tracks calls to downloadHistory.count, which revertLibraryDownloadingIfNoOtherActiveGrabs
// makes to check whether other active grabs exist. Used to assert the revert was invoked.
const dhCountCalls: Array<unknown> = [];
let pauseSucceeds = true;
let sameHashRows = 0;
let torrentList: Array<Record<string, unknown>> = [];

mock.module("@rawkoon/api/db", () => ({
  prisma: {
    libraryMedia: {
      findUnique: async () => ({ id: 1 }),
      updateMany: async () => ({ count: 0 }),
    },
    libraryEpisode: {
      updateMany: async () => ({ count: 0 }),
    },
    downloadHistory: {
      findFirst: async () => dhRow,
      count: async (args: { where?: { torrentHash?: string } }) => {
        if (args.where?.torrentHash) return sameHashRows;
        dhCountCalls.push(args);
        return 0;
      },
      delete: async ({ where }: { where: { id: number } }) => {
        deleted.push(where.id);
        return {};
      },
    },
    libraryAttentionAlert: { updateMany: async () => ({ count: 0 }) },
    $transaction: async (ops: unknown[]) =>
      Promise.all(ops as Promise<unknown>[]),
    user: {
      findUnique: async () => injectedDbUser,
    },
  },
}));
mock.module("@rawkoon/api/lib/auth", () => ({
  auth: {
    api: {
      getSession: async () =>
        injectedDbUser ? { user: { id: injectedDbUser.id } } : null,
    },
    handler: async () => new Response("", { status: 404 }),
  },
  refreshOidcProviders: () => {},
}));
mock.module("@rawkoon/api/services/downloadClient/registry", () => ({
  buildAdapter: (type: string) => ({ type }),
  resolveActiveAdapter: async () => ({
    label: "rawkoon",
    adapter: {
      type: "transmission",
      testConnection: async () => ({ ok: true }),
      addTorrent: async () => ({ hash: null }),
      listTorrents: async () => torrentList,
      getTorrent: async () => null,
      pause: async (hash: string) => {
        qbCalls.push({ fn: "pause", hash });
        if (!pauseSucceeds) throw new Error("boom");
      },
      resume: async (hash: string) => {
        qbCalls.push({ fn: "resume", hash });
      },
      remove: async (hash: string, deleteFiles: boolean) => {
        qbCalls.push({ fn: "delete", hash, delete_files: deleteFiles });
      },
    },
  }),
}));

const { libraryFilesRoutes } = await import(
  "@rawkoon/api/routes/library/libraryFilesRoutes"
);

afterAll(() => mock.restore());

const ADMIN_USER: NonNullable<FakeUser> = {
  id: "u1",
  email: "admin@test.com",
  firstName: "Test",
  lastName: "User",
  isAdmin: true,
  locale: "en",
  lastLogin: null,
  createdAt: EPOCH,
  lastActivity: null,
  avatarUrl: null,
  navPosition: null,
  name: "Test User",
};

beforeEach(() => {
  injectedDbUser = ADMIN_USER;
  dhRow = {
    id: 5,
    mediaId: 1,
    torrentHash: "h1",
    episodeId: null,
    postProcessDestinationPath: "/lib/a.mkv",
  };
  deleted.length = 0;
  qbCalls.length = 0;
  dhCountCalls.length = 0;
  pauseSucceeds = true;
  sameHashRows = 0;
  torrentList = [{ hash: "h1", name: "T1", contentPath: "/dl/T1" }];
});

function post(body: Record<string, unknown>, dhId = 5) {
  return libraryFilesRoutes.request(
    new Request(`http://localhost/1/downloads/${dhId}/action`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

describe("POST /:id/downloads/:dhId/action", () => {
  it("pause calls pauseQbittorrentTorrent with the hash", async () => {
    const res = await post({ action: "pause" });
    expect(res.status).toBe(200);
    expect(qbCalls).toEqual([{ fn: "pause", hash: "h1" }]);
  });

  it("resume calls resumeQbittorrentTorrent", async () => {
    const res = await post({ action: "resume" });
    expect(res.status).toBe(200);
    expect(qbCalls[0].fn).toBe("resume");
  });

  it("remove deletes the torrent, its files and the DH row for an imported download", async () => {
    const res = await post({ action: "remove" });
    expect(res.status).toBe(200);
    expect(qbCalls).toEqual([{ fn: "delete", hash: "h1", delete_files: true }]);
    expect(deleted).toEqual([5]);
  });

  it("remove with delete_files false keeps the files", async () => {
    await post({ action: "remove", delete_files: false });
    expect(qbCalls[0].delete_files).toBe(false);
  });

  it("remove keeps the files of a row that was never imported unless asked", async () => {
    dhRow = { ...dhRow!, postProcessDestinationPath: null };
    await post({ action: "remove" });
    expect(qbCalls[0].delete_files).toBe(false);
    await post({ action: "remove", delete_files: true });
    expect(qbCalls[1].delete_files).toBe(true);
  });

  it("remove keeps the files when a regrab row shares the torrent hash", async () => {
    sameHashRows = 1;
    await post({ action: "remove", delete_files: true });
    expect(qbCalls[0].delete_files).toBe(false);
  });

  it("remove keeps the files when another torrent shares the content", async () => {
    torrentList.push({ hash: "h2", name: "T2", contentPath: "/dl/T1" });
    await post({ action: "remove" });
    expect(qbCalls[0].delete_files).toBe(false);
  });

  it("remove of a row with no hash still deletes the DH row", async () => {
    dhRow = {
      id: 5,
      mediaId: 1,
      torrentHash: null,
      episodeId: null,
      postProcessDestinationPath: null,
    };
    const res = await post({ action: "remove" });
    expect(res.status).toBe(200);
    expect(qbCalls.length).toBe(0);
    expect(deleted).toEqual([5]);
  });

  it("pause with no hash returns 400", async () => {
    dhRow = {
      id: 5,
      mediaId: 1,
      torrentHash: null,
      episodeId: null,
      postProcessDestinationPath: null,
    };
    const res = await post({ action: "pause" });
    expect(res.status).toBe(400);
    expect(qbCalls.length).toBe(0);
  });

  it("missing DH row returns 404", async () => {
    dhRow = null;
    const res = await post({ action: "pause" });
    expect(res.status).toBe(404);
  });

  it("non-admin returns 403", async () => {
    injectedDbUser = { ...ADMIN_USER, isAdmin: false };
    const res = await post({ action: "pause" });
    expect(res.status).toBe(403);
    expect(qbCalls.length).toBe(0);
  });

  it("pause failure returns 500", async () => {
    pauseSucceeds = false;
    const res = await post({ action: "pause" });
    expect(res.status).toBe(500);
  });

  // revertLibraryDownloadingIfNoOtherActiveGrabs is verified indirectly: the real
  // function issues a downloadHistory.count query to check for other active grabs
  // before deciding whether to revert status. Our DB mock intercepts that call.
  // We avoid mocking @rawkoon/api/workers/checkDownloadCompletion at the module
  // level because bun's mock.module is process-global and a stub for
  // completeDownloadByHash would break completeDownloadByHash.test.ts which imports
  // the real implementation.
  it("remove invokes revertLibraryDownloadingIfNoOtherActiveGrabs (verified via dhCountCall)", async () => {
    const res = await post({ action: "remove" });
    expect(res.status).toBe(200);
    // The revert function issues a count query to check for other active grabs.
    expect(dhCountCalls.length).toBeGreaterThan(0);
    expect(deleted).toEqual([5]);
  });

  it("remove deletes the DH row after calling revert", async () => {
    await post({ action: "remove" });
    expect(deleted).toEqual([5]);
  });

  it("pause does NOT invoke revertLibraryDownloadingIfNoOtherActiveGrabs", async () => {
    await post({ action: "pause" });
    // Pause does not trigger any revert count check
    expect(dhCountCalls.length).toBe(0);
  });

  it("resume does NOT invoke revertLibraryDownloadingIfNoOtherActiveGrabs", async () => {
    await post({ action: "resume" });
    expect(dhCountCalls.length).toBe(0);
  });
});
