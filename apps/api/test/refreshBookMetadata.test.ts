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

  /**
   * An outage must not be destructive. Deleting the failing source's
   * provenance would leave its value in place while making the UI render it as
   * "set by hand", and letting a lower-priority source win the field during the
   * outage would overwrite the better value with a worse one.
   */
  test("an outage preserves the failing source's value and provenance", async () => {
    state.book = {
      ...bookFixture(),
      narrators: ["Laure Vidal"],
      overview: "audnexus blurb",
      metadataFields: [
        { field: "narrators", source: "audnexus" },
        { field: "overview", source: "audnexus" },
      ],
    };

    const outcome = await refreshBookMetadata(1, {
      providers: [
        {
          source: "audnexus" as const,
          enrich: () =>
            Promise.reject(new BookProviderUnavailableError("down", 503)),
        },
        // Google Books would otherwise win `overview` while Audnexus is down.
        googlebooks({ overview: "google blurb" }),
      ],
    });

    expect(outcome.ok && outcome.failedSources).toContain("audnexus");
    const data = state.updates.at(-1) ?? {};
    expect(data).not.toHaveProperty("overview");
    expect(data).not.toHaveProperty("narrators");
    // Both rows survive, still credited to the source that is merely offline.
    expect(state.provenanceRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: "narrators", source: "audnexus" }),
        expect.objectContaining({ field: "overview", source: "audnexus" }),
      ]),
    );
  });

  test("a healthy source still takes over a field the outage did not own", async () => {
    state.book = {
      ...bookFixture(),
      narrators: ["Laure Vidal"],
      metadataFields: [{ field: "narrators", source: "audnexus" }],
    };
    await refreshBookMetadata(1, {
      providers: [
        {
          source: "audnexus" as const,
          enrich: () =>
            Promise.reject(new BookProviderUnavailableError("down", 503)),
        },
        googlebooks({ publisher: "Éditions Lisière" }),
      ],
    });
    expect(state.updates.at(-1)?.publisher).toBe("Éditions Lisière");
    expect(state.provenanceRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: "publisher", source: "googlebooks" }),
      ]),
    );
  });

  /**
   * Reporting every merged column as changed makes "Updated N fields" a
   * constant, hides which books actually gained something, and churns
   * updatedAt on every refresh.
   */
  test("reports only fields whose stored value actually changed", async () => {
    state.book = {
      ...bookFixture(),
      publisher: "Éditions Lisière",
      narrators: ["Laure Vidal"],
      seriesPosition: 1,
    };
    const outcome = await refreshBookMetadata(1, {
      providers: [
        audnexus({
          publisher: "Éditions Lisière",
          narrators: ["Laure Vidal"],
          seriesPosition: 1,
          rating: 4.6,
        }),
      ],
    });
    expect(outcome.ok && outcome.changedFields).toEqual(["rating"]);
    expect(Object.keys(state.updates.at(-1) ?? {})).toEqual(["rating"]);
  });

  test("writes nothing at all when every value already matches", async () => {
    state.book = { ...bookFixture(), publisher: "Éditions Lisière" };
    const outcome = await refreshBookMetadata(1, {
      providers: [audnexus({ publisher: "Éditions Lisière" })],
    });
    expect(outcome.ok && outcome.changedFields).toEqual([]);
    // No update call means updatedAt does not advance.
    expect(state.updates).toHaveLength(0);
  });

  /**
   * An override must reach the column even though no provider is allowed to
   * write title or language. Those two are protected against untrusted
   * provider data, not against the operator — fixing a wrong title or a
   * misdetected language is exactly what overrides are for.
   */
  test("an override reaches title and language, which providers cannot write", async () => {
    // The stored language is deliberately wrong here — a real case, since the
    // provider's language is unreliable and the operator is correcting it.
    state.book = {
      ...bookFixture(),
      language: "en",
      overrides: { title: "Corrected Title", language: "fr" },
    };
    await refreshBookMetadata(1, {
      providers: [audnexus({ title: "Provider Title", language: "en" })],
    });
    const data = state.updates.at(-1) ?? {};
    expect(data.title).toBe("Corrected Title");
    expect(data.language).toBe("fr");
  });

  test("a provider still cannot write title or language without an override", async () => {
    await refreshBookMetadata(1, {
      providers: [audnexus({ title: "Provider Title", language: "en" })],
    });
    const data = state.updates.at(-1) ?? {};
    expect(data).not.toHaveProperty("title");
    expect(data).not.toHaveProperty("language");
  });

  /**
   * Editing a field while the source that owns it is unreachable must still
   * work. The outage protection exists to stop a lower-priority source
   * overwriting a better value — it was never meant to outrank the operator.
   */
  test("an override wins even over a field locked by a failing source", async () => {
    state.book = {
      ...bookFixture(),
      publisher: "Stale Publisher",
      overrides: { publisher: "Hand-fixed" },
      metadataFields: [{ field: "publisher", source: "audnexus" }],
    };
    await refreshBookMetadata(1, {
      providers: [
        {
          source: "audnexus" as const,
          enrich: () =>
            Promise.reject(new BookProviderUnavailableError("down", 503)),
        },
      ],
    });
    expect(state.updates.at(-1)?.publisher).toBe("Hand-fixed");
  });

  /**
   * Removing an override on a provider-protected column has to restore the
   * source value. Without an explicit re-authorisation the field would stay
   * frozen at whatever the operator typed, because the override is gone and no
   * provider is allowed to write that column — reverting would be a one-way
   * door.
   */
  test("a cleared override on title is restored from the sources", async () => {
    state.book = {
      ...bookFixture(),
      title: "Hand-fixed Title",
      overrides: null,
    };
    await refreshBookMetadata(1, {
      providers: [audnexus({ title: "Provider Title" })],
      restoreColumns: ["title"],
    });
    expect(state.updates.at(-1)?.title).toBe("Provider Title");
  });

  test("restoreColumns does not open the column to providers generally", async () => {
    state.book = { ...bookFixture(), title: "Current Title", overrides: null };
    await refreshBookMetadata(1, {
      providers: [audnexus({ title: "Provider Title" })],
      restoreColumns: ["language"],
    });
    expect(state.updates.at(-1) ?? {}).not.toHaveProperty("title");
  });

  test("compares dates by instant, not identity", async () => {
    state.book = {
      ...bookFixture(),
      publishedDate: new Date("2024-06-27T00:00:00.000Z"),
    };
    const outcome = await refreshBookMetadata(1, {
      providers: [audnexus({ publishedDate: "2024-06-27T00:00:00.000Z" })],
    });
    expect(outcome.ok && outcome.changedFields).toEqual([]);
  });
});
