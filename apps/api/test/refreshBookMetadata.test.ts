import { describe, expect, test } from "bun:test";
import {
  audnexus,
  BookProviderUnavailableError,
  bookFixture,
  googlebooks,
  refreshBookMetadata,
  state,
  useRefreshHooks,
} from "./refreshBookMetadata.helpers";

useRefreshHooks();

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

describe("refreshBookMetadata author enrichment", () => {
  test("fills an empty author's bio and image", async () => {
    state.author = { id: 7, bio: null, imageUrl: null };
    await refreshBookMetadata(1, {
      providers: [
        audnexus({}, { authorBio: "A life.", authorImageUrl: "http://img" }),
      ],
    });
    expect(state.authorUpdates).toEqual([
      { bio: "A life.", imageUrl: "http://img" },
    ]);
  });

  test("fills only the empty side, never overwriting", async () => {
    state.author = { id: 7, bio: "kept", imageUrl: null };
    await refreshBookMetadata(1, {
      providers: [
        audnexus({}, { authorBio: "new", authorImageUrl: "http://new" }),
      ],
    });
    expect(state.authorUpdates).toEqual([{ imageUrl: "http://new" }]);
  });

  test("skips the provider entirely when the author already has both", async () => {
    state.author = { id: 7, bio: "have", imageUrl: "http://have" };
    const provider = audnexus({}, { authorBio: "x", authorImageUrl: "y" });
    await refreshBookMetadata(1, { providers: [provider] });
    expect(provider.enrichAuthorCalls).toBe(0);
    expect(state.authorUpdates).toEqual([]);
  });

  test("writes nothing when the provider returns no author fields", async () => {
    state.author = { id: 7, bio: null, imageUrl: null };
    await refreshBookMetadata(1, { providers: [audnexus({}, {})] });
    expect(state.authorUpdates).toEqual([]);
  });

  test("does nothing when the primary author row is missing", async () => {
    state.author = null;
    await refreshBookMetadata(1, {
      providers: [audnexus({}, { authorBio: "x", authorImageUrl: "y" })],
    });
    expect(state.authorUpdates).toEqual([]);
  });
});
