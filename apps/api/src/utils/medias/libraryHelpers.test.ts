import { afterEach, describe, expect, it } from "bun:test";
import {
  sortTitleFromName,
  tmdbDetailsFetch,
} from "@rawkoon/api/utils/medias/libraryHelpers";

describe("tmdbDetailsFetch", () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("retries without append_to_response when TMDB 500s on translations", async () => {
    const calls: string[] = [];
    global.fetch = (async (url: string | URL) => {
      const u = new URL(url);
      calls.push(u.searchParams.get("append_to_response") ?? "none");
      if (u.searchParams.has("append_to_response")) {
        return new Response("boom", { status: 500 });
      }
      return new Response(JSON.stringify({ title: "Aline" }), { status: 200 });
    }) as unknown as typeof fetch;

    const result = await tmdbDetailsFetch<{ title: string }>(
      "movie/498402",
      "key",
      { language: "en-US", append_to_response: "translations" },
    );

    expect(result).toEqual({ title: "Aline" });
    expect(calls).toEqual(["translations", "none"]);
  });

  it("does not retry (and rethrows) when there was no append_to_response to drop", async () => {
    global.fetch = (async () =>
      new Response("boom", { status: 500 })) as unknown as typeof fetch;

    await expect(
      tmdbDetailsFetch("movie/1", "key", { language: "en-US" }),
    ).rejects.toThrow("TMDB movie/1 → 500");
  });
});

describe("sortTitleFromName", () => {
  it("strips English articles by default", () => {
    expect(sortTitleFromName("The Godfather")).toBe("Godfather");
    expect(sortTitleFromName("A Star Is Born")).toBe("Star Is Born");
    expect(sortTitleFromName("An Education")).toBe("Education");
  });

  it("leaves French articles alone in English", () => {
    expect(sortTitleFromName("Le Parrain")).toBe("Le Parrain");
  });

  it("strips French articles when the language is fr", () => {
    expect(sortTitleFromName("Le Parrain", "fr")).toBe("Parrain");
    expect(sortTitleFromName("La Haine", "fr")).toBe("Haine");
    expect(sortTitleFromName("Les Choristes", "fr")).toBe("Choristes");
    expect(sortTitleFromName("Un Prophète", "fr")).toBe("Prophète");
    expect(sortTitleFromName("Une Femme", "fr")).toBe("Femme");
    expect(sortTitleFromName("Des Hommes", "fr")).toBe("Hommes");
  });

  it("strips the elided French article with no following space", () => {
    expect(sortTitleFromName("L'Étranger", "fr")).toBe("Étranger");
    expect(sortTitleFromName("L’Étranger", "fr")).toBe("Étranger");
  });

  it("does not strip a word that merely starts with an article", () => {
    expect(sortTitleFromName("Lesson Plan", "fr")).toBe("Lesson Plan");
    expect(sortTitleFromName("Theory of Everything")).toBe(
      "Theory of Everything",
    );
  });

  it("never returns an empty string when the title is only an article", () => {
    expect(sortTitleFromName("The", "en")).toBe("The");
    expect(sortTitleFromName("Le", "fr")).toBe("Le");
  });
});
