/**
 * The conflict rule is the correctness-critical piece of reading progress: an
 * offline client flushing a week-old queue must not rewind a position set later
 * on another device.
 */
import { describe, it, expect, beforeEach, mock } from "bun:test";

type Row = {
  editionId: number;
  userId: string;
  locator: string | null;
  percent: number | null;
  positionSecs: number | null;
  fileId: number | null;
  finishedAt: Date | null;
  clientUpdatedAt: Date;
  updatedAt: Date;
};

let rows: Row[] = [];
const upserts: Array<Record<string, unknown>> = [];

const find = (userId: string, editionId: number) =>
  rows.find((r) => r.userId === userId && r.editionId === editionId) ?? null;

mock.module("@rawkoon/api/db", () => ({
  prisma: {
    bookProgress: {
      findUnique: async ({
        where,
      }: {
        where: { userId_editionId: { userId: string; editionId: number } };
      }) =>
        find(where.userId_editionId.userId, where.userId_editionId.editionId),
      findMany: async ({
        where,
      }: {
        where: { userId: string; editionId: { in: number[] } };
      }) =>
        rows.filter(
          (r) =>
            r.userId === where.userId &&
            where.editionId.in.includes(r.editionId),
        ),
      upsert: async ({
        where,
        create,
        update,
      }: {
        where: { userId_editionId: { userId: string; editionId: number } };
        create: Record<string, unknown>;
        update: Record<string, unknown>;
      }) => {
        const key = where.userId_editionId;
        const existing = find(key.userId, key.editionId);
        upserts.push(existing ? update : create);
        if (existing) {
          Object.assign(existing, update, { updatedAt: new Date() });
          return existing;
        }
        const row = {
          ...(create as unknown as Row),
          updatedAt: new Date(),
        } as Row;
        rows.push(row);
        return row;
      },
    },
  },
}));

const { saveProgress, listProgress, getProgress } = await import(
  "@rawkoon/api/services/books/bookProgress"
);

const seed = (clientUpdatedAt: string, overrides: Partial<Row> = {}) => {
  rows = [
    {
      userId: "u1",
      editionId: 7,
      locator: "epubcfi(/6/4!/2/10)",
      percent: 0.4,
      positionSecs: null,
      fileId: null,
      finishedAt: null,
      clientUpdatedAt: new Date(clientUpdatedAt),
      updatedAt: new Date(clientUpdatedAt),
      ...overrides,
    },
  ];
};

describe("saveProgress", () => {
  beforeEach(() => {
    rows = [];
    upserts.length = 0;
  });

  it("creates a row on the first write", async () => {
    const res = await saveProgress("u1", 7, {
      locator: "epubcfi(/6/4!/2/2)",
      percent: 0.1,
      client_updated_at: "2026-08-20T10:00:00.000Z",
    });

    expect(res.accepted).toBe(true);
    expect(res.progress.locator).toBe("epubcfi(/6/4!/2/2)");
    expect(res.progress.percent).toBe(0.1);
    expect(rows).toHaveLength(1);
  });

  it("accepts a newer client clock", async () => {
    seed("2026-08-20T10:00:00.000Z");

    const res = await saveProgress("u1", 7, {
      percent: 0.6,
      locator: "epubcfi(/6/4!/2/20)",
      client_updated_at: "2026-08-20T11:00:00.000Z",
    });

    expect(res.accepted).toBe(true);
    expect(res.progress.percent).toBe(0.6);
  });

  it("rejects an older client clock and returns the stored row", async () => {
    seed("2026-08-20T12:00:00.000Z");

    const res = await saveProgress("u1", 7, {
      percent: 0.05,
      locator: "epubcfi(/6/4!/2/2)",
      client_updated_at: "2026-08-13T09:00:00.000Z",
    });

    expect(res.accepted).toBe(false);
    expect(res.progress.percent).toBe(0.4);
    expect(upserts).toHaveLength(0);
  });

  it("keeps the stored row when the clocks tie", async () => {
    seed("2026-08-20T12:00:00.000Z");

    const res = await saveProgress("u1", 7, {
      percent: 0.9,
      client_updated_at: "2026-08-20T12:00:00.000Z",
    });

    expect(res.accepted).toBe(false);
    expect(res.progress.percent).toBe(0.4);
  });

  it("stamps finishedAt only when the client says finished", async () => {
    const res = await saveProgress("u1", 7, {
      percent: 1,
      finished: true,
      client_updated_at: "2026-08-20T13:00:00.000Z",
    });

    expect(res.progress.finished_at).not.toBeNull();
  });

  it("keeps positions for different editions independent", async () => {
    await saveProgress("u1", 7, {
      percent: 0.4,
      client_updated_at: "2026-08-20T10:00:00.000Z",
    });
    await saveProgress("u1", 8, {
      position_secs: 1200,
      file_id: 3,
      client_updated_at: "2026-08-20T10:00:00.000Z",
    });

    const listed = await listProgress("u1", [7, 8]);
    expect(listed).toHaveLength(2);
    expect(listed.find((p) => p.edition_id === 8)?.position_secs).toBe(1200);
    expect(listed.find((p) => p.edition_id === 7)?.position_secs).toBeNull();
  });
});

describe("listProgress", () => {
  it("returns nothing for an empty id list without querying", async () => {
    expect(await listProgress("u1", [])).toEqual([]);
  });
});

describe("getProgress", () => {
  it("returns null when the user has never opened the edition", async () => {
    rows = [];
    expect(await getProgress("u1", 7)).toBeNull();
  });
});
