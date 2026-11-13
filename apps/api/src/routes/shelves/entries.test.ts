import { beforeEach, describe, expect, it } from "bun:test";
import {
  addEntry,
  call,
  resetHarness,
  seedShelf,
  sendJson,
  session,
  state,
  user,
} from "../../../test/helpers/shelvesHarness";

beforeEach(resetHarness);

describe("shelf entries", () => {
  it("adds an entry idempotently and keeps seasons distinct", async () => {
    const shelf = seedShelf();
    state.media.push({
      id: 10,
      tmdbId: 42,
      type: "show",
      title: "A show",
      year: 2021,
      posterUrl: "https://image.tmdb.org/t/p/w342/show.jpg",
      overrides: null,
    });

    const first = await sendJson("POST", `/${shelf.id}/entries`, {
      tmdb_id: 42,
      type: "show",
      season: 1,
      group_label: "Phase One",
    });
    const second = await sendJson("POST", `/${shelf.id}/entries`, {
      tmdb_id: 42,
      type: "show",
      season: 1,
    });
    expect(first.status).toBe(200);
    const firstBody = (await first.json()) as { entry: { id: number } };
    const secondBody = (await second.json()) as { entry: { id: number } };
    expect(secondBody.entry.id).toBe(firstBody.entry.id);
    expect(state.entries).toHaveLength(1);

    await sendJson("POST", `/${shelf.id}/entries`, {
      tmdb_id: 42,
      type: "show",
      season: 2,
    });
    expect(state.entries).toHaveLength(2);
  });

  it("rejects a season on a movie and a title TMDB does not know", async () => {
    const shelf = seedShelf();
    expect(
      (
        await sendJson("POST", `/${shelf.id}/entries`, {
          tmdb_id: 42,
          type: "movie",
          season: 1,
        })
      ).status,
    ).toBe(400);
    // TMDB is mocked to "not configured" in the harness, so an unknown title
    // and an unconfigured integration both answer a clear 400.
    expect(
      (
        await sendJson("POST", `/${shelf.id}/entries`, {
          tmdb_id: 43,
          type: "movie",
        })
      ).status,
    ).toBe(400);
  });

  it("reorders entries with group labels and reports unknown ids", async () => {
    const shelf = seedShelf();
    const a = addEntry(shelf.id, { title: "A" });
    const b = addEntry(shelf.id, { title: "B" });
    const res = await sendJson("PATCH", `/${shelf.id}/entries`, {
      entries: [
        { id: b.id, position: 0, group_label: "Second" },
        { id: a.id, position: 1, group_label: null },
      ],
    });
    expect(res.status).toBe(200);

    const detail = (await (await call(`/${shelf.id}`)).json()) as {
      shelf: { entries: Array<{ title: string; group_label: string | null }> };
    };
    expect(detail.shelf.entries.map((entry) => entry.title)).toEqual([
      "B",
      "A",
    ]);
    expect(detail.shelf.entries[0].group_label).toBe("Second");

    expect(
      (
        await sendJson("PATCH", `/${shelf.id}/entries`, {
          entries: [{ id: 999, position: 0, group_label: null }],
        })
      ).status,
    ).toBe(400);
  });

  it("sorts release shelves by year and keeps manual order otherwise", async () => {
    const shelf = seedShelf({ orderMode: "release" });
    addEntry(shelf.id, { title: "Late", year: 2015, tmdbId: 3 });
    addEntry(shelf.id, { title: "Early", year: 1999, tmdbId: 2 });

    const detail = (await (await call(`/${shelf.id}`)).json()) as {
      shelf: { entries: Array<{ title: string }> };
    };
    expect(detail.shelf.entries.map((entry) => entry.title)).toEqual([
      "Early",
      "Late",
    ]);
  });

  it("hides excluded entries from users but shows them to admins", async () => {
    const shelf = seedShelf();
    addEntry(shelf.id, { title: "Kept", tmdbId: 1 });
    addEntry(shelf.id, {
      title: "Excluded",
      tmdbId: 2,
      source: "rule",
      excluded: true,
    });

    const adminView = (await (await call(`/${shelf.id}`)).json()) as {
      shelf: { entries: unknown[] };
    };
    expect(adminView.shelf.entries).toHaveLength(2);

    session.user = { ...user };
    const userView = (await (await call(`/${shelf.id}`)).json()) as {
      shelf: { entries: Array<{ title: string }>; entry_count: number };
    };
    expect(userView.shelf.entries.map((entry) => entry.title)).toEqual([
      "Kept",
    ]);
    expect(userView.shelf.entry_count).toBe(1);
  });

  it("excludes a rule-sourced entry instead of deleting it", async () => {
    const shelf = seedShelf();
    const ruleEntry = addEntry(shelf.id, { source: "rule" });
    const manualEntry = addEntry(shelf.id, { tmdbId: 2 });

    const excluded = (await (
      await call(`/${shelf.id}/entries/${ruleEntry.id}`, { method: "DELETE" })
    ).json()) as { excluded: boolean };
    expect(excluded.excluded).toBe(true);
    expect(
      state.entries.find((entry) => entry.id === ruleEntry.id)?.excluded,
    ).toBe(true);

    await call(`/${shelf.id}/entries/${manualEntry.id}`, { method: "DELETE" });
    expect(
      state.entries.find((entry) => entry.id === manualEntry.id),
    ).toBeUndefined();
  });

  it("rescues an excluded title when it is added by hand", async () => {
    const shelf = seedShelf();
    const excluded = addEntry(shelf.id, {
      tmdbId: 7,
      title: "Back",
      source: "rule",
      excluded: true,
    });
    const res = await sendJson("POST", `/${shelf.id}/entries`, {
      tmdb_id: 7,
      type: "movie",
    });
    expect(res.status).toBe(200);
    expect(state.entries[0].excluded).toBe(false);
    expect(state.entries[0].source).toBe("manual");
    expect(state.entries).toHaveLength(1);
    expect(state.entries[0].id).toBe(excluded.id);
  });

  it("lists shelves and whether they hold a title, with the entry id", async () => {
    const holds = seedShelf({ name: "Holds" });
    seedShelf({ name: "Empty", position: 1 });
    addEntry(holds.id, { tmdbId: 7, type: "movie" });

    const body = (await (
      await call("/for-title?tmdb_id=7&type=movie")
    ).json()) as {
      shelves: Array<{
        name: string;
        holds: boolean;
        entry_id: number | null;
        order_mode: string;
      }>;
    };
    expect(body.shelves.map((shelf) => [shelf.name, shelf.holds])).toEqual([
      ["Holds", true],
      ["Empty", false],
    ]);
    expect(body.shelves[0].entry_id).toBe(state.entries[0].id);
    // Clients list the shelves that take titles by hand
    expect(body.shelves.map((shelf) => shelf.order_mode)).toEqual([
      "manual",
      "manual",
    ]);
  });

  it("resolves a library title with its poster and overrides, and a missing one dimmed", async () => {
    const shelf = seedShelf();
    state.media.push({
      id: 11,
      tmdbId: 8,
      type: "movie",
      title: "Library title",
      year: 2001,
      posterUrl: "https://image.tmdb.org/t/p/w342/original.jpg",
      overrides: { poster_url: "https://image.tmdb.org/t/p/w342/picked.jpg" },
    });
    addEntry(shelf.id, { tmdbId: 8, title: "Stored title" });
    addEntry(shelf.id, {
      tmdbId: 9,
      title: "Missing",
      posterPath: "/missing.jpg",
    });

    const detail = (await (await call(`/${shelf.id}`)).json()) as {
      shelf: {
        entries: Array<{
          title: string;
          in_library: boolean;
          library_id: number | null;
          poster_url: string | null;
        }>;
        in_library_count: number;
        cover: { style: string; posters: string[] };
      };
    };
    const [inLibrary, missing] = detail.shelf.entries;
    expect(inLibrary.title).toBe("Library title");
    expect(inLibrary.in_library).toBe(true);
    expect(inLibrary.library_id).toBe(11);
    expect(inLibrary.poster_url).toContain("picked.jpg");
    expect(missing.in_library).toBe(false);
    expect(missing.poster_url).toContain("/missing.jpg");
    expect(detail.shelf.in_library_count).toBe(1);
    expect(detail.shelf.cover.style).toBe("mosaic");
    expect(detail.shelf.cover.posters).toHaveLength(2);
  });
});
