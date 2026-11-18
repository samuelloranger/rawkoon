import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dbModule } from "./mocks/prisma";
import { makeNotifyLibraryEventsMock } from "./mocks/notifyLibraryEvents";

const dir = mkdtempSync(join(tmpdir(), "grab-existing-"));
const onDisk = join(dir, "Movie (2024).mkv");
writeFileSync(onDisk, "x");

let mediaType = "movie";
let files: { filePath: string }[] = [];
const historyCreate = mock(async (..._: unknown[]) => ({ id: 7 }));
const mediaUpdate = mock(async (..._: unknown[]) => ({}));
const mediaFileFindMany = mock(async (..._: unknown[]) => files);

mock.module("@rawkoon/api/workers/notifyLibraryEvents", () =>
  makeNotifyLibraryEventsMock(),
);
mock.module("@rawkoon/api/db", () =>
  dbModule({
    prisma: {
      libraryMedia: {
        findUnique: async () => ({ id: 1, type: mediaType }),
        update: mediaUpdate,
      },
      libraryEpisode: { update: async () => ({}) },
      mediaFile: { findMany: mediaFileFindMany },
      downloadHistory: {
        findFirst: async () => null,
        create: historyCreate,
        update: async () => ({}),
      },
    },
  }),
);
mock.module("@rawkoon/api/services/downloadClient/registry", () => ({
  buildAdapter: (type: string) => ({ type }),
  resolveActiveAdapter: async () => ({
    adapter: {
      type: "transmission",
      addTorrent: async () => ({ hash: "h" }),
      listTorrents: async () => [],
      getTorrent: async () => null,
      pause: async () => {},
      resume: async () => {},
      remove: async () => {},
      testConnection: async () => ({ ok: true }),
    },
    label: "rawkoon",
  }),
}));
mock.module("@rawkoon/api/services/mediaGrabber/mediaGrabberHelpers", () => ({
  checkBlocklist: async () => null,
  infoHashFromTorrentBuffer: () => null,
  prowlarrHeadersForTorrentUrl: async () => ({}),
  qbCategoryForLibraryType: () => "rawkoon-movies",
  qualityJsonValue: () => null,
}));
mock.module("@rawkoon/api/utils/activityLogs", () => ({
  logActivity: async () => {},
}));

const MAGNET = "magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567";

async function grab(extra: Record<string, unknown> = {}) {
  const { grabRelease } = await import(
    "@rawkoon/api/services/mediaGrabber/mediaGrabberGrab"
  );
  const result = await grabRelease({
    mediaId: 1,
    downloadUrl: MAGNET,
    releaseTitle: "Movie 2024 2160p",
    ...extra,
  });
  expect(result.grabbed).toBe(true);
  const data = (
    historyCreate.mock.calls[0]?.[0] as { data: { isUpgrade: boolean } }
  ).data;
  const status = (
    mediaUpdate.mock.calls.at(-1)?.[0] as { data: { status: string } }
  )?.data.status;
  return { isUpgrade: data.isUpgrade, status };
}

describe("grabRelease over an existing library file", () => {
  beforeEach(() => {
    mediaType = "movie";
    files = [];
    historyCreate.mockClear();
    mediaUpdate.mockClear();
    mediaFileFindMany.mockClear();
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("flags a movie grab as an upgrade when its file is on disk", async () => {
    files = [{ filePath: onDisk }];
    expect(await grab()).toEqual({ isUpgrade: true, status: "upgrading" });
  });

  it("leaves it a plain grab when the recorded file is gone from disk", async () => {
    files = [{ filePath: join(dir, "missing.mkv") }];
    expect(await grab()).toEqual({ isUpgrade: false, status: "downloading" });
  });

  it("keeps an explicit upgrade without looking for files", async () => {
    expect(await grab({ isUpgrade: true })).toEqual({
      isUpgrade: true,
      status: "upgrading",
    });
    expect(mediaFileFindMany).not.toHaveBeenCalled();
  });

  it("never flags a season pack, which imports per episode", async () => {
    mediaType = "show";
    files = [{ filePath: onDisk }];
    const { isUpgrade } = await grab({
      season: 1,
      releaseTitle: "Show S01 2160p",
    });
    expect(isUpgrade).toBe(false);
    expect(mediaFileFindMany).not.toHaveBeenCalled();
  });
});
