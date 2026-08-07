import { stat } from "node:fs/promises";

/** On-disk identity used to skip unchanged MediaInfo scans and cache inodes. */
export type FileFingerprint = {
  sizeBytes: bigint;
  mtimeMs: bigint;
  dev: bigint;
  ino: bigint;
};

export type StoredFileFingerprint = {
  sizeBytes: bigint;
  fileMtimeMs: bigint | null;
  fileDev?: bigint | null;
  fileIno?: bigint | null;
};

export function toBigInt(value: number | bigint): bigint {
  return typeof value === "bigint" ? value : BigInt(Math.trunc(value));
}

export function fingerprintFromStats(st: {
  size: number | bigint;
  mtimeMs: number;
  dev: number | bigint;
  ino: number | bigint;
}): FileFingerprint {
  return {
    sizeBytes: toBigInt(st.size),
    mtimeMs: BigInt(Math.trunc(st.mtimeMs)),
    dev: toBigInt(st.dev),
    ino: toBigInt(st.ino),
  };
}

/** True when size + mtime match a previously persisted scan fingerprint. */
export function fileUnchanged(
  stored: StoredFileFingerprint,
  live: FileFingerprint,
): boolean {
  if (stored.fileMtimeMs == null) return false;
  return (
    stored.sizeBytes === live.sizeBytes && stored.fileMtimeMs === live.mtimeMs
  );
}

/** Prisma write fields for fingerprint columns (+ sizeBytes). */
export function fingerprintDbFields(fp: FileFingerprint): {
  sizeBytes: bigint;
  fileMtimeMs: bigint;
  fileDev: bigint;
  fileIno: bigint;
} {
  return {
    sizeBytes: fp.sizeBytes,
    fileMtimeMs: fp.mtimeMs,
    fileDev: fp.dev,
    fileIno: fp.ino,
  };
}

export function inodeKeyFromParts(
  dev: number | bigint,
  ino: number | bigint,
): string {
  return `${dev}:${ino}`;
}

export async function statFileFingerprint(
  mappedPath: string,
): Promise<FileFingerprint | null> {
  try {
    const st = await stat(mappedPath);
    if (!st.isFile()) return null;
    return fingerprintFromStats(st);
  } catch {
    return null;
  }
}

/**
 * Run `fn` over `items` with at most `concurrency` in flight.
 * Preserves result order.
 */
export async function mapPool<T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return [];
  const limit = Math.max(1, Math.min(concurrency, items.length));
  const results = new Array<R>(items.length);
  let next = 0;

  await Promise.all(
    Array.from({ length: limit }, async () => {
      for (;;) {
        const i = next++;
        if (i >= items.length) return;
        results[i] = await fn(items[i] as T, i);
      }
    }),
  );

  return results;
}
