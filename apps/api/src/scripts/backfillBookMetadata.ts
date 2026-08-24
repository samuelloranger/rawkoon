import { prisma } from "@rawkoon/api/db";
import { refreshBookMetadata } from "@rawkoon/api/services/books/refreshBookMetadata";

/**
 * Re-runs the metadata source chain over books already in the library.
 *
 * Per-book error catching is mandatory rather than defensive: a backfill that
 * aborts the whole batch on one bad book is what made the original book import
 * painful, and one unreachable provider or one odd file should not cost the
 * other 31 books their metadata.
 *
 * Concurrency is capped low on purpose. Each book costs an Audible catalog
 * search plus an Audnexus fetch plus an Open Library search, and the public
 * Audnexus instance allows 300 requests per 60s per IP.
 *
 * Usage:
 *   bun run src/scripts/backfillBookMetadata.ts --dry-run
 *   bun run src/scripts/backfillBookMetadata.ts --book=13
 *   bun run src/scripts/backfillBookMetadata.ts --limit=5
 *   bun run src/scripts/backfillBookMetadata.ts --only-missing
 */

const CONCURRENCY = 4;

const flag = (name: string): boolean => process.argv.includes(`--${name}`);

const arg = (name: string): string | null => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
};

async function main() {
  const dryRun = flag("dry-run");
  const onlyMissing = flag("only-missing");
  const only = arg("book");
  const limit = Number(arg("limit") ?? "0");

  const where = only
    ? { id: Number(only) }
    : onlyMissing
      ? // A book with no narrators, no genres and no publisher has never been
        // enriched by any source worth re-asking.
        {
          narrators: { isEmpty: true },
          genres: { isEmpty: true },
          publisher: null,
        }
      : {};

  const books = await prisma.libraryBook.findMany({
    where,
    select: { id: true, title: true },
    orderBy: { id: "asc" },
    ...(limit > 0 ? { take: limit } : {}),
  });

  console.log(
    `[backfill] ${books.length} book(s)${dryRun ? " — dry run, no writes" : ""}`,
  );
  if (books.length === 0) {
    await prisma.$disconnect();
    return;
  }

  let ok = 0;
  let failed = 0;
  let untouched = 0;
  const failedSourceTally = new Map<string, number>();
  const queue = [...books];

  const worker = async () => {
    for (;;) {
      const book = queue.shift();
      if (!book) return;

      if (dryRun) {
        console.log(`[backfill] would refresh ${book.id} — ${book.title}`);
        ok++;
        continue;
      }

      try {
        const outcome = await refreshBookMetadata(book.id);
        if (!outcome.ok) {
          failed++;
          console.warn(
            `[backfill] ${book.id} ${book.title}: ${outcome.reason}`,
          );
          continue;
        }
        ok++;
        for (const s of outcome.failedSources) {
          failedSourceTally.set(s, (failedSourceTally.get(s) ?? 0) + 1);
        }
        if (outcome.changedFields.length === 0) untouched++;
        const note =
          outcome.failedSources.length > 0
            ? ` (unavailable: ${outcome.failedSources.join(", ")})`
            : "";
        console.log(
          `[backfill] ${book.id} ${book.title}: ${outcome.changedFields.length} field(s)${note}`,
        );
      } catch (e) {
        failed++;
        console.error(
          `[backfill] ${book.id} ${book.title} threw: ${
            e instanceof Error ? e.message : String(e)
          }`,
        );
      }
    }
  };

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  console.log(`[backfill] done — ${ok} ok, ${failed} failed`);
  // Reported rather than left silent: a book that matched nothing is a normal
  // outcome (no Audible edition), but a provider that was down for the whole
  // run means the numbers understate what is available.
  if (untouched > 0) {
    console.log(
      `[backfill] ${untouched} book(s) gained no fields — expected for titles no source carries`,
    );
  }
  for (const [source, count] of failedSourceTally) {
    console.warn(
      `[backfill] ${source} was unavailable for ${count} book(s) — re-run to pick those up`,
    );
  }
  await prisma.$disconnect();
}

void main();
