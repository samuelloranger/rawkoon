import { describe, expect, test } from "bun:test";
import {
  audnexus,
  bookFixture,
  googlebooks,
  identityFor,
  refreshBookMetadata,
  state,
  useRefreshHooks,
} from "./refreshBookMetadata.helpers";

useRefreshHooks();

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
      title: "Ironwake",
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
