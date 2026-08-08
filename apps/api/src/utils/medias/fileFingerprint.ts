import { stat } from "node:fs/promises";

/** On-disk identity used to skip unchanged MediaInfo scans and cache inodes. */
export type FileFingerprint = {
  sizeBytes: bigint;
  mtimeMs: bigint;
  /**
   * dev/ino are decimal strings, not bigint. They are only ever an opaque
   * identity key (see inodeKeyFromParts), and mergerfs synthesizes unsigned
   * 64-bit inodes that overflow a signed Postgres bigint.
   */
  dev: string;
  ino: string;
};

export type StoredFileFingerprint = {
  sizeBytes: bigint;
  fileMtimeMs: bigint | null;
  fileDev?: string | null;
  fileIno?: string | null;
};

export function toBigInt(value: number | bigint): bigint {
  return typeof value === "bigint" ? value : BigInt(Math.trunc(value));
}

/**
 * Requires bigint stat fields on purpose: a plain stat() narrows the inode
 * through a lossy JS number before we ever see it, which is how mergerfs
 * inodes used to arrive as exactly 2^63 and abort every write.
 */
export function fingerprintFromStats(st: {
  size: bigint;
  mtimeMs: bigint;
  dev: bigint;
  ino: bigint;
}): FileFingerprint {
  return {
    sizeBytes: st.size,
    mtimeMs: st.mtimeMs,
    dev: st.dev.toString(),
    ino: st.ino.toString(),
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
  fileDev: string;
  fileIno: string;
} {
  return {
    sizeBytes: fp.sizeBytes,
    fileMtimeMs: fp.mtimeMs,
    fileDev: fp.dev,
    fileIno: fp.ino,
  };
}

export function inodeKeyFromParts(
  dev: string | number | bigint,
  ino: string | number | bigint,
): string {
  return `${dev}:${ino}`;
}

export async function statFileFingerprint(
  mappedPath: string,
): Promise<FileFingerprint | null> {
  try {
    const st = await stat(mappedPath, { bigint: true });
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
