import { describe, it, expect, mock, afterAll, beforeEach } from "bun:test";

let dhRows: Array<{
  id: number;
  releaseTitle: string;
  indexer: string | null;
  torrentHash: string | null;
  grabbedAt: Date;
  completedAt: Date | null;
  failed: boolean;
  failReason: string | null;
  episodeId: number | null;
  postProcessError: string | null;
  postProcessDestinationPath: string | null;
  aiPicked: boolean;
}> = [];
let qbEnabled = true;

const EPOCH = new Date("2026-06-20T00:00:00Z");

mock.module("@rawkoon/api/db", () => ({
  prisma: {
    user: {
      findUnique: async () => ({
        id: "u1",
        email: "test@example.com",
        firstName: "Test",
        lastName: "User",
        isAdmin: true,
        locale: null,
        lastLogin: null,
        createdAt: null,
        lastActivity: null,
        avatarUrl: null,
        navPosition: null,
      }),
    },
    libraryMedia: { findUnique: async () => ({ id: 1 }) },
    downloadHistory: { findMany: async () => dhRows },
  },
}));
mock.module("@rawkoon/api/lib/auth", () => ({
  auth: {
    api: { getSession: async () => ({ user: { id: "u1" } }) },
    handler: async () => new Response("", { status: 404 }),
  },
  refreshOidcProviders: () => {},
}));
mock.module("@rawkoon/api/services/qbittorrent/config", () => ({
  getQbittorrentIntegrationConfig: async () => ({
    enabled: qbEnabled,
    config: qbEnabled ? ({} as never) : null,
  }),
  normalizeQbittorrentConfig: () => null,
  invalidateQbittorrentIntegrationConfigCache: async () => {},
}));
mock.module("@rawkoon/api/services/qbittorrent/torrentQueries", () => ({
  fetchQbittorrentTorrents: async (
    _c: unknown,
    _e: boolean,
    hashes: string[],
  ) => ({
    enabled: true,
    connected: true,
    torrents: hashes.includes("h1")
      ? [
          {
            id: "h1",
            name: "A",
            progress: 0.43,
            download_speed: 8000000,
            eta_seconds: 360,
            state: "downloading",
          },
        ]
      : [],
  }),
  // Stub unused exports so the mock module satisfies all import sites
  fetchQbittorrentTorrent: async () => ({
    enabled: false,
    connected: false,
    torrent: null,
  }),
  fetchQbittorrentTorrentProperties: async () => ({
    enabled: false,
    connected: false,
    properties: null,
  }),
}));

const { libraryFilesRoutes } = await import(
  "@rawkoon/api/routes/library/libraryFilesRoutes"
);

afterAll(() => mock.restore());

beforeEach(() => {
  qbEnabled = true;
});

const baseRow = {
  indexer: "EZTV",
  failReason: null,
  episodeId: null,
  postProcessError: null,
  postProcessDestinationPath: null,
  aiPicked: false,
  grabbedAt: EPOCH,
};

async function getDownloads() {
  const res = await libraryFilesRoutes.handle(
    new Request("http://localhost/1/downloads"),
  );
  return (await res.json()) as { items: Array<Record<string, unknown>> };
}

describe("GET /:id/downloads live progress", () => {
  it("merges live data onto an in-progress row", async () => {
    dhRows = [
      {
        id: 1,
        releaseTitle: "A",
        torrentHash: "h1",
        completedAt: null,
        failed: false,
        ...baseRow,
      },
    ];
    const json = await getDownloads();
    expect(json.items[0].live).toMatchObject({
      progress: 0.43,
      state: "downloading",
    });
  });

  it("leaves completed rows with live:null and never queries them", async () => {
    dhRows = [
      {
        id: 2,
        releaseTitle: "B",
        torrentHash: "h2",
        completedAt: EPOCH,
        failed: false,
        ...baseRow,
      },
    ];
    const json = await getDownloads();
    expect(json.items[0].live).toBeNull();
  });

  it("leaves failed rows with live:null and never queries them", async () => {
    dhRows = [
      {
        id: 3,
        releaseTitle: "C",
        torrentHash: "h1",
        completedAt: null,
        failed: true,
        ...baseRow,
      },
    ];
    const json = await getDownloads();
    expect(json.items[0].live).toBeNull();
  });

  it("returns live:null for every row when qB disabled", async () => {
    qbEnabled = false;
    dhRows = [
      {
        id: 1,
        releaseTitle: "A",
        torrentHash: "h1",
        completedAt: null,
        failed: false,
        ...baseRow,
      },
    ];
    const json = await getDownloads();
    expect(json.items[0].live).toBeNull();
  });
});
