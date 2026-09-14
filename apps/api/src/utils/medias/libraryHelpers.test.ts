import { describe, expect, it } from "bun:test";
import { sortTitleFromName } from "@rawkoon/api/utils/medias/libraryHelpers";

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
