import { stat } from "node:fs/promises";
import { prisma } from "@rawkoon/api/db";
import { sha256File } from "@rawkoon/api/utils/books/fileHash";

/**
 * Fills `book_files.sha256` for rows imported before the digest was recorded.
 *
 * Without a hash a client can only check a downloaded chapter's byte count, so a
 * file of the right length and wrong content is accepted and then cached
 * indefinitely. Existing libraries have no digests at all, so the client-side
 * check stays inert until this has run.
 *
 * Idempotent and resumable: only rows with a null hash are considered, so it can
 * be interrupted and re-run. Pass --force to re-hash rows that already have one
 * (after restoring files from backup, say).
 *
 * Usage: bun src/scripts/backfillBookFileHashes.ts [--force] [--limit N]
 */
async function main(): Promise<void> {
  const force = process.argv.includes("--force");
  const limitArg = process.argv.indexOf("--limit");
  const limit =
    limitArg !== -1 ? Number(process.argv[limitArg + 1]) : undefined;
  if (limit !== undefined && (!Number.isInteger(limit) || limit <= 0)) {
    throw new Error("--limit must be a positive integer");
  }

  const files = await prisma.bookFile.findMany({
    where: force ? {} : { sha256: null },
    select: { id: true, filePath: true, sizeBytes: true },
    orderBy: { id: "asc" },
    ...(limit === undefined ? {} : { take: limit }),
  });

  console.log(`[backfill-hashes] ${files.length} file(s) to hash`);

  let hashed = 0;
  let missing = 0;
  let changed = 0;
  let unreadable = 0;

  for (const file of files) {
    // A row whose file is gone, or whose size no longer matches, is a scan
    // problem rather than a hashing one — record it and move on rather than
    // writing a digest that describes something the row does not.
    let onDisk: Awaited<ReturnType<typeof stat>>;
    try {
      onDisk = await stat(file.filePath);
    } catch {
      missing++;
      console.warn(`[backfill-hashes] missing on disk: ${file.filePath}`);
      continue;
    }

    if (file.sizeBytes !== null && BigInt(onDisk.size) !== file.sizeBytes) {
      changed++;
      console.warn(
        `[backfill-hashes] size mismatch, skipping: ${file.filePath} ` +
          `(db ${file.sizeBytes}, disk ${onDisk.size})`,
      );
      continue;
    }

    const sha256 = await sha256File(file.filePath);
    if (sha256 === null) {
      unreadable++;
      console.warn(`[backfill-hashes] unreadable: ${file.filePath}`);
      continue;
    }

    await prisma.bookFile.update({ where: { id: file.id }, data: { sha256 } });
    hashed++;
    if (hashed % 25 === 0) {
      console.log(`[backfill-hashes] ${hashed}/${files.length}`);
    }
  }

  console.log(
    `[backfill-hashes] done — hashed ${hashed}, missing ${missing}, ` +
      `size-mismatched ${changed}, unreadable ${unreadable}`,
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
