/**
 * Register books and audiobooks that already sit in the library folders.
 *
 * The download path is the only way a book normally enters the library, so a
 * collection that predates the books feature is invisible to rawkoon. This
 * script closes that gap for a one-time backfill. It deliberately owns no
 * import logic of its own — it curates metadata and then calls the same two
 * functions the web add flow and the post-processor use:
 *
 *   addBookFromVolume()  -> library_books + authors + book_authors + editions
 *   postProcessBook()    -> template layout, probe, book_files
 *
 * so a backfilled row is indistinguishable from a downloaded one.
 *
 * The manifest below is hand-written on purpose. Filenames in a real
 * collection are too inconsistent to match automatically ("Un palais de glace
 * et de lumier", "La.Femme.De.Menage.2023"), and a wrong auto-match writes a
 * wrong book into the library silently.
 *
 * Usage, from inside the container:
 *   docker compose exec rawkoon bun src/scripts/importExistingBooks.ts --resolve
 *   docker compose exec rawkoon bun src/scripts/importExistingBooks.ts --dry-run
 *   docker compose exec rawkoon bun src/scripts/importExistingBooks.ts --apply
 *
 * --resolve prints Google Books candidates per entry plus the language embedded
 * in each source epub, and changes nothing. Paste the chosen volumeId into the
 * manifest, then --dry-run, then --apply.
 *
 * Both --dry-run and --apply refuse to run while any entry lacks a volumeId.
 * --only <key> restricts every mode to one entry, which is how to test one
 * book before committing to the whole set.
 *
 * Re-running --apply is safe: addBookFromVolume upserts, and postProcessBook
 * replaces a book_file row by destination path instead of accumulating.
 */

import { stat } from "node:fs/promises";
import { basename } from "node:path";

import { prisma } from "@rawkoon/api/db";
import { getBookMetadataProvider } from "@rawkoon/api/services/books";
import { apply } from "@rawkoon/api/scripts/importExistingBooksApply";
import {
  type Entry,
  MANIFEST,
} from "@rawkoon/api/scripts/importExistingBooksManifest";
import { readEbookMetadata } from "@rawkoon/api/utils/books/ebookMetadata";
import { renderBookTemplate } from "@rawkoon/api/utils/medias/fileTemplate";

/**
 * One line per candidate. The cover/desc columns matter: a volume with neither
 * produces a library entry with no art and no synopsis, which is usually reason
 * enough to prefer a different edition of the same book.
 */
function formatCandidate(c: {
  volumeId: string;
  language: string;
  publishedYear: number | null;
  coverUrl: string | null;
  overview: string | null;
  title: string;
  authors: string[];
  seriesName: string | null;
  seriesPosition: number | null;
}): string {
  const series = c.seriesName
    ? ` series="${c.seriesName}"${c.seriesPosition != null ? ` #${c.seriesPosition}` : ""}`
    : "";
  return (
    `  ${c.volumeId}  [${c.language}] ${c.publishedYear ?? "????"}` +
    ` ${c.coverUrl ? "cover" : "  -  "} ${c.overview ? "desc" : "    "}` +
    `  ${c.title} — ${c.authors.join(", ")}${series}`
  );
}

const hasFlag = (name: string): boolean => process.argv.includes(`--${name}`);

const argValue = (name: string): string | null => {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx === -1) return null;
  const value = process.argv[idx + 1];
  if (!value || value.startsWith("--")) return null;
  return value;
};

function selectEntries(): Entry[] {
  const only = argValue("only");
  if (!only) return MANIFEST;
  const keys = new Set(only.split(",").map((k) => k.trim()));
  const picked = MANIFEST.filter((e) => keys.has(e.key));
  if (picked.length === 0) {
    console.error(`No manifest entry matches --only ${only}`);
    process.exit(1);
  }
  return picked;
}

/** Every source path must exist before anything is written. */
async function checkSources(entries: Entry[]): Promise<boolean> {
  let ok = true;
  for (const entry of entries) {
    for (const source of entry.sources) {
      try {
        await stat(source.path);
      } catch {
        console.error(
          `  MISSING [${entry.key}] ${source.kind}: ${source.path}`,
        );
        ok = false;
      }
    }
  }
  return ok;
}

async function resolve(entries: Entry[]): Promise<void> {
  const provider = await getBookMetadataProvider();
  if (!provider) {
    console.error(
      "Google Books is not configured — run configureBooks.ts --google-key first.",
    );
    process.exit(1);
  }

  for (const entry of entries) {
    console.log(`\n=== ${entry.key} — ${entry.expect}`);
    if (entry.volumeId) console.log(`  already set: ${entry.volumeId}`);

    // The language embedded in the epub is the only trustworthy signal for a
    // file whose name says nothing about it.
    for (const source of entry.sources) {
      if (
        source.kind !== "ebook" ||
        !source.path.toLowerCase().endsWith(".epub")
      ) {
        continue;
      }
      try {
        const meta = await readEbookMetadata(source.path);
        console.log(
          `  epub says: language=${meta.language ?? "?"} title=${meta.title ?? "?"} authors=${meta.authors.join(", ") || "?"}`,
        );
      } catch {
        console.log("  epub metadata unreadable");
      }
    }

    let candidates;
    try {
      candidates = await provider.searchBooks(entry.query, { limit: 5 });
    } catch (e) {
      console.log(`  search failed: ${e instanceof Error ? e.message : e}`);
      continue;
    }
    if (candidates.length === 0) {
      console.log(`  no candidates for query: ${entry.query}`);
      continue;
    }
    for (const c of candidates) console.log(formatCandidate(c));
  }
}

/**
 * Ad-hoc provider search, for when a manifest query returns nothing usable.
 * Google Books answers `intitle:`/`inauthor:` far worse than plain text for
 * translated editions and small French publishers, so chasing a volume by hand
 * is a normal part of resolving.
 */
async function search(query: string): Promise<void> {
  const provider = await getBookMetadataProvider();
  if (!provider) {
    console.error("Google Books is not configured.");
    process.exit(1);
  }
  const candidates = await provider.searchBooks(query, { limit: 10 });
  if (candidates.length === 0) {
    console.log(`no candidates for: ${query}`);
    return;
  }
  for (const c of candidates) console.log(formatCandidate(c));
}

/**
 * Inspect specific volumes exactly as the importer will see them.
 *
 * searchBooks and getBook do not always agree: getBook resolves a fuller
 * record, so its ISBN — and therefore the reconciled language — can differ
 * from what the search hit reported. Only this view is authoritative.
 */
async function inspectVolumes(ids: string): Promise<void> {
  const provider = await getBookMetadataProvider();
  if (!provider) {
    console.error("Google Books is not configured.");
    process.exit(1);
  }
  for (const id of ids.split(",").map((v) => v.trim())) {
    const meta = await provider.getBook(id);
    if (!meta) {
      console.log(`  ${id}  NOT FOUND`);
      continue;
    }
    console.log(formatCandidate(meta));
  }
}

async function describeDestinations(entries: Entry[]): Promise<void> {
  const settings = await prisma.mediaSettings.findUnique({
    where: { id: 1 },
    select: {
      booksLibraryPath: true,
      audiobooksLibraryPath: true,
      bookTemplate: true,
      audiobookTemplate: true,
      fileOperation: true,
    },
  });
  const provider = await getBookMetadataProvider();
  if (!settings || !provider) {
    console.error("Media settings or Google Books provider unavailable.");
    process.exit(1);
  }

  console.log(`file operation: ${settings.fileOperation}`);
  for (const entry of entries) {
    const meta = await provider.getBook(entry.volumeId as string);
    if (!meta) {
      console.log(`\n=== ${entry.key}: VOLUME NOT FOUND ${entry.volumeId}`);
      continue;
    }
    console.log(
      `\n=== ${entry.key}: ${meta.title} — ${meta.authors.join(", ")} [${meta.language}] ${meta.publishedYear ?? "????"}`,
    );
    console.log(`  expected: ${entry.expect}`);
    if (entry.forceLanguage && entry.forceLanguage !== meta.language) {
      console.log(
        `  language: ${meta.language} -> ${entry.forceLanguage} (forced)`,
      );
    }
    for (const source of entry.sources) {
      const root =
        source.kind === "audiobook"
          ? settings.audiobooksLibraryPath
          : settings.booksLibraryPath;
      const template =
        source.kind === "audiobook"
          ? settings.audiobookTemplate
          : settings.bookTemplate;
      const rendered = renderBookTemplate(template ?? "", {
        author: meta.authors[0] ?? null,
        title: meta.title,
        year: meta.publishedYear,
        // Illustrative only: postProcessBook picks the real best format from
        // what the source actually holds.
        format: source.kind === "audiobook" ? "mp3" : "epub",
        language: meta.language,
      });
      console.log(`  ${source.kind}: ${source.path}`);
      if (source.inPlace) console.log("      -> registered in place (no move)");
      else console.log(`      -> ${root}/${rendered}`);
    }
  }
}

async function main(): Promise<void> {
  const adhoc = argValue("search");
  if (adhoc) {
    await search(adhoc);
    return;
  }

  const volumes = argValue("volume");
  if (volumes) {
    await inspectVolumes(volumes);
    return;
  }

  const entries = selectEntries();
  const mode = hasFlag("resolve")
    ? "resolve"
    : hasFlag("dry-run")
      ? "dry-run"
      : hasFlag("apply")
        ? "apply"
        : null;

  if (!mode) {
    console.log(
      "Pass one of --resolve, --dry-run, --apply (optionally --only key[,key]).",
    );
    return;
  }

  console.log(`mode: ${mode}   entries: ${entries.length}`);

  if (!(await checkSources(entries))) {
    console.error("\nSource paths are missing — fix the manifest first.");
    process.exit(1);
  }

  if (mode === "resolve") {
    await resolve(entries);
    return;
  }

  const unresolved = entries.filter((e) => !e.volumeId);
  if (unresolved.length > 0) {
    console.error(
      `\n${unresolved.length} entr${unresolved.length === 1 ? "y" : "ies"} still ` +
        `without a volumeId: ${unresolved.map((e) => e.key).join(", ")}`,
    );
    console.error("Run --resolve and fill the manifest in before continuing.");
    process.exit(1);
  }

  if (mode === "dry-run") await describeDestinations(entries);
  else await apply(entries);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
