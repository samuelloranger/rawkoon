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
