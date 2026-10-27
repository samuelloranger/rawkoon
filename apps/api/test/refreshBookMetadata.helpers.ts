import { beforeEach, mock } from "bun:test";

/**
 * refreshBookMetadata orchestrates: read the book, ask every enabled provider,
 * merge, write. The providers are injected here rather than module-mocked, so
 * these tests exercise the orchestration and not three fetch stubs.
 */

export const state: {
  book: Record<string, unknown> | null;
  sourceOrder: string[];
  updates: Record<string, unknown>[];
  externalIdUpserts: Record<string, unknown>[];
  externalIdDeletes: Record<string, unknown>[];
  provenanceRows: Record<string, unknown>[];
  provenanceDeletes: number;
  /** When set, findFirst treats this volume id as already owned by another book. */
  volumeConflictId: string | null;
  /** When set, the first update carrying googleVolumeId raises P2002. */
  raceVolumeConflict: boolean;
  /** The Author row returned for the book's primary author, or null. */
  author: { id: number; bio: string | null; imageUrl: string | null } | null;
  authorUpdates: Record<string, unknown>[];
} = {
  book: null,
  sourceOrder: ["audnexus", "googlebooks"],
  updates: [],
  externalIdUpserts: [],
  externalIdDeletes: [],
  provenanceRows: [],
  provenanceDeletes: 0,
  volumeConflictId: null,
  raceVolumeConflict: false,
  author: null,
  authorUpdates: [],
};

export const bookFixture = () => ({
  id: 1,
  googleVolumeId: "GV1",
  title: "Le Jardin de Verre",
  authors: ["Camille Rousseau"],
  language: "fr",
  overrides: null,
  externalIds: [] as { source: string; externalId: string }[],
  metadataFields: [] as { field: string; source: string }[],
  // Current column values, so the orchestrator can diff before writing.
  subtitle: null,
  narrators: [] as string[],
  genres: [] as string[],
  publisher: null as string | null,
  pageCount: null as number | null,
  publishedDate: null as Date | null,
  publishedYear: null as number | null,
  isbn13: null as string | null,
  coverUrl: null as string | null,
  overview: null as string | null,
  seriesName: null as string | null,
  seriesPosition: null as number | null,
  rating: null as number | null,
  ratingCount: null as number | null,
});

const tx = {
  libraryBook: {
    update: (args: { data: Record<string, unknown> }) => {
      if (state.raceVolumeConflict && "googleVolumeId" in args.data) {
        state.raceVolumeConflict = false;
        return Promise.reject(
          Object.assign(new Error("Unique constraint failed"), {
            code: "P2002",
          }),
        );
      }
      state.updates.push(args.data);
      return Promise.resolve({ id: 1 });
    },
  },
  bookExternalId: {
    upsert: (args: Record<string, unknown>) => {
      state.externalIdUpserts.push(args);
      return Promise.resolve({});
    },
    deleteMany: (args: Record<string, unknown>) => {
      state.externalIdDeletes.push(args);
      return Promise.resolve({ count: 1 });
    },
  },
  bookMetadataField: {
    deleteMany: () => {
      state.provenanceDeletes++;
      return Promise.resolve({ count: 0 });
    },
    createMany: (args: { data: Record<string, unknown>[] }) => {
      state.provenanceRows.push(...args.data);
      return Promise.resolve({ count: args.data.length });
    },
  },
};

mock.module("@rawkoon/api/db", () => ({
  prisma: {
    libraryBook: {
      findUnique: () => Promise.resolve(state.book),
      findFirst: (args: {
        where: { googleVolumeId: string; NOT?: { id: number } };
      }) => {
        // Conflict check for ISBN rebind: another book already owns the volume.
        if (
          state.volumeConflictId &&
          args.where.googleVolumeId === state.volumeConflictId
        ) {
          return Promise.resolve({ id: 99 });
        }
        return Promise.resolve(null);
      },
    },
    mediaSettings: {
      findUnique: () =>
        Promise.resolve({ bookMetadataSourceOrder: state.sourceOrder }),
    },
    author: {
      findUnique: () => Promise.resolve(state.author),
      update: (args: { data: Record<string, unknown> }) => {
        state.authorUpdates.push(args.data);
        return Promise.resolve({});
      },
    },
    $transaction: (fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
  },
}));

export const { refreshBookMetadata } = await import(
  "@rawkoon/api/services/books/refreshBookMetadata"
);
export const { BookProviderUnavailableError } = await import(
  "@rawkoon/api/services/books/types"
);

export function useRefreshHooks() {
  beforeEach(() => {
    state.book = bookFixture();
    state.sourceOrder = ["audnexus", "googlebooks"];
    state.updates = [];
    state.externalIdUpserts = [];
    state.externalIdDeletes = [];
    state.provenanceRows = [];
    state.provenanceDeletes = 0;
    state.volumeConflictId = null;
    state.raceVolumeConflict = false;
    state.author = null;
    state.authorUpdates = [];
  });
}

export const audnexus = (
  fields: Record<string, unknown>,
  authorFields?: Record<string, unknown>,
) => {
  const stub: {
    source: "audnexus";
    enrich: () => Promise<Record<string, unknown>>;
    enrichAuthorCalls: number;
    enrichAuthor?: () => Promise<Record<string, unknown>>;
  } = {
    source: "audnexus",
    enrich: () => Promise.resolve(fields),
    enrichAuthorCalls: 0,
  };
  if (authorFields) {
    stub.enrichAuthor = () => {
      stub.enrichAuthorCalls++;
      return Promise.resolve(authorFields);
    };
  }
  return stub;
};
export const googlebooks = (fields: Record<string, unknown>) => ({
  source: "googlebooks" as const,
  enrich: () => Promise.resolve(fields),
});

/**
 * A Google Books stand-in for the rebind path. `resolveIsbn` records the
 * arguments it was called with, so a test can assert that identity resolution
 * was skipped entirely rather than merely fruitless.
 */
export const identityFor = (
  volumeId: string,
  fields?: Record<string, unknown>,
): {
  source: "googlebooks";
  calls: Array<{ isbn: string; strict: boolean }>;
  resolveIsbn: (isbn: string, opts?: { strict?: boolean }) => Promise<unknown>;
  getBook: () => Promise<null>;
  searchBooks: () => Promise<never[]>;
  getAuthorBooks: () => Promise<never[]>;
  enrich: () => Promise<Record<string, unknown>>;
} => {
  const calls: Array<{ isbn: string; strict: boolean }> = [];
  return {
    source: "googlebooks",
    calls,
    resolveIsbn: (isbn: string, opts?: { strict?: boolean }) => {
      calls.push({ isbn, strict: opts?.strict === true });
      return Promise.resolve({
        volumeId,
        title: "Vengeful",
        subtitle: null,
        authors: ["V. E. Schwab"],
        language: "fr",
        publishedYear: 2019,
        isbn13: "9782371022508",
        coverUrl: "https://example.invalid/fr.jpg",
        overview: "Blurb française",
        seriesName: null,
        seriesPosition: null,
      });
    },
    getBook: () => Promise.resolve(null),
    searchBooks: () => Promise.resolve([]),
    getAuthorBooks: () => Promise.resolve([]),
    enrich: () => Promise.resolve(fields ?? { overview: "Blurb française" }),
  };
};
