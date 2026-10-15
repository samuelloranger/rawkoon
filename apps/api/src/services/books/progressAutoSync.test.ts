import { beforeEach, describe, expect, mock, test } from "bun:test";

type Row = Record<string, unknown> | null;
let editions: Array<Record<string, unknown>> = [];
let listening: Row = null;
let reading: Row = null;

const listeningUpsert = mock(async (_args: unknown) => ({}));
const readingUpsert = mock(async (_args: unknown) => ({}));

mock.module("@rawkoon/api/db", () => ({
  prisma: {
    bookEdition: { findMany: mock(async () => editions) },
    bookListeningProgress: {
      findUnique: mock(async () => listening),
      upsert: listeningUpsert,
    },
    bookReadingProgress: {
      findUnique: mock(async () => reading),
      upsert: readingUpsert,
    },
  },
}));

const {
  AUTO_SYNC_DEVICE_ID,
  SYNC_DEBOUNCE_MS,
  runProgressSync,
  scheduleProgressSync,
} = await import("@rawkoon/api/services/books/progressAutoSync");
type SyncDeps = import("@rawkoon/api/services/books/progressAutoSync").SyncDeps;

const T0 = new Date("2026-01-01T10:00:00Z");
const T1 = new Date("2026-01-01T10:05:00Z");

const toEbook = mock(async (..._a: unknown[]) => ({
  result: {
    locator: { href: "c2.xhtml", type: "application/xhtml+xml" },
    spine_index: 2,
    spine_path: "c2.xhtml",
    progression: 0.4,
    total_progression: 0.3,
    score: 1,
    transcript: "x",
  },
  source: { epubFileId: 77, spineCount: 12, audiobookDurationSecs: 3600 },
}));
const toAudio = mock(async (..._a: unknown[]) => ({
  result: { position_secs: 1234, score: 1, calls: 1, transcript: "x" },
  source: { epubFileId: 77, spineCount: 12, audiobookDurationSecs: 3600 },
}));
let last: unknown = null;
const setLast = mock(async (..._a: unknown[]) => {});
const deps = (): SyncDeps =>
  ({
    handoffToEbook: toEbook,
    handoffToAudiobook: toAudio,
    getLast: async () => last,
    setLast,
  }) as unknown as SyncDeps;

const listenJob = {
  userId: "u",
  bookId: 5,
  direction: "listen_to_read",
} as const;
const readJob = {
  userId: "u",
  bookId: 5,
  direction: "read_to_listen",
} as const;

beforeEach(() => {
  editions = [
    { id: 1, kind: "audiobook", files: [{ format: "m4b" }] },
    { id: 2, kind: "ebook", files: [{ format: "epub" }] },
  ];
  listening = {
    positionSecs: 500,
    finished: false,
    updatedAt: T1,
  };
  reading = null;
  last = null;
  for (const m of [toEbook, toAudio, listeningUpsert, readingUpsert, setLast])
    m.mockClear();
});

describe("scheduleProgressSync", () => {
  const makeQueue = (existing?: { state: string }) => {
    const remove = mock(async () => {});
    return {
      remove,
      add: mock(async (..._a: unknown[]) => ({})),
      getJob: mock(async () =>
        existing ? { getState: async () => existing.state, remove } : undefined,
      ),
    };
  };

  test("adds a delayed single-attempt job keyed per user, book and direction", async () => {
    const q = makeQueue();
    await scheduleProgressSync(listenJob, q);
    const [, data, opts] = q.add.mock.calls[0] as [string, unknown, any];
    expect(data).toEqual(listenJob);
    expect(opts.delay).toBe(SYNC_DEBOUNCE_MS);
    expect(opts.attempts).toBe(1);
    expect(opts.jobId).toBe("book-sync:listen_to_read:u:5");
  });

  test("a second write replaces the pending job", async () => {
    const q = makeQueue({ state: "delayed" });
    await scheduleProgressSync(listenJob, q);
    expect(q.remove).toHaveBeenCalledTimes(1);
    expect((q.add.mock.calls[0] as any[])[2].jobId).toBe(
      "book-sync:listen_to_read:u:5",
    );
  });

  test("a running job is left alone and the new one queues behind it", async () => {
    const q = makeQueue({ state: "active" });
    await scheduleProgressSync(listenJob, q);
    expect(q.remove).not.toHaveBeenCalled();
    expect((q.add.mock.calls[0] as any[])[2].jobId).not.toBe(
      "book-sync:listen_to_read:u:5",
    );
  });

  test("a queue failure never throws into the progress write", async () => {
    const q = makeQueue();
    q.add.mockImplementation(async () => {
      throw new Error("down");
    });
    await scheduleProgressSync(listenJob, q);
  });

  test("window is above the slowest client cadence (10 s) and at least 30 s", () => {
    expect(SYNC_DEBOUNCE_MS).toBeGreaterThanOrEqual(30_000);
    expect(SYNC_DEBOUNCE_MS).toBeGreaterThan(2 * 10_000);
  });
});

describe("listen to read", () => {
  test("writes the ebook position at the source moment", async () => {
    const out = await runProgressSync(listenJob, deps());
    expect(out).toEqual({ status: "written" });
    expect(toEbook.mock.calls[0]).toEqual([5, 500]);
    const arg = readingUpsert.mock.calls[0]![0] as any;
    expect(arg.where).toEqual({
      userId_editionId: { userId: "u", editionId: 2 },
    });
    expect(arg.update).toMatchObject({
      fileId: 77,
      spineIndex: 2,
      spinePath: "c2.xhtml",
      spineCount: 12,
      scrollFraction: 0.4,
      finished: false,
      updatedAt: T1,
      deviceId: AUTO_SYNC_DEVICE_ID,
    });
    expect(JSON.parse(arg.update.locator).href).toBe("c2.xhtml");
    expect(setLast).toHaveBeenCalledTimes(1);
  });

  const skipCases: Array<[string, () => void]> = [
    ["no ebook edition", () => (editions = [editions[0]!])],
    [
      "no epub file",
      () =>
        (editions[1] = { id: 2, kind: "ebook", files: [{ format: "pdf" }] }),
    ],
    ["finished", () => (listening = { ...listening!, finished: true })],
    ["under 30 s", () => (listening = { ...listening!, positionSecs: 12 })],
    [
      "reading newer",
      () => (reading = { updatedAt: new Date(T1.getTime() + 1) }),
    ],
    ["reading tied", () => (reading = { updatedAt: T1 })],
    ["moved under 60 s since last sync", () => (last = { positionSecs: 470 })],
    ["no listening progress", () => (listening = null)],
  ];
  for (const [name, setup] of skipCases) {
    test(`skips: ${name}`, async () => {
      setup();
      const out = await runProgressSync(listenJob, deps());
      expect(out.status).toBe("skipped");
      expect(toEbook).not.toHaveBeenCalled();
      expect(readingUpsert).not.toHaveBeenCalled();
    });
  }

  test("runs when older reading exists and the move is over 60 s", async () => {
    reading = { updatedAt: T0 };
    last = { positionSecs: 400 };
    expect((await runProgressSync(listenJob, deps())).status).toBe("written");
  });

  test("a handoff failure drops the sync without a write", async () => {
    toEbook.mockImplementationOnce((async () => ({
      ok: false,
      code: "budget_exceeded",
    })) as never);
    const out = await runProgressSync(listenJob, deps());
    expect(out).toEqual({ status: "failed", code: "budget_exceeded" });
    expect(readingUpsert).not.toHaveBeenCalled();
    expect(setLast).not.toHaveBeenCalled();
  });
});

describe("read to listen", () => {
  beforeEach(() => {
    listening = null;
    reading = {
      spinePath: "c9.xhtml",
      scrollFraction: 0.6,
      finished: false,
      updatedAt: T1,
    };
  });

  test("writes the listening position at the source moment", async () => {
    const out = await runProgressSync(readJob, deps());
    expect(out).toEqual({ status: "written" });
    expect(toAudio.mock.calls[0]).toEqual([5, "c9.xhtml", 0.6]);
    const arg = listeningUpsert.mock.calls[0]![0] as any;
    expect(arg.where).toEqual({
      userId_editionId: { userId: "u", editionId: 1 },
    });
    expect(arg.update).toMatchObject({
      positionSecs: 1234,
      totalDurationSecs: 3600,
      finished: false,
      updatedAt: T1,
      deviceId: AUTO_SYNC_DEVICE_ID,
    });
  });

  test("skips when reading is finished", async () => {
    reading = { ...reading!, finished: true };
    expect((await runProgressSync(readJob, deps())).status).toBe("skipped");
    expect(listeningUpsert).not.toHaveBeenCalled();
  });

  test("skips when listening is newer or equal", async () => {
    listening = { positionSecs: 10, finished: false, updatedAt: T1 };
    expect((await runProgressSync(readJob, deps())).status).toBe("skipped");
    expect(toAudio).not.toHaveBeenCalled();
  });

  test("skips when the reading barely moved since the last sync", async () => {
    last = { spinePath: "c9.xhtml", fraction: 0.605 };
    expect((await runProgressSync(readJob, deps())).status).toBe("skipped");
  });

  test("a handoff failure drops the sync without a write", async () => {
    toAudio.mockImplementationOnce((async () => ({
      ok: false,
      code: "text_not_found",
    })) as never);
    expect((await runProgressSync(readJob, deps())).status).toBe("failed");
    expect(listeningUpsert).not.toHaveBeenCalled();
  });
});

describe("no ping-pong", () => {
  test("a job write is tagged and the job never enqueues anything", async () => {
    // The job only touches prisma and its deps; with no queue in reach, the
    // reverse sync can only come from a route, and routes skip this device id.
    await runProgressSync(listenJob, deps());
    expect((readingUpsert.mock.calls[0]![0] as any).update.deviceId).toBe(
      "rawkoon-sync",
    );
    // The reverse job, if it ran anyway, sees an equal timestamp and skips.
    reading = {
      spinePath: "c2.xhtml",
      scrollFraction: 0.4,
      finished: false,
      updatedAt: T1,
    };
    listening = { positionSecs: 500, finished: false, updatedAt: T1 };
    expect((await runProgressSync(readJob, deps())).status).toBe("skipped");
  });
});
