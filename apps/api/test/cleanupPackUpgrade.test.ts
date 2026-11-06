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

mock.module("@rawkoon/api/db", () => ({
  prisma: {
    mediaFile: {
      findMany: async ({
        where,
      }: {
        where: {
          mediaId?: number;
          episodeId?: number;
          filePath: string | { not: string };
        };
      }) =>
        rows.filter((row) => {
          if (typeof where.filePath === "string")
            return row.filePath === where.filePath;
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
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

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
});
