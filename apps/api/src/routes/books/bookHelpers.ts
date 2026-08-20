import type {
  Book,
  BookEdition,
  BookEditionKind,
  BookFormat,
} from "@rawkoon/shared/types";

/** Prisma include shape used by every route that returns a full book. */
export const bookInclude = {
  editions: {
    include: {
      bookQualityProfile: { select: { id: true, name: true } },
      files: {
        select: { id: true, format: true },
      },
    },
    orderBy: { kind: "asc" as const },
  },
} as const;

type MappableEdition = {
  id: number;
  kind: string;
  status: string;
  monitored: boolean;
  bookQualityProfileId: number | null;
  bookQualityProfile: { id: number; name: string } | null;
  narrators: string[];
  durationSecs: number | null;
  searchAttempts: number;
  lastGrabbedAt: Date | null;
  totalSizeBytes: bigint | null;
  files: { id: number; format: string }[];
};

type MappableBook = {
  id: number;
  googleVolumeId: string;
  isbn13: string | null;
  title: string;
  sortTitle: string | null;
  subtitle: string | null;
  overview: string | null;
  coverUrl: string | null;
  authors: string[];
  language: string;
  publishedYear: number | null;
  seriesName: string | null;
  seriesPosition: number | null;
  overrides?: unknown;
  addedAt: Date;
  updatedAt: Date;
  editions: MappableEdition[];
};

/**
 * Preference order used to pick an edition's displayed format. Mirrors the
 * seeded profile order, so an edition holding both epub and pdf shows "epub".
 */
const FORMAT_RANK: BookFormat[] = [
  "epub",
  "azw3",
  "mobi",
  "cbz",
  "pdf",
  "m4b",
  "flac",
  "mp3",
  "ogg",
];

const bestFormat = (files: { format: string }[]): BookFormat | null => {
  let best: BookFormat | null = null;
  let bestIdx = Number.POSITIVE_INFINITY;
  for (const f of files) {
    const idx = FORMAT_RANK.indexOf(f.format as BookFormat);
    if (idx !== -1 && idx < bestIdx) {
      bestIdx = idx;
      best = f.format as BookFormat;
    }
  }
  return best;
};

export function mapBookEdition(e: MappableEdition): BookEdition {
  return {
    id: e.id,
    kind: e.kind as BookEditionKind,
    status: e.status as BookEdition["status"],
    monitored: e.monitored,
    book_quality_profile_id: e.bookQualityProfileId,
    book_quality_profile: e.bookQualityProfile,
    narrators: e.narrators,
    duration_secs: e.durationSecs,
    search_attempts: e.searchAttempts,
    last_grabbed_at: e.lastGrabbedAt?.toISOString() ?? null,
    total_size_bytes: e.totalSizeBytes?.toString() ?? null,
    file_count: e.files.length,
    best_format: bestFormat(e.files),
  };
}

export function mapBook(b: MappableBook): Book {
  const overrides =
    b.overrides &&
    typeof b.overrides === "object" &&
    !Array.isArray(b.overrides)
      ? (b.overrides as Record<string, unknown>)
      : undefined;

  return {
    id: b.id,
    google_volume_id: b.googleVolumeId,
    isbn13: b.isbn13,
    title: b.title,
    sort_title: b.sortTitle,
    subtitle: b.subtitle,
    overview: b.overview,
    cover_url: b.coverUrl,
    authors: b.authors,
    language: b.language,
    published_year: b.publishedYear,
    series_name: b.seriesName,
    series_position: b.seriesPosition,
    added_at: b.addedAt.toISOString(),
    updated_at: b.updatedAt.toISOString(),
    ...(overrides ? { overrides } : {}),
    editions: b.editions.map(mapBookEdition),
  };
}

/** Books are gated behind a settings flag so a movies-only install is untouched. */
export const BOOKS_DISABLED_MESSAGE =
  "Books are not enabled. Enable them in Settings first.";
