import { beforeEach, describe, expect, mock, test } from "bun:test";

import {
  AUTO_SYNC_DEVICE_ID,
  MAX_SYNCS_PER_HOUR,
  SYNC_DEBOUNCE_MS,
  runProgressSync,
  scheduleProgressSync,
  type SyncDb,
  type SyncDeps,
} from "@rawkoon/api/services/books/progressAutoSync";

type Row = Record<string, any> | null;
let editions: Array<Record<string, unknown>> = [];
let listening: Row = null;
let reading: Row = null;

const listeningUpsert = mock(async (_args: unknown) => ({}));
const readingUpsert = mock(async (_args: unknown) => ({}));
const db = {
  bookEdition: { findMany: async () => editions },
  bookListeningProgress: {
    findUnique: async () => listening,
    upsert: listeningUpsert,
  },
  bookReadingProgress: {
    findUnique: async () => reading,
    upsert: readingUpsert,
  },
} as unknown as SyncDb;

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
let count = 1;
const setLast = mock(async (..._a: unknown[]) => {});
const queueAdd = mock(async (..._a: unknown[]) => ({}));
const jobsById = new Map<string, { state: string; remove: any }>();
const queue = {
  add: queueAdd,
  getJob: async (id: string) => {
    const j = jobsById.get(id);
    return j ? { getState: async () => j.state, remove: j.remove } : undefined;
  },
};
const deps = (): SyncDeps =>
  ({
    db,
    handoffToEbook: toEbook,
    handoffToAudiobook: toAudio,
    getLast: async () => last,
    setLast,
    bumpHourlyCount: async () => count,
    getQueue: async () => queue,
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
  listening = { positionSecs: 500, finished: false, updatedAt: T1 };
  reading = null;
  last = null;
  count = 1;
  jobsById.clear();
  for (const m of [
    toEbook,
    toAudio,
    listeningUpsert,
    readingUpsert,
    setLast,
    queueAdd,
  ])
    m.mockClear();
});

describe("scheduleProgressSync", () => {
  const addedOpts = () => (queueAdd.mock.calls[0] as any[])[2];

  test("adds a delayed single-attempt job keyed per user, book and direction", async () => {
    await scheduleProgressSync(listenJob, deps());
    const [, data] = queueAdd.mock.calls[0] as [string, unknown];
    expect(data).toEqual(listenJob);
    expect(addedOpts().delay).toBe(SYNC_DEBOUNCE_MS);
    expect(addedOpts().attempts).toBe(1);
    expect(addedOpts().jobId).toBe("book-sync-listen_to_read-u-5");
    // BullMQ refuses custom ids containing ":" and the add fails.
    expect(addedOpts().jobId).not.toContain(":");
  });

  test("a second write replaces the pending job", async () => {
    const remove = mock(async () => {});
    jobsById.set("book-sync-listen_to_read-u-5", { state: "delayed", remove });
    await scheduleProgressSync(listenJob, deps());
    expect(remove).toHaveBeenCalledTimes(1);
    expect(addedOpts().jobId).toBe("book-sync-listen_to_read-u-5");
  });

  test("while a job runs, writes debounce one stable follow-up id", async () => {
    const id = "book-sync-listen_to_read-u-5";
    jobsById.set(id, { state: "active", remove: mock(async () => {}) });
    const removeNext = mock(async () => {});
    jobsById.set(`${id}-next`, { state: "delayed", remove: removeNext });
    await scheduleProgressSync(listenJob, deps());
    expect(removeNext).toHaveBeenCalledTimes(1);
    expect(addedOpts().jobId).toBe(`${id}-next`);
  });

  test("never enqueues for a book without an audiobook, an ebook, or an epub", async () => {
    editions = [editions[0]!];
    await scheduleProgressSync(listenJob, deps());
    editions = [
      editions[0]!,
      { id: 2, kind: "ebook", files: [{ format: "pdf" }] },
    ];
    await scheduleProgressSync(listenJob, deps());
    expect(queueAdd).not.toHaveBeenCalled();
  });

  test("a queue failure never throws into the progress write", async () => {
    queueAdd.mockImplementationOnce(async () => {
      throw new Error("down");
    });
    await scheduleProgressSync(listenJob, deps());
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
    ["hourly cap exceeded", () => (count = MAX_SYNCS_PER_HOUR + 1)],
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

  test("runs at exactly the hourly cap", async () => {
    count = MAX_SYNCS_PER_HOUR;
    expect((await runProgressSync(listenJob, deps())).status).toBe("written");
  });

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
      spineIndex: 8,
      spineCount: 12,
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

  test("skips when over the hourly cap", async () => {
    count = MAX_SYNCS_PER_HOUR + 1;
    expect((await runProgressSync(readJob, deps())).status).toBe("skipped");
    expect(toAudio).not.toHaveBeenCalled();
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

describe("an unopened reader must not rewind listening", () => {
  const farIntoAudio = () => {
    listening = { positionSecs: 10_800, finished: true, updatedAt: T0 };
  };

  test("a reading row at the very start is skipped before any transcription", async () => {
    farIntoAudio();
    reading = {
      spineIndex: 0,
      spineCount: 12,
      spinePath: "c1.xhtml",
      scrollFraction: 0,
      finished: false,
      updatedAt: T1,
    };
    const out = await runProgressSync(readJob, deps());
    expect(out).toEqual({ status: "skipped", reason: "at_book_start" });
    expect(toAudio).not.toHaveBeenCalled();
    expect(listeningUpsert).not.toHaveBeenCalled();
  });

  test("a first-seen reading row that would rewind over 10 min is not written", async () => {
    farIntoAudio();
    reading = {
      spineIndex: 1,
      spineCount: 12,
      spinePath: "c2.xhtml",
      scrollFraction: 0.5,
      finished: false,
      updatedAt: T1,
    };
    const out = await runProgressSync(readJob, deps());
    expect(out).toEqual({ status: "skipped", reason: "unconfirmed_rewind" });
    expect(listeningUpsert).not.toHaveBeenCalled();
    // The sighting is kept, so the next real move from here is confirmed.
    expect(setLast).toHaveBeenCalledWith(expect.any(String), {
      spinePath: "c2.xhtml",
      fraction: 0.5,
    });
  });

  test("a reading row that moved since the last sync may re-read earlier text", async () => {
    farIntoAudio();
    reading = {
      spineIndex: 1,
      spineCount: 12,
      spinePath: "c2.xhtml",
      scrollFraction: 0.5,
      finished: false,
      updatedAt: T1,
    };
    last = { spinePath: "c9.xhtml", fraction: 0.2 };
    expect((await runProgressSync(readJob, deps())).status).toBe("written");
  });

  test("reading ahead of listening is never blocked", async () => {
    listening = { positionSecs: 100, finished: false, updatedAt: T0 };
    reading = {
      spineIndex: 5,
      spineCount: 12,
      spinePath: "c6.xhtml",
      scrollFraction: 0.1,
      finished: false,
      updatedAt: T1,
    };
    expect((await runProgressSync(readJob, deps())).status).toBe("written");
  });
});

describe("no ping-pong", () => {
  test("a job write is tagged and its reverse sync skips on the tied timestamp", async () => {
    await runProgressSync(listenJob, deps());
    expect((readingUpsert.mock.calls[0]![0] as any).update.deviceId).toBe(
      "rawkoon-sync",
    );
    expect(queueAdd).not.toHaveBeenCalled();
    reading = {
      spineIndex: 2,
      spineCount: 12,
      spinePath: "c2.xhtml",
      scrollFraction: 0.4,
      finished: false,
      updatedAt: T1,
    };
    listening = { positionSecs: 500, finished: false, updatedAt: T1 };
    expect((await runProgressSync(readJob, deps())).status).toBe("skipped");
  });
});
