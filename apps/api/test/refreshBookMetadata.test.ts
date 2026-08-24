import { beforeEach, describe, expect, mock, test } from "bun:test";

/**
 * refreshBookMetadata orchestrates: read the book, ask every enabled provider,
 * merge, write. The providers are injected here rather than module-mocked, so
 * these tests exercise the orchestration and not three fetch stubs.
 */

const state: {
  book: Record<string, unknown> | null;
  sourceOrder: string[];
  updates: Record<string, unknown>[];
  externalIdUpserts: Record<string, unknown>[];
  provenanceRows: Record<string, unknown>[];
  provenanceDeletes: number;
} = {
  book: null,
  sourceOrder: ["audnexus", "googlebooks"],
  updates: [],
  externalIdUpserts: [],
  provenanceRows: [],
  provenanceDeletes: 0,
};

const bookFixture = () => ({
  id: 1,
  googleVolumeId: "GV1",
  title: "Le Jardin de Verre",
  authors: ["Camille Rousseau"],
  language: "fr",
  isbn13: null,
  overrides: null,
  externalIds: [] as { source: string; externalId: string }[],
});

const tx = {
  libraryBook: {
    update: (args: { data: Record<string, unknown> }) => {
      state.updates.push(args.data);
      return Promise.resolve({ id: 1 });
    },
  },
  bookExternalId: {
    upsert: (args: Record<string, unknown>) => {
      state.externalIdUpserts.push(args);
      return Promise.resolve({});
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
    libraryBook: { findUnique: () => Promise.resolve(state.book) },
    mediaSettings: {
      findUnique: () =>
        Promise.resolve({ bookMetadataSourceOrder: state.sourceOrder }),
    },
    $transaction: (fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
  },
}));

const { refreshBookMetadata } = await import(
  "@rawkoon/api/services/books/refreshBookMetadata"
);
const { BookProviderUnavailableError } = await import(
  "@rawkoon/api/services/books/types"
);

beforeEach(() => {
  state.book = bookFixture();
  state.sourceOrder = ["audnexus", "googlebooks"];
  state.updates = [];
  state.externalIdUpserts = [];
  state.provenanceRows = [];
  state.provenanceDeletes = 0;
});

const audnexus = (fields: Record<string, unknown>) => ({
  source: "audnexus" as const,
  enrich: () => Promise.resolve(fields),
});
const googlebooks = (fields: Record<string, unknown>) => ({
  source: "googlebooks" as const,
  enrich: () => Promise.resolve(fields),
});

describe("refreshBookMetadata", () => {
  test("writes merged fields and their provenance", async () => {
    const outcome = await refreshBookMetadata(1, {
      providers: [
        audnexus({
          narrators: ["Laure Vidal"],
          seriesName: "Le Jardin de Verre",
          seriesPosition: 1,
          __asin: "B0SCRUB001",
        }),
        googlebooks({ overview: "blurb" }),
      ],
    });

    expect(outcome.ok).toBe(true);
    const data = state.updates.at(-1) ?? {};
    expect(data.narrators).toEqual(["Laure Vidal"]);
    expect(data.seriesName).toBe("Le Jardin de Verre");
    expect(data.overview).toBe("blurb");
    expect(
      state.provenanceRows.some(
        (p) => p.field === "narrators" && p.source === "audnexus",
      ),
    ).toBe(true);
    expect(
      state.provenanceRows.some(
        (p) => p.field === "overview" && p.source === "googlebooks",
      ),
    ).toBe(true);
  });

  // __asin is internal plumbing; writing it as a column would throw at the DB.
  test("persists the resolved ASIN as an external id, never as a column", async () => {
    await refreshBookMetadata(1, {
      providers: [
        audnexus({ narrators: ["Laure Vidal"], __asin: "B0SCRUB001" }),
      ],
    });
    expect(state.updates.at(-1)).not.toHaveProperty("__asin");
    expect(state.externalIdUpserts).toHaveLength(1);
    expect(JSON.stringify(state.externalIdUpserts[0])).toContain("B0SCRUB001");
  });

  /**
   * The title is the indexer search term and may have been hand-corrected, and
   * language re-points indexer searches, so neither is ever overwritten by a
   * refresh even when a provider supplies them.
   */
  test("never overwrites title, language or authors", async () => {
    await refreshBookMetadata(1, {
      providers: [
        audnexus({
          title: "A Different Title",
          language: "en",
          authors: ["Someone Else"],
          publisher: "Éditions Lisière",
        }),
      ],
    });
    const data = state.updates.at(-1) ?? {};
    expect(data.publisher).toBe("Éditions Lisière");
    expect(data).not.toHaveProperty("title");
    expect(data).not.toHaveProperty("language");
    expect(data).not.toHaveProperty("authors");
  });

  /**
   * A provider outage must not be recorded as "this source has nothing to say
   * about this book" — that would make a transient 503 permanent.
   */
  test("reports a failed source and writes no provenance for it", async () => {
    const outcome = await refreshBookMetadata(1, {
      providers: [
        {
          source: "audnexus" as const,
          enrich: () =>
            Promise.reject(
              new BookProviderUnavailableError("Audnexus down", 503),
            ),
        },
        googlebooks({ overview: "blurb" }),
      ],
    });

    expect(outcome.ok).toBe(true);
    expect(outcome.ok && outcome.failedSources).toContain("audnexus");
    expect(state.provenanceRows.some((p) => p.source === "audnexus")).toBe(
      false,
    );
    expect(state.provenanceRows.some((p) => p.source === "googlebooks")).toBe(
      true,
    );
  });

  test("stale provenance is replaced wholesale, not accumulated", async () => {
    await refreshBookMetadata(1, {
      providers: [googlebooks({ overview: "blurb" })],
    });
    expect(state.provenanceDeletes).toBe(1);
  });

  test("an operator override wins and claims no source", async () => {
    state.book = { ...bookFixture(), overrides: { publisher: "Hand-fixed" } };
    await refreshBookMetadata(1, {
      providers: [audnexus({ publisher: "Éditions Lisière" })],
    });
    expect(state.updates.at(-1)?.publisher).toBe("Hand-fixed");
    expect(state.provenanceRows.some((p) => p.field === "publisher")).toBe(
      false,
    );
  });

  test("a source absent from the order does not contribute", async () => {
    state.sourceOrder = ["googlebooks"];
    await refreshBookMetadata(1, {
      providers: [audnexus({ narrators: ["Laure Vidal"] })],
    });
    expect(state.updates.at(-1) ?? {}).not.toHaveProperty("narrators");
  });

  test("returns not-found for a missing book", async () => {
    state.book = null;
    const outcome = await refreshBookMetadata(999, { providers: [] });
    expect(outcome.ok).toBe(false);
    expect(state.updates).toHaveLength(0);
  });
});
