import { prisma } from "@rawkoon/api/db";
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

const defaultQueue = async (): Promise<DebounceQueue> =>
  (await import("@rawkoon/api/services/queueService"))
    .bookPositionSyncQueue as unknown as DebounceQueue;

/** Replaces any pending job for the key, so it fires only once the position has been still. */
export async function scheduleProgressSync(
  data: ProgressSyncJobData,
  queue?: DebounceQueue,
): Promise<void> {
  try {
    const q = queue ?? (await defaultQueue());
    const id = jobId(data);
    let useId = id;
    const existing = await q.getJob(id);
    if (existing) {
      // A running job can't be replaced; queue behind it under a fresh id.
      if ((await existing.getState()) === "active")
        useId = `${id}:${Date.now()}`;
      else await existing.remove();
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

type LastSynced = {
  positionSecs?: number;
  spinePath?: string;
  fraction?: number;
};

export interface SyncDeps {
  handoffToEbook: typeof handoffToEbookDetailed;
  handoffToAudiobook: typeof handoffToAudiobookDetailed;
  getLast: (key: string) => Promise<LastSynced | null>;
  setLast: (key: string, value: LastSynced) => Promise<void>;
}

const defaultDeps: SyncDeps = {
  handoffToEbook: handoffToEbookDetailed,
  handoffToAudiobook: handoffToAudiobookDetailed,
  getLast: (key) => getJsonCache<LastSynced>(key),
  setLast: (key, value) => setJsonCache(key, value, LAST_SYNC_TTL_SECS),
};

export type SyncOutcome =
  | { status: "written" }
  | { status: "skipped"; reason: string }
  | { status: "failed"; code: string };

const skipped = (reason: string): SyncOutcome => ({
  status: "skipped",
  reason,
});

const currentReading = (userId: string, editionId: number) =>
  prisma.bookReadingProgress.findUnique({
    where: { userId_editionId: { userId, editionId } },
    select: { updatedAt: true },
  });

const currentListening = (userId: string, editionId: number) =>
  prisma.bookListeningProgress.findUnique({
    where: { userId_editionId: { userId, editionId } },
    select: { updatedAt: true },
  });

/** Transcription takes seconds; a client may have written the target meanwhile. */
async function targetCaughtUp(
  load: () => Promise<{ updatedAt: Date } | null>,
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
  const editions = await prisma.bookEdition.findMany({
    where: { bookId },
    select: { id: true, kind: true, files: { select: { format: true } } },
  });
  const ebook = editions.find((e) => e.kind === "ebook");
  const audiobook = editions.find((e) => e.kind === "audiobook");
  if (!ebook || !audiobook) return skipped("missing_edition");
  if (!ebook.files.some((f) => f.format.toLowerCase() === "epub"))
    return skipped("no_epub");

  const [listening, reading] = await Promise.all([
    prisma.bookListeningProgress.findUnique({
      where: { userId_editionId: { userId, editionId: audiobook.id } },
    }),
    prisma.bookReadingProgress.findUnique({
      where: { userId_editionId: { userId, editionId: ebook.id } },
    }),
  ]);
  const lastKey = `book-sync:last:${direction}:${userId}:${bookId}`;

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

    const out = await deps.handoffToEbook(bookId, listening.positionSecs);
    if ("ok" in out) return failed(data, out.code);
    const { result, source } = out;
    if (
      await targetCaughtUp(
        () => currentReading(userId, ebook.id),
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
    await prisma.bookReadingProgress.upsert({
      where: { userId_editionId: { userId, editionId: ebook.id } },
      update: fields,
      create: { ...fields, userId, editionId: ebook.id },
    });
    await deps.setLast(lastKey, { positionSecs: listening.positionSecs });
    return { status: "written" };
  }

  if (!reading) return skipped("no_source");
  if (reading.finished) return skipped("source_finished");
  if (listening && listening.updatedAt >= reading.updatedAt)
    return skipped("target_not_older");
  const last = await deps.getLast(lastKey);
  if (
    last?.spinePath === reading.spinePath &&
    last.fraction !== undefined &&
    Math.abs(reading.scrollFraction - last.fraction) < MIN_READ_MOVE
  )
    return skipped("moved_too_little");

  const out = await deps.handoffToAudiobook(
    bookId,
    reading.spinePath,
    reading.scrollFraction,
  );
  if ("ok" in out) return failed(data, out.code);
  const { result, source } = out;
  if (
    await targetCaughtUp(
      () => currentListening(userId, audiobook.id),
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
  await prisma.bookListeningProgress.upsert({
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
