import { stat } from "node:fs/promises";

/** On-disk identity used to skip unchanged MediaInfo scans and cache inodes. */
export type FileFingerprint = {
  sizeBytes: bigint;
  mtimeMs: bigint;
  /**
   * dev/ino are decimal strings, not bigint. They are only ever an opaque
   * identity key (see inodeKeyFromParts), and mergerfs synthesizes unsigned
   * 64-bit inodes that overflow a signed Postgres bigint.
   *
   * Null when the runtime could not report a trustworthy inode — see
   * normalizeInode. Size + mtime still work as a change fingerprint; only
   * hardlink identity is unavailable.
   */
  dev: string | null;
  ino: string | null;
};

export type StoredFileFingerprint = {
  sizeBytes: bigint;
  fileMtimeMs: bigint | null;
  fileDev?: string | null;
  fileIno?: string | null;
};

/** Bun clamps here instead of reporting an unsigned inode; see normalizeInode. */
const INT64_MAX = 9223372036854775807n;

export function toBigInt(value: number | bigint): bigint {
  return typeof value === "bigint" ? value : BigInt(Math.trunc(value));
}

/**
 * Turn a raw bigint inode into an exact unsigned decimal string, or null when
 * it cannot be trusted.
 *
 * Pooled filesystems (mergerfs) synthesize inodes above 2^63, and runtimes
 * disagree about how to report them:
 *
 * - Bun >= 1.3.14 returns the signed two's-complement view (negative). That is
 *   lossless, so `asUintN` recovers the real value — verified against
 *   `stat -c %i`: -4420810779339849877 -> 14025933294369701739.
 * - Bun 1.3.11 clamps to INT64_MAX. Every file on the pool then reports the
 *   *same* number, which is worse than having no inode at all: persisting it
 *   would collapse every file onto one identity key and make unrelated
 *   downloads look like hardlinks of each other. Reject it.
 */
export function normalizeInode(raw: bigint): string | null {
  if (raw === 0n || raw === INT64_MAX) return null;
  return BigInt.asUintN(64, raw).toString();
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
  const ino = normalizeInode(st.ino);
  return {
    sizeBytes: st.size,
    mtimeMs: st.mtimeMs,
    // dev alone is meaningless as an identity, so it travels with ino.
    dev: ino === null ? null : BigInt.asUintN(64, st.dev).toString(),
    ino,
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
  fileDev: string | null;
  fileIno: string | null;
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
