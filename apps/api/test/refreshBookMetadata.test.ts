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
  externalIdDeletes: Record<string, unknown>[];
  provenanceRows: Record<string, unknown>[];
  provenanceDeletes: number;
  /** When set, findFirst treats this volume id as already owned by another book. */
  volumeConflictId: string | null;
  /** When set, the first update carrying googleVolumeId raises P2002. */
  raceVolumeConflict: boolean;
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
  state.externalIdDeletes = [];
  state.provenanceRows = [];
  state.provenanceDeletes = 0;
  state.volumeConflictId = null;
  state.raceVolumeConflict = false;
});

const audnexus = (fields: Record<string, unknown>) => ({
  source: "audnexus" as const,
  enrich: () => Promise.resolve(fields),
});
const googlebooks = (fields: Record<string, unknown>) => ({
  source: "googlebooks" as const,
  enrich: () => Promise.resolve(fields),
});

/**
 * A Google Books stand-in for the rebind path. `resolveIsbn` records the
 * arguments it was called with, so a test can assert that identity resolution
 * was skipped entirely rather than merely fruitless.
 */
const identityFor = (
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
      clearedOverrides: ["title"],
    });
    expect(state.updates.at(-1)?.title).toBe("Provider Title");
  });

  test("clearedOverrides does not open another column to providers", async () => {
    state.book = { ...bookFixture(), title: "Current Title", overrides: null };
    await refreshBookMetadata(1, {
      providers: [audnexus({ title: "Provider Title" })],
      clearedOverrides: ["language"],
    });
    expect(state.updates.at(-1) ?? {}).not.toHaveProperty("title");
  });

  /**
   * Reverting a manually added value that no source supplies must empty the
   * column. Otherwise the value survives its own removal: it keeps showing
   * while `overrides` no longer marks it as edited, so the UI offers no revert
   * and it can never be cleared.
   */
  test("clearing an override no source supplies empties the column", async () => {
    state.book = {
      ...bookFixture(),
      publisher: "Manually Added",
      overrides: null,
    };
    await refreshBookMetadata(1, {
      // No provider supplies a publisher.
      providers: [audnexus({ narrators: ["Laure Vidal"] })],
      clearedOverrides: ["publisher"],
    });
    expect(state.updates.at(-1)).toHaveProperty("publisher", null);
  });

  test("clearing does not blank a field the sources still supply", async () => {
    state.book = {
      ...bookFixture(),
      publisher: "Manually Added",
      overrides: null,
    };
    await refreshBookMetadata(1, {
      providers: [audnexus({ publisher: "Éditions Lisière" })],
      clearedOverrides: ["publisher"],
    });
    expect(state.updates.at(-1)?.publisher).toBe("Éditions Lisière");
  });

  /**
   * The clearing path must respect what each column can actually hold. Writing
   * null into a list or a NOT NULL column fails *after* the route has already
   * deleted the override, which both 500s and strands the value.
   */
  test("clearing a list field empties it to [] rather than null", async () => {
    state.book = {
      ...bookFixture(),
      narrators: ["Manually Added"],
      genres: ["Manual Genre"],
      overrides: null,
    };
    await refreshBookMetadata(1, {
      providers: [audnexus({ publisher: "Éditions Lisière" })],
      clearedOverrides: ["narrators", "genres"],
    });
    const data = state.updates.at(-1) ?? {};
    expect(data.narrators).toEqual([]);
    expect(data.genres).toEqual([]);
  });

  test("reports title as unrestored so the caller can put the override back", async () => {
    state.book = {
      ...bookFixture(),
      title: "Only Title There Is",
      overrides: null,
    };
    const outcome = await refreshBookMetadata(1, {
      providers: [audnexus({ publisher: "Éditions Lisière" })],
      clearedOverrides: ["title"],
    });
    // Skipping the write alone would strand the value: displayed as if a source
    // supplied it, with no Revert action and no later refresh able to fix it.
    expect(outcome.ok && outcome.unrestoredFields).toEqual(["title"]);
  });

  test("reports nothing unrestored when a source does supply the field", async () => {
    state.book = { ...bookFixture(), title: "Old Title", overrides: null };
    const outcome = await refreshBookMetadata(1, {
      providers: [audnexus({ title: "Provider Title" })],
      clearedOverrides: ["title"],
    });
    expect(outcome.ok && outcome.unrestoredFields).toEqual([]);
    expect(state.updates.at(-1)?.title).toBe("Provider Title");
  });

  test("never empties title or language, which cannot be null", async () => {
    state.book = {
      ...bookFixture(),
      title: "Only Title There Is",
      language: "fr",
      overrides: null,
    };
    await refreshBookMetadata(1, {
      // No provider supplies a title or a language.
      providers: [audnexus({ publisher: "Éditions Lisière" })],
      clearedOverrides: ["title", "language"],
    });
    const data = state.updates.at(-1) ?? {};
    expect(data).not.toHaveProperty("title");
    expect(data).not.toHaveProperty("language");
  });

  test("clearing a field that is already empty writes nothing", async () => {
    state.book = { ...bookFixture(), publisher: null, overrides: null };
    await refreshBookMetadata(1, {
      providers: [audnexus({ narrators: ["Laure Vidal"] })],
      clearedOverrides: ["publisher"],
    });
    expect(state.updates.at(-1) ?? {}).not.toHaveProperty("publisher");
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

  /**
   * Changing the ISBN must re-point identity. Enrich alone keeps fetching the
   * old googleVolumeId, so a French ISBN override left the English volume's
   * cover, overview and language in place. Rebind resolves the ISBN, swaps
   * the volume id, drops the stale Audnexus ASIN, and allows title/language
   * to follow the new edition.
   */
  test("rebinding via ISBN overwrites identity and clears a stale Audnexus ASIN", async () => {
    state.book = {
      ...bookFixture(),
      googleVolumeId: "EN-VOLUME",
      title: "Vengeful",
      language: "en",
      isbn13: "9781250303554",
      overview: "English blurb",
      coverUrl: "https://example.invalid/en.jpg",
      overrides: { isbn13: "9782371022508" },
      externalIds: [{ source: "audnexus", externalId: "B0ENGLISH" }],
      metadataFields: [
        { field: "overview", source: "googlebooks" },
        { field: "coverUrl", source: "googlebooks" },
      ],
    };

    let enrichIsbn: string | null = null;
    let enrichVolume: string | null = null;
    let enrichHasAudnexus = true;

    const identity = {
      source: "googlebooks" as const,
      resolveIsbn: (isbn: string) =>
        Promise.resolve({
          volumeId: "FR-VOLUME",
          title: "Vengeful",
          subtitle: null,
          authors: ["V. E. Schwab"],
          language: "fr",
          publishedYear: 2019,
          isbn13: isbn.replace(/[\s-]/g, ""),
          coverUrl: "https://example.invalid/fr.jpg",
          overview: "Blurb française",
          seriesName: null,
          seriesPosition: null,
        }),
      getBook: () => Promise.resolve(null),
      searchBooks: () => Promise.resolve([]),
      getAuthorBooks: () => Promise.resolve([]),
      enrich: (book: {
        isbn13: string | null;
        googleVolumeId: string;
        externalIds: Record<string, string>;
      }) => {
        enrichIsbn = book.isbn13;
        enrichVolume = book.googleVolumeId;
        enrichHasAudnexus = "audnexus" in book.externalIds;
        return Promise.resolve({
          overview: "Blurb française",
          coverUrl: "https://example.invalid/fr.jpg",
          isbn13: "9782371022508",
          language: "fr",
          title: "Vengeful",
        });
      },
    };

    const outcome = await refreshBookMetadata(1, {
      providers: [identity],
      identityProvider: identity,
    });

    expect(outcome.ok).toBe(true);
    expect(enrichVolume).toBe("FR-VOLUME");
    expect(enrichIsbn).toBe("9782371022508");
    expect(enrichHasAudnexus).toBe(false);

    const data = state.updates.at(-1) ?? {};
    expect(data.googleVolumeId).toBe("FR-VOLUME");
    expect(data.language).toBe("fr");
    expect(data.overview).toBe("Blurb française");
    expect(data.coverUrl).toBe("https://example.invalid/fr.jpg");
    expect(
      state.externalIdDeletes.some((d) =>
        JSON.stringify(d).includes("audnexus"),
      ),
    ).toBe(true);
  });

  test("does not rebind when resolveIsbn returns the same volume", async () => {
    state.book = {
      ...bookFixture(),
      googleVolumeId: "FR-VOLUME",
      isbn13: "9782371022508",
      overrides: { isbn13: "9782371022508" },
    };

    const identity = {
      source: "googlebooks" as const,
      resolveIsbn: () =>
        Promise.resolve({
          volumeId: "FR-VOLUME",
          title: "Vengeful",
          subtitle: null,
          authors: ["V. E. Schwab"],
          language: "fr",
          publishedYear: 2019,
          isbn13: "9782371022508",
          coverUrl: null,
          overview: null,
          seriesName: null,
          seriesPosition: null,
        }),
      getBook: () => Promise.resolve(null),
      searchBooks: () => Promise.resolve([]),
      getAuthorBooks: () => Promise.resolve([]),
      enrich: () => Promise.resolve({ overview: "same" }),
    };

    await refreshBookMetadata(1, {
      providers: [identity],
      identityProvider: identity,
    });

    expect(state.updates.at(-1) ?? {}).not.toHaveProperty("googleVolumeId");
    expect(state.externalIdDeletes).toHaveLength(0);
  });
});

/**
 * Rebind re-points a book's identity — volume id, title, language, cover — so
 * what is allowed to trigger it matters as much as what it does. Only an ISBN a
 * person asserted qualifies.
 */
describe("refreshBookMetadata ISBN rebind guards", () => {
  test("ignores the isbn13 column when no override asserts it", async () => {
    state.book = {
      ...bookFixture(),
      googleVolumeId: "EN-VOLUME",
      // Filled by a provider, not by a person: Audnexus contributes an Audible
      // product code for another language's edition of the same title.
      isbn13: "9782371022508",
    };
    const identity = identityFor("FR-VOLUME");

    await refreshBookMetadata(1, {
      providers: [identity],
      identityProvider: identity,
    });

    expect(identity.calls).toHaveLength(0);
    expect(state.updates.at(-1) ?? {}).not.toHaveProperty("googleVolumeId");
  });

  test("ignores an isbn13 override that this request is reverting", async () => {
    state.book = {
      ...bookFixture(),
      googleVolumeId: "EN-VOLUME",
      // The JSON key is already gone; the column still holds the typed value.
      isbn13: "9782371022508",
      overrides: null,
    };
    const identity = identityFor("FR-VOLUME");

    await refreshBookMetadata(1, {
      providers: [identity],
      identityProvider: identity,
      clearedOverrides: ["isbn13"],
    });

    expect(identity.calls).toHaveLength(0);
    expect(state.updates.at(-1) ?? {}).not.toHaveProperty("googleVolumeId");
  });

  test("does not rebind when googlebooks is not in the source order", async () => {
    state.sourceOrder = ["audnexus"];
    state.book = {
      ...bookFixture(),
      googleVolumeId: "EN-VOLUME",
      overrides: { isbn13: "9782371022508" },
    };
    const identity = identityFor("FR-VOLUME");

    await refreshBookMetadata(1, {
      providers: [audnexus({ overview: "vo" })],
      identityProvider: identity,
    });

    expect(identity.calls).toHaveLength(0);
    expect(state.updates.at(-1) ?? {}).not.toHaveProperty("googleVolumeId");
  });

  test("resolves the ISBN strictly", async () => {
    state.book = {
      ...bookFixture(),
      googleVolumeId: "EN-VOLUME",
      overrides: { isbn13: "9782371022508" },
    };
    const identity = identityFor("FR-VOLUME");

    await refreshBookMetadata(1, {
      providers: [identity],
      identityProvider: identity,
    });

    expect(identity.calls).toEqual([{ isbn: "9782371022508", strict: true }]);
  });

  test("converts an ISBN-10 override before resolving", async () => {
    state.book = {
      ...bookFixture(),
      googleVolumeId: "EN-VOLUME",
      overrides: { isbn13: "2-37102-250-6" },
    };
    const identity = identityFor("FR-VOLUME");

    await refreshBookMetadata(1, {
      providers: [identity],
      identityProvider: identity,
    });

    // 978 + the first 9 digits + a recomputed check digit.
    expect(identity.calls[0]?.isbn).toBe("9782371022508");
  });

  test("keeps the current identity when the volume is claimed mid-write", async () => {
    state.book = {
      ...bookFixture(),
      googleVolumeId: "EN-VOLUME",
      title: "Vengeful",
      language: "en",
      overrides: { isbn13: "9782371022508" },
    };
    // Passes the advisory check, loses the unique constraint.
    state.raceVolumeConflict = true;
    const identity = identityFor("FR-VOLUME", {
      overview: "Blurb française",
    });

    const outcome = await refreshBookMetadata(1, {
      providers: [identity],
      identityProvider: identity,
    });

    expect(outcome.ok).toBe(true);
    expect(outcome.ok && outcome.changedFields).not.toContain("googleVolumeId");
    const data = state.updates.at(-1) ?? {};
    expect(data).not.toHaveProperty("googleVolumeId");
    expect(data).not.toHaveProperty("language");
    expect(data.overview).toBe("Blurb française");
  });
});

/**
 * A column whose only supplier stops claiming it.
 *
 * Observed live: a wrong-language Audnexus record was dropped from a French
 * book, and `publisher` and `narrators` — fields no other source supplies —
 * kept the English audiobook's values forever. The loop only writes fields
 * present in `merged`, so an absent field left the stale value in place, and
 * the wholesale provenance delete stripped its row, so the UI then rendered it
 * as hand-set with nothing left to revert.
 */
describe("refreshBookMetadata orphaned columns", () => {
  test("clears a column its former source no longer claims", async () => {
    state.book = {
      ...bookFixture(),
      publisher: "Macmillan Audio",
      narrators: ["Jeremy Arthur"],
      metadataFields: [
        { field: "publisher", source: "audnexus" },
        { field: "narrators", source: "audnexus" },
      ],
    };

    // Audnexus answers, but says nothing about either field any more.
    const outcome = await refreshBookMetadata(1, {
      providers: [audnexus({ overview: "blurb" })],
    });

    expect(outcome.ok).toBe(true);
    const data = state.updates.at(-1) ?? {};
    expect(data.publisher).toBeNull();
    // A list column empties to [], which is what the Prisma client requires.
    expect(data.narrators).toEqual([]);
  });

  test("keeps the value when the owning source is failing", async () => {
    state.book = {
      ...bookFixture(),
      publisher: "Éditions Lisière",
      metadataFields: [{ field: "publisher", source: "audnexus" }],
    };

    const failing = {
      source: "audnexus" as const,
      enrich: () =>
        Promise.reject(new BookProviderUnavailableError("503 backendFailed")),
    };

    await refreshBookMetadata(1, { providers: [failing] });

    // A transient outage must never be read as "this field has no source".
    expect(state.updates.at(-1) ?? {}).not.toHaveProperty("publisher");
  });

  test("keeps an operator override the sources cannot supply", async () => {
    state.book = {
      ...bookFixture(),
      publisher: "Éditions Lisière",
      overrides: { publisher: "Éditions Lisière" },
      metadataFields: [{ field: "publisher", source: "audnexus" }],
    };

    await refreshBookMetadata(1, { providers: [audnexus({})] });

    expect(state.updates.at(-1) ?? {}).not.toHaveProperty("publisher");
  });

  test("leaves a column no source ever claimed alone", async () => {
    state.book = {
      ...bookFixture(),
      publisher: "Set by hand long ago",
      metadataFields: [],
    };

    await refreshBookMetadata(1, { providers: [audnexus({})] });

    expect(state.updates.at(-1) ?? {}).not.toHaveProperty("publisher");
  });
});
