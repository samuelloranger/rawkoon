import { stat } from "node:fs/promises";
import { basename } from "node:path";

import { prisma } from "@rawkoon/api/db";
import { addBookFromVolume } from "@rawkoon/api/services/books/bookLibrary";
import { postProcessBook } from "@rawkoon/api/services/postProcessor/postProcessorBookImport";
import {
  formatForPath,
  readEbookMetadata,
} from "@rawkoon/api/utils/books/ebookMetadata";
import { isAudiobookFormat } from "@rawkoon/api/utils/books/bookReleaseParser";
import type { Entry } from "@rawkoon/api/scripts/importExistingBooksManifest";

/**
 * Create a book_file row for an ebook that stays where it is.
 *
 * Populates the same columns postProcessBook fills for an ebook — size,
 * format, language tags, and the dev/ino/mtime identity that lets a later
 * rescan skip re-probing — and nothing more: duration, bitrate, codec,
 * narrators are an audio-only concern. Idempotent by path, the
 * same way postProcessBook is.
 */
async function registerInPlace(
  editionId: number,
  filePath: string,
  bookLanguage: string,
): Promise<{ imported: number; error?: string }> {
  const format = formatForPath(filePath);
  if (!format)
    return { imported: 0, error: `unrecognized format: ${filePath}` };
  if (isAudiobookFormat(format)) {
    return {
      imported: 0,
      error: "inPlace is ebook-only; an audiobook needs the MediaInfo pass",
    };
  }

  const st = await stat(filePath);
  const meta = await readEbookMetadata(filePath);

  await prisma.bookFile.deleteMany({ where: { filePath } });
  await prisma.bookFile.create({
    data: {
      editionId,
      filePath,
      fileName: basename(filePath),
      sizeBytes: BigInt(st.size),
      format,
      languageTags: [meta.language ?? bookLanguage],
      fileDev: String(st.dev),
      fileIno: String(st.ino),
      fileMtimeMs: BigInt(Math.trunc(st.mtimeMs)),
    },
  });
  await prisma.bookEdition.update({
    where: { id: editionId },
    data: { status: "downloaded" },
  });
  return { imported: 1 };
}

export async function apply(entries: Entry[]): Promise<void> {
  const settings = await prisma.mediaSettings.findUnique({
    where: { id: 1 },
    select: { fileOperation: true },
  });
  const fileOperation =
    settings?.fileOperation === "move" ? "move" : ("hardlink" as const);
  console.log(`file operation: ${fileOperation}\n`);

  let books = 0;
  let editions = 0;
  let files = 0;
  const problems: string[] = [];

  for (const entry of entries) {
    const kinds = [...new Set(entry.sources.map((s) => s.kind))];
    const outcome = await addBookFromVolume({
      volumeId: entry.volumeId as string,
      kinds,
      monitored: false,
    });
    if (!outcome.added) {
      problems.push(`${entry.key}: ${outcome.reason}`);
      console.log(`=== ${entry.key}: SKIPPED — ${outcome.reason}`);
      continue;
    }
    books++;

    if (entry.forceLanguage) {
      const updated = await prisma.libraryBook.update({
        where: { id: outcome.bookId },
        data: { language: entry.forceLanguage },
        select: { language: true },
      });
      console.log(`    language forced to ${updated.language}`);
    }

    const book = await prisma.libraryBook.findUnique({
      where: { id: outcome.bookId },
      select: {
        title: true,
        language: true,
        publishedYear: true,
        editions: { select: { id: true, kind: true } },
      },
    });
    if (!book) {
      problems.push(`${entry.key}: book ${outcome.bookId} vanished after add`);
      continue;
    }
    console.log(
      `=== ${entry.key}: ${book.title} [${book.language}] -> book ${outcome.bookId}`,
    );

    for (const source of entry.sources) {
      const edition = book.editions.find((e) => e.kind === source.kind);
      if (!edition) {
        problems.push(`${entry.key}: no ${source.kind} edition was created`);
        continue;
      }
      editions++;

      if (source.inPlace) {
        try {
          const placed = await registerInPlace(
            edition.id,
            source.path,
            book.language,
          );
          files += placed.imported;
          console.log(
            `    ${source.kind}: ${placed.imported} file(s) registered in place -> ${source.path}`,
          );
          if (placed.error) {
            problems.push(`${entry.key}/${source.kind}: ${placed.error}`);
            console.log(`      ERROR: ${placed.error}`);
          }
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          problems.push(`${entry.key}/${source.kind}: ${message}`);
          console.log(`    ${source.kind}: FAILED — ${message}`);
        }
        continue;
      }

      let result: Awaited<ReturnType<typeof postProcessBook>>;
      try {
        result = await postProcessBook({
          editionId: edition.id,
          contentPath: source.path,
          // No real release title exists for a file already on disk. Title and
          // year are enough for the parser; it yields no release group and no
          // retail marker, which is the honest answer for a scanned file.
          releaseTitle: `${book.title} (${book.publishedYear ?? ""}) [${book.language}]`,
          fileOperation,
        });
      } catch (e) {
        // One unwritable destination must not abandon the remaining entries:
        // a partial run leaves books with no files behind, and the operator
        // cannot see what else would have worked.
        const message = e instanceof Error ? e.message : String(e);
        problems.push(`${entry.key}/${source.kind}: ${message}`);
        console.log(`    ${source.kind}: FAILED — ${message}`);
        continue;
      }
      files += result.imported;
      console.log(
        `    ${source.kind}: ${result.imported} file(s) -> ${result.destinationPath ?? "-"}`,
      );
      if (result.error) {
        problems.push(`${entry.key}/${source.kind}: ${result.error}`);
        console.log(`      ERROR: ${result.error}`);
      }
      for (const s of result.skipped) console.log(`      skipped: ${s}`);
    }
  }

  console.log(
    `\nbooks added/updated: ${books}   editions imported: ${editions}   files: ${files}`,
  );
  if (problems.length > 0) {
    console.log(`\nproblems (${problems.length}):`);
    for (const p of problems) console.log(`  - ${p}`);
  }
}
