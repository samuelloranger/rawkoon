import { prisma } from "@rawkoon/api/db";
import { valkey } from "@rawkoon/api/db/valkey";
import { getJsonCache, setJsonCache } from "@rawkoon/api/services/cache";
import {
  handoffToAudiobookDetailed,
  handoffToEbookDetailed,
} from "@rawkoon/api/services/books/handoff/bookHandoff";

export type SyncDirection = "listen_to_read" | "read_to_listen";

export interface ProgressSyncJobData {
  userId: string;
  bookId: number;
  direction: SyncDirection;
}

export const BOOK_POSITION_SYNC_JOB_NAME = "book-position-sync";
/** Marks the job's own writes so the routes never schedule the reverse sync from them. */
export const AUTO_SYNC_DEVICE_ID = "rawkoon-sync";
/** 30 s floor; clients write every 3-10 s (web reader 3 s, iOS 5 s, web player 10 s), so 2x the slowest is 20 s. */
export const SYNC_DEBOUNCE_MS = 30_000;
const MIN_LISTEN_SECS = 30;
const MIN_MOVE_SECS = 60;
/** Same-chapter reading moves smaller than this are not worth another transcription. */
const MIN_READ_MOVE = 0.01;
const LAST_SYNC_TTL_SECS = 7 * 24 * 3600;
/** Matches the manual handoff route's rate limit, since each sync is a paid transcription. */
export const MAX_SYNCS_PER_HOUR = 60;
/** Reading may pull listening back further than this only after it has moved since a prior sync. */
const MAX_UNCONFIRMED_REWIND_SECS = 600;
/** A reading position this close to the start of the book is an unopened book, not a place. */
const START_OF_BOOK = 0.01;

const jobId = (d: ProgressSyncJobData) =>
  `book-sync:${d.direction}:${d.userId}:${d.bookId}`;

export interface DebounceQueue {
  getJob(
    id: string,
  ): Promise<
    { getState(): Promise<string>; remove(): Promise<unknown> } | undefined
  >;
  add(
    name: string,
    data: ProgressSyncJobData,
    opts: Record<string, unknown>,
  ): Promise<unknown>;
}

type EditionRow = {
  id: number;
  kind: string;
  files: Array<{ format: string }>;
};

type ProgressRow = {
  updatedAt: Date;
  finished: boolean;
  positionSecs: number;
  spineIndex: number;
  spineCount: number;
  spinePath: string;
  scrollFraction: number;
} | null;

/** The slice of prisma this module uses, so tests can pass a fake. */
export interface SyncDb {
  bookEdition: { findMany(args: unknown): Promise<EditionRow[]> };
  bookListeningProgress: {
    findUnique(args: unknown): Promise<ProgressRow>;
    upsert(args: unknown): Promise<unknown>;
  };
  bookReadingProgress: {
    findUnique(args: unknown): Promise<ProgressRow>;
    upsert(args: unknown): Promise<unknown>;
  };
}

type LastSynced = {
  positionSecs?: number;
  spinePath?: string;
  fraction?: number;
};

export interface SyncDeps {
  db: SyncDb;
  handoffToEbook: typeof handoffToEbookDetailed;
  handoffToAudiobook: typeof handoffToAudiobookDetailed;
  getLast: (key: string) => Promise<LastSynced | null>;
  setLast: (key: string, value: LastSynced) => Promise<void>;
  /** Increments the user's count for the current hour and returns it. */
  bumpHourlyCount: (userId: string) => Promise<number>;
  getQueue: () => Promise<DebounceQueue>;
}

const defaultDeps: SyncDeps = {
  db: prisma as unknown as SyncDb,
  handoffToEbook: handoffToEbookDetailed,
  handoffToAudiobook: handoffToAudiobookDetailed,
  getLast: (key) => getJsonCache<LastSynced>(key),
  setLast: (key, value) => setJsonCache(key, value, LAST_SYNC_TTL_SECS),
  bumpHourlyCount: async (userId) => {
    const key = `book-sync:count:${userId}:${Math.floor(Date.now() / 3_600_000)}`;
    const count = await valkey.incr(key);
    if (count === 1) await valkey.expire(key, 3600);
    return count;
  },
  getQueue: async () =>
    (await import("@rawkoon/api/services/queueService"))
      .bookPositionSyncQueue as unknown as DebounceQueue,
};

const loadEditions = (db: SyncDb, bookId: number) =>
  db.bookEdition.findMany({
    where: { bookId },
    select: { id: true, kind: true, files: { select: { format: true } } },
  });

function pairOf(editions: EditionRow[]) {
  const ebook = editions.find((e) => e.kind === "ebook");
  const audiobook = editions.find((e) => e.kind === "audiobook");
  const hasEpub = Boolean(
    ebook?.files.some((f) => f.format.toLowerCase() === "epub"),
  );
  return { ebook, audiobook, hasEpub };
}

/** Replaces any pending job for the key, so it fires only once the position has been still. */
export async function scheduleProgressSync(
  data: ProgressSyncJobData,
  deps: Pick<SyncDeps, "db" | "getQueue"> = defaultDeps,
): Promise<void> {
  try {
    // A book with no audiobook or no epub can never hand off; don't queue it.
    const { ebook, audiobook, hasEpub } = pairOf(
      await loadEditions(deps.db, data.bookId),
    );
    if (!ebook || !audiobook || !hasEpub) return;

    const q = await deps.getQueue();
    const id = jobId(data);
    let useId = id;
    const existing = await q.getJob(id);
    if (existing) {
      if ((await existing.getState()) === "active") {
        // A running job can't be replaced; debounce a single follow-up behind it.
        useId = `${id}:next`;
        await (await q.getJob(useId))?.remove();
      } else await existing.remove();
    }
    await q.add(BOOK_POSITION_SYNC_JOB_NAME, data, {
      jobId: useId,
      delay: SYNC_DEBOUNCE_MS,
      attempts: 1,
      removeOnComplete: true,
      removeOnFail: { age: 24 * 3600 },
    });
  } catch (error) {
    // Auto-sync is best effort and must never fail the progress write.
    console.warn("[progressAutoSync] could not schedule:", error);
  }
}

export type SyncOutcome =
  | { status: "written" }
  | { status: "skipped"; reason: string }
  | { status: "failed"; code: string };

const skipped = (reason: string): SyncOutcome => ({
  status: "skipped",
  reason,
});

/** Transcription takes seconds; a client may have written the target meanwhile. */
async function targetCaughtUp(
  load: () => Promise<ProgressRow>,
  sourceAt: Date,
): Promise<boolean> {
  const row = await load();
  return row !== null && row.updatedAt >= sourceAt;
}

function failed(data: ProgressSyncJobData, code: string): SyncOutcome {
  // Not retried: every attempt is a paid transcription that would fail the same way.
  console.info(
    `[progressAutoSync] ${data.direction} book ${data.bookId} dropped: ${code}`,
  );
  return { status: "failed", code };
}

/** Whichever side is newer at run time wins; a stale job just skips. */
export async function runProgressSync(
  data: ProgressSyncJobData,
  deps: SyncDeps = defaultDeps,
): Promise<SyncOutcome> {
  const { userId, bookId, direction } = data;
  const { db } = deps;
  const { ebook, audiobook, hasEpub } = pairOf(await loadEditions(db, bookId));
  if (!ebook || !audiobook) return skipped("missing_edition");
  if (!hasEpub) return skipped("no_epub");

  const [listening, reading] = await Promise.all([
    db.bookListeningProgress.findUnique({
      where: { userId_editionId: { userId, editionId: audiobook.id } },
    }),
    db.bookReadingProgress.findUnique({
      where: { userId_editionId: { userId, editionId: ebook.id } },
    }),
  ]);
  const lastKey = `book-sync:last:${direction}:${userId}:${bookId}`;

  // Called after the free skips, so only a run that will transcribe is counted.
  const overCap = async () => {
    if ((await deps.bumpHourlyCount(userId)) <= MAX_SYNCS_PER_HOUR)
      return false;
    console.info("[progressAutoSync] hourly cap reached for a user");
    return true;
  };

  if (direction === "listen_to_read") {
    if (!listening) return skipped("no_source");
    if (listening.finished) return skipped("source_finished");
    if (listening.positionSecs < MIN_LISTEN_SECS) return skipped("too_early");
    if (reading && reading.updatedAt >= listening.updatedAt)
      return skipped("target_not_older");
    const last = await deps.getLast(lastKey);
    if (
      last?.positionSecs !== undefined &&
      Math.abs(listening.positionSecs - last.positionSecs) < MIN_MOVE_SECS
    )
      return skipped("moved_too_little");
    if (await overCap()) return skipped("rate_limited");

    const out = await deps.handoffToEbook(bookId, listening.positionSecs);
    if ("ok" in out) return failed(data, out.code);
    const { result, source } = out;
    if (
      await targetCaughtUp(
        () =>
          db.bookReadingProgress.findUnique({
            where: { userId_editionId: { userId, editionId: ebook.id } },
            select: { updatedAt: true },
          }),
        listening.updatedAt,
      )
    )
      return skipped("target_newer_now");
    const fields = {
      fileId: source.epubFileId,
      spineIndex: result.spine_index,
      spinePath: result.spine_path,
      spineCount: source.spineCount,
      scrollFraction: result.progression,
      locator: JSON.stringify(result.locator),
      finished: false,
      updatedAt: listening.updatedAt,
      receivedAt: new Date(),
      deviceId: AUTO_SYNC_DEVICE_ID,
    };
    await db.bookReadingProgress.upsert({
      where: { userId_editionId: { userId, editionId: ebook.id } },
      update: fields,
      create: { ...fields, userId, editionId: ebook.id },
    });
    await deps.setLast(lastKey, { positionSecs: listening.positionSecs });
    return { status: "written" };
  }

  if (!reading) return skipped("no_source");
  if (reading.finished) return skipped("source_finished");
  const overall =
    (reading.spineIndex + reading.scrollFraction) /
    Math.max(1, reading.spineCount);
  // An unopened book reads as position zero; it must never pull listening back to the start.
  if (overall < START_OF_BOOK) return skipped("at_book_start");
  if (listening && listening.updatedAt >= reading.updatedAt)
    return skipped("target_not_older");
  const last = await deps.getLast(lastKey);
  if (
    last?.spinePath === reading.spinePath &&
    last?.fraction !== undefined &&
    Math.abs(reading.scrollFraction - last.fraction!) < MIN_READ_MOVE
  )
    return skipped("moved_too_little");
  if (await overCap()) return skipped("rate_limited");

  const out = await deps.handoffToAudiobook(
    bookId,
    reading.spinePath,
    reading.scrollFraction,
  );
  if ("ok" in out) return failed(data, out.code);
  const { result, source } = out;
  // A big rewind needs a reading row that has moved since a prior sync; a first sight of one is not enough.
  if (
    listening &&
    !last &&
    result.position_secs < listening.positionSecs - MAX_UNCONFIRMED_REWIND_SECS
  ) {
    // Recorded so the next real move counts as confirmed instead of being transcribed and discarded again.
    await deps.setLast(lastKey, {
      spinePath: reading.spinePath,
      fraction: reading.scrollFraction,
    });
    return skipped("unconfirmed_rewind");
  }
  if (
    await targetCaughtUp(
      () =>
        db.bookListeningProgress.findUnique({
          where: { userId_editionId: { userId, editionId: audiobook.id } },
          select: { updatedAt: true },
        }),
      reading.updatedAt,
    )
  )
    return skipped("target_newer_now");
  const total = source.audiobookDurationSecs;
  const fields = {
    positionSecs: Math.min(Math.max(result.position_secs, 0), total),
    totalDurationSecs: total,
    finished: false,
    updatedAt: reading.updatedAt,
    receivedAt: new Date(),
    deviceId: AUTO_SYNC_DEVICE_ID,
  };
  await db.bookListeningProgress.upsert({
    where: { userId_editionId: { userId, editionId: audiobook.id } },
    update: fields,
    create: { ...fields, userId, editionId: audiobook.id },
  });
  await deps.setLast(lastKey, {
    spinePath: reading.spinePath,
    fraction: reading.scrollFraction,
  });
  return { status: "written" };
}
