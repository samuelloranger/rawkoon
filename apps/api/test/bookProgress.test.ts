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
/** Every statement the service issued, so a rejected write can be shown to write nothing. */
const statements: string[] = [];

const find = (userId: string, editionId: number) =>
  rows.find((r) => r.userId === userId && r.editionId === editionId) ?? null;

/**
 * Stands in for the single INSERT ... ON CONFLICT ... WHERE statement, including
 * its refusal to update when the incoming clock does not beat the stored one.
 * Returns raw snake_case columns, as `$queryRaw` does.
 */
const runUpsert = (
  userId: string,
  editionId: number,
  incoming: {
    locator: string | null;
    percent: number | null;
    positionSecs: number | null;
    fileId: number | null;
    finishedAt: Date | null;
    clientUpdatedAt: Date;
  },
) => {
  const existing = find(userId, editionId);
  if (existing) {
    if (
      existing.clientUpdatedAt.getTime() >= incoming.clientUpdatedAt.getTime()
    ) {
      return [];
    }
    Object.assign(existing, incoming, { updatedAt: new Date() });
    return [raw(existing)];
  }
  const row: Row = {
    userId,
    editionId,
    ...incoming,
    updatedAt: new Date(),
  };
  rows.push(row);
  return [raw(row)];
};

const raw = (row: Row) => ({
  edition_id: row.editionId,
  locator: row.locator,
  percent: row.percent,
  position_secs: row.positionSecs,
  file_id: row.fileId,
  finished_at: row.finishedAt,
  client_updated_at: row.clientUpdatedAt,
  updated_at: row.updatedAt,
});

mock.module("@rawkoon/api/db", () => ({
  prisma: {
    $queryRaw: (
      _strings: TemplateStringsArray,
      userId: string,
      editionId: number,
      locator: string | null,
      percent: number | null,
      positionSecs: number | null,
      fileId: number | null,
      finishedAt: Date | null,
      clientUpdatedAt: Date,
    ) => {
      statements.push("upsert");
      return Promise.resolve(
        runUpsert(userId, editionId, {
          locator,
          percent,
          positionSecs,
          fileId,
          finishedAt,
          clientUpdatedAt,
        }),
      );
    },
    bookProgress: {
      findUnique: ({
        where,
      }: {
        where: { userId_editionId: { userId: string; editionId: number } };
      }) => {
        const key = where.userId_editionId;
        const row = find(key.userId, key.editionId);
        return Promise.resolve(row);
      },
      findMany: ({
        where,
      }: {
        where: { userId: string; editionId: { in: number[] } };
      }) =>
        Promise.resolve(
          rows.filter(
            (r) =>
              r.userId === where.userId &&
              where.editionId.in.includes(r.editionId),
          ),
        ),
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
    statements.length = 0;
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
    // The statement ran; it simply updated nothing, which is the point of
    // putting the predicate in the database rather than in a prior read.
    expect(statements).toEqual(["upsert"]);
    expect(rows[0].locator).toBe("epubcfi(/6/4!/2/10)");
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

  it("keeps the newer position when two devices save at once", async () => {
    // Both calls start before either resolves, which is the shape of the race:
    // with a read-then-write pair both would observe the same state and the
    // older write could land last.
    const [newer, older] = await Promise.all([
      saveProgress("u1", 7, {
        percent: 0.8,
        locator: "desktop",
        client_updated_at: "2026-08-20T12:00:00.000Z",
      }),
      saveProgress("u1", 7, {
        percent: 0.1,
        locator: "phone",
        client_updated_at: "2026-08-13T09:00:00.000Z",
      }),
    ]);

    const loser = newer.accepted ? older : newer;
    expect(loser.accepted).toBe(false);
    expect(loser.progress.locator).toBe("desktop");
    expect(rows[0].locator).toBe("desktop");
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
