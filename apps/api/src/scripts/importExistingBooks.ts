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
import { addBookFromVolume } from "@rawkoon/api/services/books/bookLibrary";
import { getBookMetadataProvider } from "@rawkoon/api/services/books";
import { postProcessBook } from "@rawkoon/api/services/postProcessorBook";
import {
  formatForPath,
  readEbookMetadata,
} from "@rawkoon/api/utils/books/ebookMetadata";
import { isAudiobookFormat } from "@rawkoon/api/utils/books/bookReleaseParser";
import { renderBookTemplate } from "@rawkoon/api/utils/medias/fileTemplate";
import type { BookEditionKind } from "@rawkoon/shared/types";

const BOOKS = "/mnt/storage/Books";
const AUDIO = "/mnt/storage/Audiobooks";

interface Source {
  kind: BookEditionKind;
  /** File for a single-format ebook, directory for everything else. */
  path: string;
  /**
   * Register the file where it already is instead of placing it under the
   * library template.
   *
   * The escape hatch for a destination the API cannot create: the container
   * runs as uid 1000, and an author directory owned by root makes the template
   * mkdir fail with EACCES. Registering in place keeps the book usable — only
   * its path is off-template — and moves nothing on disk. Ebook only: an
   * audiobook needs the MediaInfo pass for duration and narrators,
   * which is postProcessBook's job.
   */
  inPlace?: boolean;
}

interface Entry {
  /** Stable handle for logs and --only. */
  key: string;
  /** Google Books search query used by --resolve. */
  query: string;
  /** Filled in from --resolve output. Required by --dry-run and --apply. */
  volumeId?: string;
  /** What the volume is expected to be, so a bad match is obvious in review. */
  expect: string;
  /**
   * Overwrite the language the provider reported, after the book is created.
   *
   * Needed for volumes whose ISBN is registered in a group that disagrees with
   * the text: the Pottermore French Harry Potter ebooks are registered under
   * the UK group, so reconciliation calls them English. Applied post-create
   * because addBookFromVolume only sets language on insert — its refresh path
   * leaves language alone, so this is not fighting a later metadata refresh.
   */
  forceLanguage?: string;
  sources: Source[];
}

const HP = `${BOOKS}/J.K. Rowling - Harry Potter`;
const HPA = `${AUDIO}/Harry Potter`;
const MAAS = `${BOOKS}/Sarah Maas`;
const YARROS = `${BOOKS}/Rebecca Yaros`;

const MANIFEST: Entry[] = [
  // ---- J.K. Rowling, Harry Potter (fr) — ebook (epub+mobi) and audiobook ----
  // The Pottermore French editions, which are the only self-consistent set:
  // one author spelling, French titles, cover and description on all seven.
  // The per-book French volumes were rejected because they spell the author
  // three different ways — splitting one person into three Author rows and
  // three library folders — and one of them carries an English title.
  // Their ISBNs are UK-registered, so forceLanguage corrects the language.
  {
    key: "hp1",
    query: 'intitle:"Harry Potter à l\'école des sorciers" inauthor:Rowling',
    volumeId: "nvijsUyJYR4C",
    forceLanguage: "fr",
    expect: "Harry Potter à l'école des sorciers (fr)",
    sources: [
      {
        kind: "ebook",
        path: `${HP}/Harry Potter - T01 - Harry Potter a l'Ecole des Sorciers (9)`,
      },
      {
        kind: "audiobook",
        path: `${HPA}/(1997) Harry Potter à l’école des sorciers`,
      },
    ],
  },
  {
    key: "hp2",
    query: 'intitle:"Harry Potter et la Chambre des secrets" inauthor:Rowling',
    volumeId: "GBl6MWssicEC",
    forceLanguage: "fr",
    expect: "Harry Potter et la Chambre des secrets (fr)",
    sources: [
      {
        kind: "ebook",
        path: `${HP}/Harry Potter - T02 - Harry Potter et la Chambre des Secrets (12)`,
      },
      {
        kind: "audiobook",
        path: `${HPA}/(1998) Harry Potter et la Chambre des Secrets`,
      },
    ],
  },
  {
    key: "hp3",
    query:
      'intitle:"Harry Potter et le prisonnier d\'Azkaban" inauthor:Rowling',
    volumeId: "vWxokFDTpy4C",
    forceLanguage: "fr",
    expect: "Harry Potter et le prisonnier d'Azkaban (fr)",
    sources: [
      {
        kind: "ebook",
        path: `${HP}/Harry Potter - T03 - Harry Potter et le Prisonnier d'Azkaban (13)`,
      },
      {
        kind: "audiobook",
        path: `${HPA}/(1999) Harry Potter et le prisonnier d’Azkaban`,
      },
    ],
  },
  {
    key: "hp4",
    query: 'intitle:"Harry Potter et la Coupe de feu" inauthor:Rowling',
    volumeId: "ox9BiuVKM1cC",
    forceLanguage: "fr",
    expect: "Harry Potter et la Coupe de feu (fr)",
    sources: [
      {
        kind: "ebook",
        path: `${HP}/Harry Potter - T04 - Harry Potter et la Coupe de Feu (15)`,
      },
      {
        kind: "audiobook",
        path: `${HPA}/(2000) Harry Potter et la Coupe de Feu`,
      },
    ],
  },
  {
    key: "hp5",
    query: 'intitle:"Harry Potter et l\'Ordre du Phénix" inauthor:Rowling',
    volumeId: "d1Fm_U1LzY4C",
    forceLanguage: "fr",
    expect: "Harry Potter et l'Ordre du Phénix (fr)",
    sources: [
      {
        kind: "ebook",
        path: `${HP}/Harry Potter - T05 - Harry Potter et l'Ordre du Phenix (14)`,
      },
      {
        kind: "audiobook",
        path: `${HPA}/(2003) Harry Potter et l’Ordre du Phénix`,
      },
    ],
  },
  {
    key: "hp6",
    query: 'intitle:"Harry Potter et le Prince de Sang-Mêlé" inauthor:Rowling',
    volumeId: "YoVZxxIVvnQC",
    forceLanguage: "fr",
    expect: "Harry Potter et le Prince de Sang-Mêlé (fr)",
    sources: [
      {
        kind: "ebook",
        path: `${HP}/Harry Potter - T06 - Harry Potter et le Prince de Sang-Mele (11)`,
      },
      {
        kind: "audiobook",
        path: `${HPA}/(2005) Harry Potter et le Prince de Sang-Mêlé`,
      },
    ],
  },
  {
    key: "hp7",
    query: 'intitle:"Harry Potter et les Reliques de la Mort" inauthor:Rowling',
    volumeId: "Z8GBngEACAAJ",
    forceLanguage: "fr",
    expect: "Harry Potter et les Reliques de la Mort (fr)",
    sources: [
      {
        kind: "ebook",
        path: `${HP}/Harry Potter - T07 - Harry Potter et les Reliques de la Mort (10)`,
      },
      {
        kind: "audiobook",
        path: `${HPA}/(2007) Harry Potter et les Reliques de la Mort`,
      },
    ],
  },

  // ---- Sarah J. Maas, Un palais d'épines et de roses (fr) ----
  // Titled by real book title rather than by series position. The de Saxus
  // "Un Palais d'épines et de roses TN" volumes carry series metadata and
  // descriptions, but show a position where the title belongs, so the actual
  // name of each book would appear nowhere in the library.
  {
    key: "acotar1",
    query: 'intitle:"Un palais d\'épines et de roses" inauthor:Maas',
    volumeId: "OlkOugEACAAJ",
    // The source epub is a 2-in-1 bundle ("tomes 1 et 3"), so this edition
    // holds tome 3 as well. Splitting it would mean splitting the file.
    expect:
      "Un palais d'épines et de roses T1 (fr) — source epub bundles T1+T3",
    sources: [
      {
        kind: "ebook",
        path: `${MAAS}/Un Palais d'epines et de roses - Sarah J. Maas.epub`,
      },
      {
        kind: "audiobook",
        path: `${AUDIO}/Sarah J. Maas  - Un palais d'épines et de rose 1 [mp3-64]`,
      },
    ],
  },
  {
    key: "acotar2",
    query: "Un palais de colère et de brume Sarah J Maas",
    volumeId: "tRPbswEACAAJ",
    expect: "Un palais d'épines et de roses T2, colère et brume (fr)",
    sources: [
      {
        kind: "ebook",
        path: `${MAAS}/Un Palais de colere et de brume - Sarah J. Maas.epub`,
      },
    ],
  },
  {
    key: "acotar3",
    query: "Un Palais d'épines et de roses T3 Sarah J Maas",
    volumeId: "9QTMxgEACAAJ",
    expect: "Un palais d'épines et de roses T3, cendres et ruines (fr)",
    sources: [
      {
        kind: "ebook",
        path: `${MAAS}/Un palais de cendres et de ruin - Sarah J. Maas.epub`,
      },
    ],
  },
  {
    key: "acotar4",
    query: "Un palais de glace et de lumière Sarah J Maas",
    volumeId: "KcEkygEACAAJ",
    expect: "Un palais d'épines et de roses T3.5, glace et lumière (fr)",
    sources: [
      {
        kind: "ebook",
        path: `${MAAS}/Un palais de glace et de lumier - Sarah J. Maas.epub`,
      },
    ],
  },
  {
    key: "acotar5",
    query: "Un palais de flammes d'argent Sarah J Maas",
    volumeId: "T6u7zgEACAAJ",
    expect: "Un palais d'épines et de roses T5, flammes d'argent (fr)",
    sources: [
      {
        kind: "ebook",
        path: `${MAAS}/Sarah J. Maas - Un Palais de flammes d'argent (2021).epub`,
      },
    ],
  },

  // ---- Rebecca Yarros, The Empyrean (fr) ----
  // The audiobooks are French ("Livre Audio", French chapter titles), so the
  // French editions are the right match.
  {
    key: "empyrean1",
    query: "Fourth Wing Rebecca Yarros français",
    volumeId: "PzfpEAAAQBAJ",
    // Audiobook only: "Fourth Wing - Rebecca Yarros.epub" is a truncated
    // download — valid EPUB header, no end-of-central-directory — so it is
    // left on disk rather than registered as a readable ebook.
    expect: "Fourth Wing VF / Empyrean 1 (fr), audiobook only",
    sources: [
      {
        kind: "audiobook",
        path: `${AUDIO}/Rebecca Yarros - The Empyrean 1 - Fourth Wing`,
      },
    ],
  },
  {
    key: "empyrean2",
    query: "Iron Flame Rebecca Yarros français",
    volumeId: "q7jvEAAAQBAJ",
    expect: "Iron Flame VF / Empyrean 2 (fr), audiobook only",
    sources: [
      {
        kind: "audiobook",
        path: `${AUDIO}/Rebecca Yarros - The Empyrean 2 - Iron Flame`,
      },
    ],
  },
  {
    key: "empyrean3",
    query: "Onyx Storm Rebecca Yarros français",
    volumeId: "-yU9EQAAQBAJ",
    expect: "Onyx Storm VF / Empyrean 3 (fr) — the (anglais) epub is skipped",
    sources: [
      { kind: "ebook", path: `${YARROS}/Onyx Storm - Rebecca Yarros.epub` },
    ],
  },

  // ---- Suzanne Collins, Hunger Games (fr) ----
  {
    key: "hg1",
    query: "Hunger Games Suzanne Collins tome 1",
    volumeId: "lEnrxE2FUFAC",
    expect: "Hunger Games tome 1 (fr)",
    sources: [
      {
        kind: "ebook",
        path: `${BOOKS}/Hunger Games/[Tome 1] Hunger Games.epub`,
      },
    ],
  },
  {
    key: "hg2",
    query: "Hunger Games tome 2 L'embrasement Suzanne Collins",
    volumeId: "m5M_8vnQWe8C",
    expect: "Hunger Games tome 2, L'embrasement (fr)",
    sources: [
      {
        kind: "ebook",
        path: `${BOOKS}/Hunger Games/[Tome 2] Hunger Games - L'Embrasement.epub`,
      },
    ],
  },
  {
    key: "hg3",
    query: "Hunger Games tome 3 La révolte Suzanne Collins",
    volumeId: "bxgqqjEEsRQC",
    expect: "Hunger Games tome 3, La révolte (fr)",
    sources: [
      {
        kind: "ebook",
        path: `${BOOKS}/Hunger Games/[Tome 3] Hunger Games - La Révolte.epub`,
      },
    ],
  },

  // ---- Colleen Hoover (fr) ----
  // The matching pdfs stay on disk: the profile prefers epub, and a second
  // format of a book already in the library adds nothing here.
  {
    key: "hoover-jamais-plus",
    query: 'intitle:"Jamais plus" inauthor:Hoover',
    volumeId: "43g9DgAAQBAJ",
    expect:
      "Jamais plus (fr) — It Ends With Us pdf is the en duplicate, skipped",
    sources: [
      {
        kind: "ebook",
        path: `${BOOKS}/Coleen Hoover/Jamais plus - Colleen Hoover.epub`,
      },
    ],
  },
  {
    key: "hoover-souvenirs",
    query: "Reminders of Him Souvenirs de lui Colleen Hoover",
    volumeId: "5xvpEAAAQBAJ",
    // Published in French first as "Souvenirs de lui", reissued under the
    // English title; same book, and this is the edition Google carries.
    expect: "Souvenirs de lui / Reminders of him VF (fr)",
    sources: [
      {
        kind: "ebook",
        path: `${BOOKS}/Coleen Hoover/Souvenirs de Lui - Colleen Hoover (fr).epub`,
      },
    ],
  },

  // ---- Freida McFadden — only the titles not already in the library ----
  // "Never Lie (2022).epub" is NOT Never Lie: its OPF says "La psy", which is
  // already book 4 in the library. It stays on disk.
  {
    key: "mcfadden-boyfriend",
    query: "Le boyfriend Freida McFadden",
    volumeId: "UrhzEQAAQBAJ",
    expect: "Le boyfriend (fr, 2025)",
    sources: [
      {
        kind: "ebook",
        path: `${BOOKS}/Freida McFadden/Le.Boyfriend.2025.Frieda.McFadden.epub`,
      },
    ],
  },

  // ---- Titles whose filenames were English but whose files are French ----
  // Each of these epubs declares fr in its OPF, so the French edition is the
  // correct match despite the English filename.
  {
    key: "weir-martian",
    query: "Seul sur Mars Andy Weir",
    volumeId: "1eKuoAEACAAJ",
    expect: "Seul sur Mars (fr) — file named 'The Martian', OPF says fr",
    sources: [
      {
        kind: "ebook",
        path: `${BOOKS}/Andy Weir/The Martian (2011).epub`,
        inPlace: true,
      },
    ],
  },
  {
    key: "weir-phm",
    query: "Projet Dernière Chance Andy Weir",
    volumeId: "9JQ2EAAAQBAJ",
    expect: "Projet Dernière Chance (fr) — file named 'Project Hail Mary'",
    sources: [
      {
        kind: "ebook",
        path: `${BOOKS}/Andy Weir/Project Hail Mary (2021).epub`,
        inPlace: true,
      },
    ],
  },
  {
    key: "grace-icebreaker",
    query: "Icebreaker Maple Hills Tome 1 Hannah Grace",
    volumeId: "Ghe1EAAAQBAJ",
    expect: "Icebreaker, Maple Hills T1, édition française (fr)",
    sources: [
      {
        kind: "ebook",
        path: `${BOOKS}/Hannah Grace/Icebreaker - Hannah Grace.epub`,
      },
    ],
  },

  // ---- Québec / misc (fr) ----
  {
    key: "morrissette-mises-en-scene",
    query: "Mises en scène Guillaume Morrissette",
    volumeId: "c8eDEQAAQBAJ",
    expect: "Mises en scène (fr), Guillaume Morrissette",
    sources: [
      {
        kind: "ebook",
        path: `${BOOKS}/Guillaume Morrissette/Mises en scène - Guillaume Morrissette.epub`,
      },
    ],
  },
  {
    key: "kitten-borderline1",
    query: 'intitle:"Borderline" inauthor:"Joyce Kitten"',
    volumeId: "gdNw0AEACAAJ",
    expect: "Borderline Tome 1 (fr), Joyce Kitten",
    sources: [
      {
        kind: "ebook",
        path: `${BOOKS}/Joyce Kitten/Joyce Kitten - Borderline, Tome 1.epub`,
      },
    ],
  },
];

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

async function apply(entries: Entry[]): Promise<void> {
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
