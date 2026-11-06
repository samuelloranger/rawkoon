import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  mock,
} from "bun:test";
import {
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const realDb = { ...(await import("@rawkoon/api/db")) };
type FileRow = {
  id: number;
  mediaId: number | null;
  episodeId: number | null;
  filePath: string;
};
let rows: FileRow[] = [];
let root = "";
const deleted: number[] = [];
const originalRemaps = {
  MEDIA_PATH_FROM: Bun.env.MEDIA_PATH_FROM,
  MEDIA_PATH_TO: Bun.env.MEDIA_PATH_TO,
  MEDIA_PATH_REMAP: Bun.env.MEDIA_PATH_REMAP,
};

mock.module("@rawkoon/api/db", () => ({
  prisma: {
    mediaFile: {
      findMany: async ({
        where,
      }: {
        where: {
          mediaId?: number;
          episodeId?: number;
          filePath: string | { not: string } | { in: string[] };
        };
      }) =>
        rows.filter((row) => {
          if (typeof where.filePath === "string")
            return row.filePath === where.filePath;
          if ("in" in where.filePath)
            return where.filePath.in.includes(row.filePath);
          return (
            row.mediaId === where.mediaId &&
            row.episodeId === where.episodeId &&
            row.filePath !== where.filePath.not
          );
        }),
      deleteMany: async ({ where }: { where: { id: { in: number[] } } }) => {
        deleted.push(...where.id.in);
        rows = rows.filter((row) => !where.id.in.includes(row.id));
      },
    },
  },
}));

const { cleanupPackUpgrade } = await import(
  "@rawkoon/api/services/postProcessor/cleanupPackUpgrade"
);
afterAll(() => mock.module("@rawkoon/api/db", () => realDb));
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "pack-upgrade-"));
  rows = [];
  deleted.length = 0;
  delete Bun.env.MEDIA_PATH_FROM;
  delete Bun.env.MEDIA_PATH_TO;
  delete Bun.env.MEDIA_PATH_REMAP;
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  for (const [key, value] of Object.entries(originalRemaps)) {
    if (value === undefined) delete Bun.env[key];
    else Bun.env[key] = value;
  }
});

function file(
  id: number,
  name: string,
  episodeId: number | null = 10,
  mediaId: number | null = 7,
  content = "old",
) {
  const filePath = join(root, name);
  writeFileSync(filePath, content);
  rows.push({ id, filePath, episodeId, mediaId });
  return filePath;
}
function clean(destinationPath: string) {
  return cleanupPackUpgrade({ mediaId: 7, episodeId: 10, destinationPath });
}

describe("season-pack upgrade cleanup", () => {
  it("removes the replaced library path and row while preserving the destination", async () => {
    const old = file(1, "episode-720p.mkv");
    const destination = file(2, "episode-1080p.mp4", 10, 7, "upgraded");
    await clean(destination);
    expect(existsSync(old)).toBe(false);
    expect(readFileSync(destination, "utf8")).toBe("upgraded");
    expect(deleted).toEqual([1]);
  });
  it("leaves another episode and another media item's file alone", async () => {
    const otherEpisode = file(1, "episode-11.mkv", 11);
    const otherMedia = file(2, "other-show.mkv", 10, 8);
    const destination = file(3, "upgraded.mkv");
    await clean(destination);
    expect(existsSync(otherEpisode)).toBe(true);
    expect(existsSync(otherMedia)).toBe(true);
    expect(deleted).toEqual([]);
  });
  it("preserves a path referenced by another episode, deleting only the replaced row", async () => {
    const old = file(1, "shared.mkv");
    rows.push({ id: 2, mediaId: 7, episodeId: 11, filePath: old });
    await clean(file(3, "upgraded.mkv"));
    expect(existsSync(old)).toBe(true);
    expect(rows.map((row) => row.id)).toEqual([2, 3]);
  });
  it("preserves a path referenced by a movie with no episode", async () => {
    const old = file(1, "shared.mkv");
    rows.push({ id: 2, mediaId: 8, episodeId: null, filePath: old });
    await clean(file(3, "upgraded.mkv"));
    expect(existsSync(old)).toBe(true);
    expect(deleted).toEqual([1]);
  });
  it("removes stale rows when the old file is already missing", async () => {
    const old = file(1, "gone.mkv");
    rmSync(old);
    await clean(file(2, "upgraded.mkv"));
    expect(deleted).toEqual([1]);
  });
  it("retains rows for paths that cannot be unlinked", async () => {
    const old = join(root, "directory.mkv");
    mkdirSync(old);
    rows.push({ id: 1, mediaId: 7, episodeId: 10, filePath: old });
    await clean(file(2, "upgraded.mkv"));
    expect(existsSync(old)).toBe(true);
    expect(deleted).toEqual([]);
  });
  it("keeps the original torrent hardlink intact", async () => {
    const old = file(1, "old-library.mkv");
    const source = join(root, "seeding-source.mkv");
    linkSync(old, source);
    await clean(file(2, "upgraded.mkv"));
    expect(existsSync(old)).toBe(false);
    expect(readFileSync(source, "utf8")).toBe("old");
  });
  it("removes the actual old file when its stored host path is remapped", async () => {
    const diskPath = file(1, "old.mkv");
    rows[0]!.filePath = "/host/old.mkv";
    Bun.env.MEDIA_PATH_FROM = "/host";
    Bun.env.MEDIA_PATH_TO = root;
    await clean(file(2, "new.mkv"));
    expect(existsSync(diskPath)).toBe(false);
    expect(deleted).toEqual([1]);
  });
  it("preserves the destination when an old host-path row resolves to the same file", async () => {
    const destination = file(2, "new.mkv", 10, 7, "new content");
    rows.push({ id: 1, mediaId: 7, episodeId: 10, filePath: "/host/new.mkv" });
    Bun.env.MEDIA_PATH_FROM = "/host";
    Bun.env.MEDIA_PATH_TO = root;
    await clean(destination);
    expect(readFileSync(destination, "utf8")).toBe("new content");
    expect(deleted).toEqual([1]);
  });
  it("preserves another episode's file referenced through a different configured alias", async () => {
    const diskPath = file(1, "shared.mkv");
    rows[0]!.filePath = "/first/shared.mkv";
    rows.push({
      id: 2,
      mediaId: 7,
      episodeId: 11,
      filePath: "/second/shared.mkv",
    });
    Bun.env.MEDIA_PATH_REMAP = `/first:${root},/second:${root}`;
    await clean(file(3, "new.mkv"));
    expect(readFileSync(diskPath, "utf8")).toBe("old");
    expect(rows.map((row) => row.id)).toEqual([2, 3]);
  });
});
