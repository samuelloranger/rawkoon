/**
 * Seed a representative library for performance-baseline measurement.
 *
 * This inserts synthetic movies, shows (with episodes), books (with editions and
 * files) and their media_files so the p50/p95 report driver has realistic row
 * counts to measure against BEFORE any optimization work. It touches ONLY a
 * reserved namespace — movies/shows use tmdb_id >= 990_000_000, books use a
 * "seed-" google_volume_id prefix, authors use a "Seed Author" name prefix — so
 * it never collides with or clobbers real library data.
 *
 * Idempotent: parents are upserted by their unique key; children (episodes,
 * media_files, book_files, book_author links) are deleted by parent and
 * recreated, so re-running with the same size converges to the same rows.
 *
 * Usage (from monorepo root):
 *   cd apps/api && bun --env-file=../../.env src/scripts/seedBaseline.ts small
 *   cd apps/api && bun --env-file=../../.env src/scripts/seedBaseline.ts medium
 *   cd apps/api && bun --env-file=../../.env src/scripts/seedBaseline.ts large
 *   cd apps/api && bun --env-file=../../.env src/scripts/seedBaseline.ts --clean
 */

import { prisma } from "@rawkoon/api/db";

/** Reserved id space so seed rows never touch real ones. */
const TMDB_BASE = 990_000_000;
const BOOK_VOLUME_PREFIX = "seed-vol-";
const AUTHOR_NAME_PREFIX = "Seed Author ";

type SizeName = "small" | "medium" | "large";

interface SizeSpec {
  movies: number;
  shows: number;
  episodesPerShow: number;
  books: number;
}

const SIZES: Record<SizeName, SizeSpec> = {
  small: { movies: 25, shows: 5, episodesPerShow: 10, books: 20 },
  medium: { movies: 500, shows: 40, episodesPerShow: 20, books: 150 },
  large: { movies: 3000, shows: 150, episodesPerShow: 30, books: 600 },
};

/** Run `fn` over `items` with bounded concurrency to keep the DB busy but sane. */
async function inBatches<T>(
  items: T[],
  size: number,
  fn: (item: T, index: number) => Promise<void>,
): Promise<void> {
  for (let i = 0; i < items.length; i += size) {
    const slice = items.slice(i, i + size);
    await Promise.all(slice.map((item, j) => fn(item, i + j)));
  }
}

const CONCURRENCY = 25;
const RESOLUTIONS = [720, 1080, 2160];
const SOURCES = ["web", "bluray", "webrip"];

async function seedMovies(count: number): Promise<void> {
  const indices = Array.from({ length: count }, (_, i) => i);
  await inBatches(indices, CONCURRENCY, async (i) => {
    const tmdbId = TMDB_BASE + i;
    const title = `Seed Movie ${i}`;
    const year = 1980 + (i % 45);
    const media = await prisma.libraryMedia.upsert({
      where: { tmdbId },
      update: { title, year, listTitle: title, listYear: year },
      create: {
        tmdbId,
        type: "movie",
        title,
        year,
        status: "downloaded",
        monitored: true,
        listTitle: title,
        listYear: year,
      },
    });

    await prisma.mediaFile.deleteMany({ where: { mediaId: media.id } });
    await prisma.mediaFile.create({
      data: {
        mediaId: media.id,
        filePath: `/library/movies/${title} (${year})/${title} (${year}).mkv`,
        fileName: `${title} (${year}).mkv`,
        sizeBytes: BigInt(2_000_000_000 + i * 1000),
        durationSecs: 5400 + (i % 60) * 60,
        resolution: RESOLUTIONS[i % RESOLUTIONS.length],
        source: SOURCES[i % SOURCES.length],
        videoCodec: "h264",
        languageTags: ["en"],
      },
    });
  });
}

async function seedShows(
  count: number,
  episodesPerShow: number,
): Promise<void> {
  const indices = Array.from({ length: count }, (_, i) => i);
  await inBatches(
    indices,
    Math.max(1, Math.floor(CONCURRENCY / 4)),
    async (i) => {
      const tmdbId = TMDB_BASE + 500_000 + i;
      const title = `Seed Show ${i}`;
      const year = 1990 + (i % 35);
      const media = await prisma.libraryMedia.upsert({
        where: { tmdbId },
        update: { title, year, listTitle: title, listYear: year },
        create: {
          tmdbId,
          type: "show",
          title,
          year,
          status: "returning",
          monitored: true,
          listTitle: title,
          listYear: year,
        },
      });

      // Clear children, then recreate deterministically.
      await prisma.libraryEpisode.deleteMany({ where: { mediaId: media.id } });
      await prisma.mediaFile.deleteMany({ where: { mediaId: media.id } });

      for (let e = 0; e < episodesPerShow; e++) {
        const season = Math.floor(e / 10) + 1;
        const episode = (e % 10) + 1;
        const downloaded = e % 3 !== 0; // ~2/3 have a file
        const ep = await prisma.libraryEpisode.create({
          data: {
            mediaId: media.id,
            season,
            episode,
            title: `Episode ${episode}`,
            status: downloaded ? "downloaded" : "wanted",
            monitored: true,
            downloadedAt: downloaded ? new Date() : null,
          },
        });
        if (downloaded) {
          const name = `${title} - S${String(season).padStart(2, "0")}E${String(episode).padStart(2, "0")}.mkv`;
          await prisma.mediaFile.create({
            data: {
              mediaId: media.id,
              episodeId: ep.id,
              filePath: `/library/shows/${title}/Season ${season}/${name}`,
              fileName: name,
              sizeBytes: BigInt(1_200_000_000 + e * 1000),
              durationSecs: 2600,
              resolution: RESOLUTIONS[e % RESOLUTIONS.length],
              source: SOURCES[e % SOURCES.length],
              videoCodec: "h265",
              languageTags: ["en"],
            },
          });
        }
      }
    },
  );
}

async function seedBooks(count: number): Promise<void> {
  const indices = Array.from({ length: count }, (_, i) => i);
  await inBatches(
    indices,
    Math.max(1, Math.floor(CONCURRENCY / 4)),
    async (i) => {
      const authorName = `${AUTHOR_NAME_PREFIX}${i % Math.max(1, Math.floor(count / 4))}`;
      const author = await prisma.author.upsert({
        where: { googleAuthorName: authorName },
        update: {},
        create: { googleAuthorName: authorName, sortName: authorName },
      });

      const volumeId = `${BOOK_VOLUME_PREFIX}${i}`;
      const title = `Seed Book ${i}`;
      const year = 1970 + (i % 55);
      const book = await prisma.libraryBook.upsert({
        where: { googleVolumeId: volumeId },
        update: {
          title,
          publishedYear: year,
          listTitle: title,
          listYear: year,
          authors: [authorName],
        },
        create: {
          googleVolumeId: volumeId,
          title,
          language: i % 5 === 0 ? "fr" : "en",
          publishedYear: year,
          listTitle: title,
          listYear: year,
          authors: [authorName],
        },
      });

      await prisma.bookAuthor.deleteMany({ where: { bookId: book.id } });
      await prisma.bookAuthor.create({
        data: { bookId: book.id, authorId: author.id, role: "author" },
      });

      // One ebook + one audiobook edition, each with a file.
      const editions: Array<{ kind: string; format: string; ext: string }> = [
        { kind: "ebook", format: "epub", ext: "epub" },
        { kind: "audiobook", format: "m4b", ext: "m4b" },
      ];
      for (const spec of editions) {
        const edition = await prisma.bookEdition.upsert({
          where: { bookId_kind: { bookId: book.id, kind: spec.kind } },
          update: { status: "downloaded" },
          create: { bookId: book.id, kind: spec.kind, status: "downloaded" },
        });
        await prisma.bookFile.deleteMany({ where: { editionId: edition.id } });
        await prisma.bookFile.create({
          data: {
            editionId: edition.id,
            filePath: `/library/books/${authorName}/${title} (${year})/${title}.${spec.ext}`,
            fileName: `${title}.${spec.ext}`,
            sizeBytes: BigInt(
              spec.kind === "audiobook" ? 400_000_000 : 3_000_000,
            ),
            format: spec.format,
            durationSecs: spec.kind === "audiobook" ? 32000 : null,
            languageTags: [i % 5 === 0 ? "fr" : "en"],
          },
        });
      }
    },
  );
}

/** Remove every seed-namespaced row (cascades handle children). */
async function clean(): Promise<void> {
  const media = await prisma.libraryMedia.deleteMany({
    where: { tmdbId: { gte: TMDB_BASE } },
  });
  const books = await prisma.libraryBook.deleteMany({
    where: { googleVolumeId: { startsWith: BOOK_VOLUME_PREFIX } },
  });
  const authors = await prisma.author.deleteMany({
    where: { googleAuthorName: { startsWith: AUTHOR_NAME_PREFIX } },
  });
  console.log(
    `Removed ${media.count} library_media, ${books.count} library_books, ${authors.count} authors (seed namespace).`,
  );
}

async function main(): Promise<void> {
  const arg = (process.argv[2] ?? "small").toLowerCase();

  if (arg === "--clean" || arg === "clean") {
    await clean();
    return;
  }

  if (!(arg in SIZES)) {
    console.error(
      `Unknown size "${arg}". Use one of: small | medium | large | --clean`,
    );
    process.exit(1);
  }

  const spec = SIZES[arg as SizeName];
  const startedAt = Date.now();
  console.log(
    `Seeding "${arg}" library: ${spec.movies} movies, ${spec.shows} shows x ${spec.episodesPerShow} eps, ${spec.books} books...`,
  );

  console.log("  - movies");
  await seedMovies(spec.movies);
  console.log("  - shows + episodes");
  await seedShows(spec.shows, spec.episodesPerShow);
  console.log("  - books + editions");
  await seedBooks(spec.books);

  const [movieCount, showCount, epCount, fileCount, bookCount] =
    await Promise.all([
      prisma.libraryMedia.count({ where: { type: "movie" } }),
      prisma.libraryMedia.count({ where: { type: "show" } }),
      prisma.libraryEpisode.count(),
      prisma.mediaFile.count(),
      prisma.libraryBook.count(),
    ]);

  console.log(`\nDone in ${Date.now() - startedAt}ms. Totals now:`);
  console.table({
    movies: movieCount,
    shows: showCount,
    episodes: epCount,
    media_files: fileCount,
    books: bookCount,
  });
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
